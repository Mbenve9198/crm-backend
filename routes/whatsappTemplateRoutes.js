import express from 'express';
import { 
  getWhatsAppTemplate, 
  updateWhatsAppTemplate, 
  compileWhatsAppTemplate,
  getAvailableVariables 
} from '../controllers/whatsappTemplateController.js';
import { protect } from '../controllers/authController.js';

const router = express.Router();

// Tutte le routes richiedono autenticazione
router.use(protect);

// Routes per template WhatsApp
router.get('/whatsapp-template', getWhatsAppTemplate);
router.put('/whatsapp-template', updateWhatsAppTemplate);
router.post('/whatsapp-template/compile', compileWhatsAppTemplate);
router.get('/whatsapp-template/variables', getAvailableVariables);

export default router;

/**
 * DOCUMENTAZIONE ROUTES TEMPLATE WHATSAPP
 * 
 * === ROUTES AUTENTICATE ===
 * 
 * GET /settings/whatsapp-template
 * Ottieni template WhatsApp dell'utente corrente
 * Response: {
 *   success: true,
 *   data: {
 *     message: string,
 *     variables: string[],
 *     updatedAt: date
 *   }
 * }
 * 
 * PUT /settings/whatsapp-template
 * Aggiorna template WhatsApp dell'utente
 * Body: {
 *   message: string (required, max 1000 chars)
 * }
 * Response: {
 *   success: true,
 *   message: string,
 *   data: {
 *     message: string,
 *     variables: string[],
 *     updatedAt: date
 *   }
 * }
 * 
 * POST /settings/whatsapp-template/compile
 * Compila template con dati contatto
 * Body: {
 *   contactId: string (required)
 * }
 * Response: {
 *   success: true,
 *   data: {
 *     originalMessage: string,
 *     compiledMessage: string,
 *     variables: string[],
 *     replacementData: object,
 *     missingVariables: string[]
 *   }
 * }
 * 
 * GET /settings/whatsapp-template/variables
 * Ottieni variabili disponibili per template
 * Response: {
 *   success: true,
 *   data: {
 *     fixed: [{ key: string, description: string }],
 *     dynamic: [{ key: string, description: string }]
 *   }
 * }
 * 
 * === ESEMPI D'USO ===
 * 
 * // Aggiorna template
 * curl -X PUT http://localhost:3000/api/settings/whatsapp-template \
 *   -H "Authorization: Bearer YOUR_JWT_TOKEN" \
 *   -H "Content-Type: application/json" \
 *   -d '{
 *     "message": "Ciao {nome}, sono {utente} da {azienda}. Ti contatto per {motivo}."
 *   }'
 * 
 * // Compila template per contatto specifico
 * curl -X POST http://localhost:3000/api/settings/whatsapp-template/compile \
 *   -H "Authorization: Bearer YOUR_JWT_TOKEN" \
 *   -H "Content-Type: application/json" \
 *   -d '{
 *     "contactId": "CONTACT_ID"
 *   }'
 * 
 * // Ottieni variabili disponibili
 * curl -X GET http://localhost:3000/api/settings/whatsapp-template/variables \
 *   -H "Authorization: Bearer YOUR_JWT_TOKEN"
 * 
 * === VARIABILI TEMPLATE ===
 * 
 * Variabili fisse disponibili:
 * - {nome}: Nome del contatto
 * - {email}: Email del contatto
 * - {telefono}: Numero di telefono del contatto
 * - {utente}: Nome completo dell'utente corrente
 * - {azienda}: Dipartimento o azienda dell'utente
 * 
 * Variabili dinamiche:
 * - Tutte le proprietà dinamiche dei contatti sono disponibili
 * - Esempio: se un contatto ha proprietà "azienda", puoi usare {azienda}
 * 
 * === CODICI DI ERRORE ===
 * 
 * 400: Template non valido, messaggio troppo lungo o dati mancanti
 * 401: Non autenticato
 * 404: Utente o contatto non trovato
 * 500: Errore interno del server
 */
