import express from 'express';
import multer from 'multer';
import path from 'path';
import {
  createContact,
  getContacts,
  getContactById,
  updateContact,
  deleteContact,
  deleteContactsBulk,
  deleteAllContacts,
  addContactToList,
  removeContactFromList,
  handleCsvImport,
  getContactStats,
  getDynamicProperties,
  getCsvMappingOptions,
  getContactLists,
  addContactsToListBulk,
  removeContactsFromListBulk,
  updateContactStatus
} from '../controllers/contactController.js';
import { protect, restrictTo } from '../controllers/authController.js';

const router = express.Router();

/**
 * Configurazione di Multer per l'upload dei file CSV
 * I file vengono salvati temporaneamente per l'elaborazione
 */
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    // Usa la directory uploads configurata nel server.js
    const uploadsDir = process.env.UPLOADS_DIR || 'uploads/';
    cb(null, uploadsDir);
  },
  filename: function (req, file, cb) {
    // Genera un nome unico per il file
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, 'csv-import-' + uniqueSuffix + path.extname(file.originalname));
  }
});

// Filtro per accettare solo file CSV
const fileFilter = (req, file, cb) => {
  if (file.mimetype === 'text/csv' || 
      file.originalname.toLowerCase().endsWith('.csv')) {
    cb(null, true);
  } else {
    cb(new Error('Solo file CSV sono permessi'), false);
  }
};

// Configurazione multer
const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024 // Limite di 5MB
  }
});

/**
 * MIDDLEWARE DI AUTENTICAZIONE
 * Tutte le routes dei contatti richiedono autenticazione
 */
router.use(protect);

/**
 * ROUTES PRINCIPALI PER I CONTATTI
 */

// Statistiche contatti (deve essere prima di /:id per evitare conflitti)
router.get('/stats', getContactStats);

// Proprietà dinamiche disponibili (deve essere prima di /:id per evitare conflitti)
router.get('/dynamic-properties', getDynamicProperties);

// Opzioni di mappatura per CSV (deve essere prima di /:id per evitare conflitti)
router.get('/csv-mapping-options', getCsvMappingOptions);

/**
 * ROUTES PER LA GESTIONE DELLE LISTE (devono essere prima di /:id per evitare conflitti)
 */

// Ottiene tutte le liste disponibili con conteggio
router.get('/lists', getContactLists);

// Aggiunge contatti multipli a una lista (bulk)
router.post('/lists/:listName/bulk-add', restrictTo('agent', 'manager', 'admin'), addContactsToListBulk);

// Rimuove contatti multipli da una lista (bulk)
router.post('/lists/:listName/bulk-remove', restrictTo('agent', 'manager', 'admin'), removeContactsFromListBulk);

// Aggiunge un contatto a una lista
router.post('/lists/:listName/contacts/:id', addContactToList);

// Rimuove un contatto da una lista
router.delete('/lists/:listName/contacts/:id', removeContactFromList);

// Importazione CSV con mappatura dinamica (solo agent e superiori)
// Fase 1: POST /contacts/import-csv?phase=analyze
// Fase 2: POST /contacts/import-csv?phase=import
router.post('/import-csv', 
  restrictTo('agent', 'manager', 'admin'),
  upload.single('csvFile'), 
  handleCsvImport
);

// CRUD Operations per i contatti
router.post('/', restrictTo('agent', 'manager', 'admin'), createContact);     // Crea nuovo contatto
router.get('/', getContacts);                                                 // Lista contatti 
router.delete('/bulk', restrictTo('agent', 'manager', 'admin'), deleteContactsBulk); // Elimina contatti in bulk
router.delete('/delete-all', restrictTo('manager', 'admin'), deleteAllContacts);   // Elimina TUTTI i contatti (solo manager/admin)

// Aggiorna status contatto (prima di /:id per evitare conflitti)
router.put('/:id/status', restrictTo('agent', 'manager', 'admin'), updateContactStatus);

router.get('/:id', getContactById);                                           // Ottieni contatto per ID
router.put('/:id', restrictTo('agent', 'manager', 'admin'), updateContact);   // Aggiorna contatto
router.delete('/:id', restrictTo('agent', 'manager', 'admin'), deleteContact); // Elimina contatto

/**
 * MIDDLEWARE DI GESTIONE ERRORI PER MULTER
 */
router.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({
        success: false,
        message: 'Il file è troppo grande. Massimo 5MB permessi.'
      });
    }
    if (error.code === 'LIMIT_UNEXPECTED_FILE') {
      return res.status(400).json({
        success: false,
        message: 'Campo file non valido. Utilizzare "csvFile".'
      });
    }
  }
  
  if (error.message === 'Solo file CSV sono permessi') {
    return res.status(400).json({
      success: false,
      message: 'Solo file CSV sono accettati per l\'importazione.'
    });
  }

  // Passa l'errore al middleware di gestione errori globale
  next(error);
});

export default router;

/**
 * DOCUMENTAZIONE DEGLI ENDPOINT
 * 
 * === GESTIONE CONTATTI ===
 * 
 * POST /contacts
 * Crea un nuovo contatto
 * Body: { name, email, phone?, lists?, properties? }
 * 
 * GET /contacts[?list=nomeLista&page=1&limit=10&search=termine]
 * Ottieni lista contatti con filtri opzionali
 * 
 * GET /contacts/:id
 * Ottieni un contatto specifico per ID
 * 
 * PUT /contacts/:id
 * Aggiorna un contatto esistente
 * Body: { name?, email?, phone?, lists?, properties? }
 * 
 * DELETE /contacts/:id
 * Elimina un contatto
 * 
 * GET /contacts/stats
 * Ottieni statistiche sui contatti
 * 
 * === GESTIONE LISTE ===
 * 
 * POST /lists/:listName/contacts/:id
 * Aggiunge un contatto a una lista
 * 
 * DELETE /lists/:listName/contacts/:id
 * Rimuove un contatto da una lista
 * 
 * === IMPORTAZIONE CSV ===
 * 
 * POST /contacts/import-csv?phase=analyze
 * Analizza un file CSV e restituisce le colonne disponibili
 * Form-data: csvFile (file CSV)
 * 
 * POST /contacts/import-csv?phase=import
 * Importa contatti con mappatura delle colonne
 * Form-data: 
 *   - csvFile (file CSV)
 *   - mapping (JSON object: { "colonnaCSV": "campoTarget" })
 *   - duplicateStrategy ("skip" | "update")
 * 
 * Esempi di mappatura:
 * {
 *   "Nome": "name",
 *   "Email": "email", 
 *   "Telefono": "phone",
 *   "Liste": "lists",
 *   "Azienda": "properties.company",
 *   "Note": "properties.notes",
 *   "ColonnaInutile": "ignore"
 * }
 */ 