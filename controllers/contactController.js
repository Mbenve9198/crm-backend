import Contact from '../models/contactModel.js';
import csv from 'csv-parser';
import fs from 'fs';
import { promisify } from 'util';

const readFile = promisify(fs.readFile);
const unlinkFile = promisify(fs.unlink);

/**
 * Controller per la gestione dei contatti in MenuChatCRM
 * Include operazioni CRUD e importazione CSV con mappatura dinamica
 */

/**
 * Crea un nuovo contatto
 * POST /contacts
 */
export const createContact = async (req, res) => {
  try {
    const { name, email, phone, lists = [], properties = {}, owner } = req.body;

    // Validazioni di base
    if (!name) {
      return res.status(400).json({
        success: false,
        message: 'Il nome è obbligatorio'
      });
    }

    // Controlla se esiste già un contatto con questa email (solo se email è fornita)
    if (email && email.trim()) {
      const existingContact = await Contact.findOne({ email: email.toLowerCase() });
      if (existingContact) {
        return res.status(409).json({
          success: false,
          message: 'Esiste già un contatto con questa email'
        });
      }
    }

    // Determina il proprietario del contatto
    let contactOwner = owner || req.user._id;
    
    // Solo admin e manager possono assegnare contatti ad altri utenti
    if (owner && owner !== req.user._id.toString() && !req.user.hasRole('manager')) {
      return res.status(403).json({
        success: false,
        message: 'Non hai i permessi per assegnare contatti ad altri utenti'
      });
    }

    // Crea il nuovo contatto
    const contact = new Contact({
      name,
      email: email.toLowerCase(),
      phone,
      lists,
      properties,
      owner: contactOwner,
      createdBy: req.user._id
    });

    await contact.save();
    
    // Aggiorna statistiche dell'owner
    await req.user.updateStats({ newContact: true });
    await req.user.save();

    res.status(201).json({
      success: true,
      message: 'Contatto creato con successo',
      data: contact
    });

  } catch (error) {
    console.error('Errore nella creazione del contatto:', error);
    res.status(500).json({
      success: false,
      message: 'Errore interno del server',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * Ottieni tutti i contatti o filtrati per lista
 * GET /contacts?list=nomeLista
 */
export const getContacts = async (req, res) => {
  try {
    const { list, page = 1, limit = 10, search, owner } = req.query;
    const skip = (page - 1) * limit;

    // Costruisce il filtro di ricerca
    let filter = {};
    
    // Filtro per ownership basato sui permessi
    if (req.user.role === 'agent') {
      // Gli agent vedono solo i loro contatti
      filter.owner = req.user._id;
    } else if (req.user.hasRole('manager')) {
      // Manager e admin possono filtrare per owner specifico
      if (owner) {
        filter.owner = owner;
      }
      // Altrimenti vedono tutti i contatti
    }
    
    if (list) {
      filter.lists = list;
    }

    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } }
      ];
    }

    // Esegue la query con paginazione e popolamento
    const contacts = await Contact.find(filter)
      .select('+properties') // Forza l'inclusione del campo properties
      .populate('owner', 'firstName lastName email role')
      .populate('createdBy', 'firstName lastName email')
      .skip(skip)
      .limit(parseInt(limit))
      .sort({ createdAt: -1 });

    // Debug: verifica se i contatti hanno il campo properties
    console.log('🔍 Debug contatti - primi 2 con properties:');
    contacts.slice(0, 2).forEach((contact, i) => {
      console.log(`Contatto ${i+1}: ${contact.name}`);
      console.log(`  Properties presente: ${!!contact.properties}`);
      console.log(`  Properties keys: ${Object.keys(contact.properties || {})}`);
      console.log(`  Properties content:`, contact.properties);
    });

    const total = await Contact.countDocuments(filter);

    res.json({
      success: true,
      data: {
        contacts,
        pagination: {
          currentPage: parseInt(page),
          totalPages: Math.ceil(total / limit),
          totalContacts: total,
          hasNext: skip + contacts.length < total,
          hasPrev: page > 1
        }
      }
    });

  } catch (error) {
    console.error('Errore nel recupero dei contatti:', error);
    res.status(500).json({
      success: false,
      message: 'Errore interno del server',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * Ottieni un contatto per ID
 * GET /contacts/:id
 */
export const getContactById = async (req, res) => {
  try {
    const { id } = req.params;

    const contact = await Contact.findById(id)
      .select('+properties') // Forza l'inclusione del campo properties
      .populate('owner', 'firstName lastName email role')
      .populate('createdBy', 'firstName lastName email')
      .populate('lastModifiedBy', 'firstName lastName email');
      
    if (!contact) {
      return res.status(404).json({
        success: false,
        message: 'Contatto non trovato'
      });
    }

    // Verifica permessi di accesso
    if (!req.user.canAccessContact(contact)) {
      return res.status(403).json({
        success: false,
        message: 'Non hai i permessi per accedere a questo contatto'
      });
    }

    res.json({
      success: true,
      data: contact
    });

  } catch (error) {
    console.error('Errore nel recupero del contatto:', error);
    if (error.name === 'CastError') {
      return res.status(400).json({
        success: false,
        message: 'ID contatto non valido'
      });
    }
    res.status(500).json({
      success: false,
      message: 'Errore interno del server'
    });
  }
};

/**
 * Aggiorna un contatto
 * PUT /contacts/:id
 */
export const updateContact = async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;

    // Trova il contatto esistente per verificare i permessi
    const existingContact = await Contact.findById(id);
    if (!existingContact) {
      return res.status(404).json({
        success: false,
        message: 'Contatto non trovato'
      });
    }

    // Verifica permessi di modifica
    if (!req.user.canModifyContact(existingContact)) {
      return res.status(403).json({
        success: false,
        message: 'Non hai i permessi per modificare questo contatto'
      });
    }

    // Rimuove campi che non dovrebbero essere aggiornati direttamente
    delete updates._id;
    delete updates.createdBy;
    delete updates.createdAt;

    // Gestisce il cambio di owner (solo manager/admin)
    if (updates.owner && updates.owner !== existingContact.owner.toString()) {
      if (!req.user.hasRole('manager')) {
        return res.status(403).json({
          success: false,
          message: 'Non hai i permessi per trasferire la ownership del contatto'
        });
      }
    }

    // Aggiunge il campo lastModifiedBy
    updates.lastModifiedBy = req.user._id;

    const contact = await Contact.findByIdAndUpdate(
      id,
      updates,
      { new: true, runValidators: true }
    )
    .populate('owner', 'firstName lastName email role')
    .populate('createdBy', 'firstName lastName email')
    .populate('lastModifiedBy', 'firstName lastName email');

    res.json({
      success: true,
      message: 'Contatto aggiornato con successo',
      data: contact
    });

  } catch (error) {
    console.error('Errore nell\'aggiornamento del contatto:', error);
    if (error.name === 'CastError') {
      return res.status(400).json({
        success: false,
        message: 'ID contatto non valido'
      });
    }
    if (error.code === 11000) {
      return res.status(409).json({
        success: false,
        message: 'Email già esistente'
      });
    }
    res.status(500).json({
      success: false,
      message: 'Errore interno del server'
    });
  }
};

/**
 * Elimina un contatto
 * DELETE /contacts/:id
 */
export const deleteContact = async (req, res) => {
  try {
    const { id } = req.params;

    // Trova il contatto per verificare i permessi
    const contact = await Contact.findById(id);
    if (!contact) {
      return res.status(404).json({
        success: false,
        message: 'Contatto non trovato'
      });
    }

    // Verifica permessi di eliminazione
    if (!req.user.canModifyContact(contact)) {
      return res.status(403).json({
        success: false,
        message: 'Non hai i permessi per eliminare questo contatto'
      });
    }

    await Contact.findByIdAndDelete(id);

    res.json({
      success: true,
      message: 'Contatto eliminato con successo'
    });

  } catch (error) {
    console.error('Errore nell\'eliminazione del contatto:', error);
    if (error.name === 'CastError') {
      return res.status(400).json({
        success: false,
        message: 'ID contatto non valido'
      });
    }
    res.status(500).json({
      success: false,
      message: 'Errore interno del server'
    });
  }
};

/**
 * Elimina più contatti in bulk
 * DELETE /contacts/bulk
 */
export const deleteContactsBulk = async (req, res) => {
  try {
    const { contactIds } = req.body;

    // Validazioni di base
    if (!contactIds || !Array.isArray(contactIds) || contactIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Array di ID contatti richiesto'
      });
    }

    if (contactIds.length > 100) {
      return res.status(400).json({
        success: false,
        message: 'Massimo 100 contatti per operazione bulk'
      });
    }

    // Trova tutti i contatti per verificare i permessi
    const contacts = await Contact.find({ _id: { $in: contactIds } });
    
    if (contacts.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Nessun contatto trovato con gli ID forniti'
      });
    }

    // Verifica permessi per ogni contatto
    const unauthorizedContacts = [];
    const authorizedContactIds = [];

    contacts.forEach(contact => {
      if (req.user.canModifyContact(contact)) {
        authorizedContactIds.push(contact._id);
      } else {
        unauthorizedContacts.push(contact.name);
      }
    });

    if (authorizedContactIds.length === 0) {
      return res.status(403).json({
        success: false,
        message: 'Non hai i permessi per eliminare nessuno dei contatti selezionati'
      });
    }

    // Elimina i contatti autorizzati
    const result = await Contact.deleteMany({ _id: { $in: authorizedContactIds } });

    console.log(`🗑️ Eliminazione bulk: ${result.deletedCount} contatti eliminati da utente ${req.user.email}`);

    res.json({
      success: true,
      message: `Eliminazione bulk completata`,
      data: {
        deletedCount: result.deletedCount,
        requestedCount: contactIds.length,
        unauthorizedCount: unauthorizedContacts.length,
        unauthorizedContacts: unauthorizedContacts.slice(0, 5), // Mostra max 5 nomi
        hasMoreUnauthorized: unauthorizedContacts.length > 5
      }
    });

  } catch (error) {
    console.error('Errore nell\'eliminazione bulk:', error);
    res.status(500).json({
      success: false,
      message: 'Errore interno del server'
    });
  }
};

/**
 * Aggiunge un contatto a una lista
 * POST /lists/:listName/contacts/:id
 */
export const addContactToList = async (req, res) => {
  try {
    const { listName, id } = req.params;

    const contact = await Contact.findById(id);
    if (!contact) {
      return res.status(404).json({
        success: false,
        message: 'Contatto non trovato'
      });
    }

    const wasAdded = contact.addToList(listName);
    await contact.save();

    res.json({
      success: true,
      message: wasAdded 
        ? `Contatto aggiunto alla lista "${listName}"` 
        : `Contatto già presente nella lista "${listName}"`,
      data: contact
    });

  } catch (error) {
    console.error('Errore nell\'aggiunta del contatto alla lista:', error);
    res.status(500).json({
      success: false,
      message: 'Errore interno del server'
    });
  }
};

/**
 * Rimuove un contatto da una lista
 * DELETE /lists/:listName/contacts/:id
 */
export const removeContactFromList = async (req, res) => {
  try {
    const { listName, id } = req.params;

    const contact = await Contact.findById(id);
    if (!contact) {
      return res.status(404).json({
        success: false,
        message: 'Contatto non trovato'
      });
    }

    const wasRemoved = contact.removeFromList(listName);
    await contact.save();

    res.json({
      success: true,
      message: wasRemoved 
        ? `Contatto rimosso dalla lista "${listName}"` 
        : `Contatto non era presente nella lista "${listName}"`,
      data: contact
    });

  } catch (error) {
    console.error('Errore nella rimozione del contatto dalla lista:', error);
    res.status(500).json({
      success: false,
      message: 'Errore interno del server'
    });
  }
};

/**
 * Ottiene tutte le liste disponibili con conteggio contatti
 * GET /contacts/lists
 */
export const getContactLists = async (req, res) => {
  try {
    // Costruisce il filtro di ricerca basato sui permessi
    let filter = {};
    
    // Filtro per ownership basato sui permessi
    if (req.user.role === 'agent') {
      // Gli agent vedono solo i loro contatti
      filter.owner = req.user._id;
    } else if (req.user.hasRole('manager')) {
      // Manager e admin possono vedere tutti i contatti
      // Nessun filtro aggiuntivo necessario
    }

    // Aggrega le liste con conteggio contatti
    const listsAggregation = await Contact.aggregate([
      // Filtra i contatti in base ai permessi
      { $match: filter },
      
      // Espande l'array lists per processare ogni lista separatamente
      { $unwind: '$lists' },
      
      // Raggruppa per nome lista e conta i contatti
      {
        $group: {
          _id: '$lists',
          count: { $sum: 1 }
        }
      },
      
      // Ordina alfabeticamente per nome lista
      { $sort: { _id: 1 } },
      
      // Rinomina il campo _id in name per chiarezza
      {
        $project: {
          name: '$_id',
          count: 1,
          _id: 0
        }
      }
    ]);

    console.log('📋 Liste trovate:', listsAggregation);

    res.json({
      success: true,
      data: listsAggregation,
      message: `Trovate ${listsAggregation.length} liste`
    });

  } catch (error) {
    console.error('Errore nel recupero delle liste:', error);
    res.status(500).json({
      success: false,
      message: 'Errore interno del server'
    });
  }
};

/**
 * Aggiunge contatti multipli a una lista
 * POST /contacts/lists/:listName/bulk-add
 */
export const addContactsToListBulk = async (req, res) => {
  try {
    const { listName } = req.params;
    const { contactIds } = req.body;

    if (!contactIds || !Array.isArray(contactIds) || contactIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Array di ID contatti richiesto'
      });
    }

    // Trova i contatti che l'utente può modificare
    let filter = { _id: { $in: contactIds } };
    
    // Permessi: agent può modificare solo i propri contatti
    if (req.user.role === 'agent') {
      filter.owner = req.user._id;
    }

    const contacts = await Contact.find(filter);

    if (contacts.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Nessun contatto trovato o permessi insufficienti'
      });
    }

    let addedCount = 0;
    let alreadyInList = 0;

    // Aggiunge ogni contatto alla lista
    for (const contact of contacts) {
      const wasAdded = contact.addToList(listName);
      if (wasAdded) {
        addedCount++;
        await contact.save();
      } else {
        alreadyInList++;
      }
    }

    res.json({
      success: true,
      message: `${addedCount} contatti aggiunti alla lista "${listName}". ${alreadyInList} erano già presenti.`,
      data: {
        addedCount,
        alreadyInList,
        totalProcessed: contacts.length,
        totalRequested: contactIds.length
      }
    });

  } catch (error) {
    console.error('Errore nell\'aggiunta bulk alla lista:', error);
    res.status(500).json({
      success: false,
      message: 'Errore interno del server'
    });
  }
};

/**
 * IMPORTAZIONE CSV CON MAPPATURA DINAMICA
 * Gestisce l'importazione di contatti da file CSV in due fasi:
 * 1. Analisi preliminare del CSV e restituzione delle colonne
 * 2. Importazione effettiva con mappatura fornita dall'utente
 */

/**
 * Fase 1: Analizza il CSV e restituisce le colonne disponibili
 * POST /contacts/import-csv?phase=analyze
 */
export const analyzeCsvFile = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'Nessun file CSV fornito'
      });
    }

    const results = [];
    let headers = null;

    // Legge solo le prime righe per analizzare la struttura
    fs.createReadStream(req.file.path)
      .pipe(csv())
      .on('headers', (headerList) => {
        headers = headerList;
      })
      .on('data', (data) => {
        if (results.length < 5) { // Legge solo le prime 5 righe come esempio
          results.push(data);
        }
      })
      .on('end', async () => {
        // Pulisce il file temporaneo
        await unlinkFile(req.file.path);

        res.json({
          success: true,
          data: {
            headers,
            sampleRows: results,
            totalPreviewRows: results.length,
            availableFields: {
              existing: ['name', 'email', 'phone', 'lists'],
              properties: 'Puoi creare nuove proprietà dinamiche usando il formato "properties.nomeProprietà"'
            },
            mappingInstructions: {
              'name': 'Campo nome del contatto (obbligatorio)',
              'email': 'Campo email (opzionale ma unico se fornito)',
              'phone': 'Campo telefono (opzionale)',
              'lists': 'Liste separate da virgola (es: "lista1,lista2")',
              'properties.company': 'Esempio: crea proprietà "company"',
              'properties.customField': 'Esempio: crea proprietà personalizzata',
              'ignore': 'Ignora questa colonna'
            }
          }
        });
      })
      .on('error', async (error) => {
        console.error('Errore nell\'analisi del CSV:', error);
        await unlinkFile(req.file.path);
        res.status(400).json({
          success: false,
          message: 'Errore nell\'analisi del file CSV'
        });
      });

  } catch (error) {
    console.error('Errore nell\'analisi del CSV:', error);
    res.status(500).json({
      success: false,
      message: 'Errore interno del server'
    });
  }
};

/**
 * Fase 2: Importa il CSV con la mappatura fornita
 * POST /contacts/import-csv?phase=import
 */
export const importCsvFile = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'Nessun file CSV fornito'
      });
    }

    const { mapping, duplicateStrategy = 'skip' } = req.body;
    
    if (!mapping) {
      return res.status(400).json({
        success: false,
        message: 'Mappatura delle colonne richiesta'
      });
    }

    const parsedMapping = typeof mapping === 'string' ? JSON.parse(mapping) : mapping;
    const results = [];
    const errors = [];
    let processedCount = 0;
    let skippedCount = 0;
    let createdCount = 0;
    let updatedCount = 0;

    fs.createReadStream(req.file.path)
      .pipe(csv())
      .on('data', async (row) => {
        try {
          processedCount++;
          const contactData = {
            properties: {}
          };

          // Applica la mappatura
          for (const [csvColumn, targetField] of Object.entries(parsedMapping)) {
            if (targetField === 'ignore' || !row[csvColumn]) continue;

            const value = row[csvColumn].trim();
            if (!value) continue;

            if (targetField === 'lists') {
              // Gestisce le liste separate da virgola
              contactData.lists = value.split(',').map(list => list.trim()).filter(Boolean);
            } else if (targetField.startsWith('properties.')) {
              // Gestisce le proprietà dinamiche
              const propertyKey = targetField.replace('properties.', '');
              contactData.properties[propertyKey] = value;
            } else {
              // Gestisce i campi standard
              contactData[targetField] = value;
            }
          }

          // Validazioni di base
          if (!contactData.name) {
            errors.push({
              row: processedCount,
              error: 'Il nome è obbligatorio',
              data: row
            });
            return;
          }

          // Gestisce i duplicati (solo se email è fornita)
          let existingContact = null;
          if (contactData.email && contactData.email.trim()) {
            existingContact = await Contact.findOne({ 
              email: contactData.email.toLowerCase() 
            });
          }

          if (existingContact) {
            if (duplicateStrategy === 'skip') {
              skippedCount++;
              return;
            } else if (duplicateStrategy === 'update') {
              // Aggiorna il contatto esistente
              Object.assign(existingContact, contactData);
              await existingContact.save();
              updatedCount++;
              return;
            }
          }

          // Crea nuovo contatto con owner
          contactData.owner = req.user._id;
          contactData.createdBy = req.user._id;
          
          const contact = new Contact(contactData);
          await contact.save();
          createdCount++;

        } catch (error) {
          errors.push({
            row: processedCount,
            error: error.message,
            data: row
          });
        }
      })
      .on('end', async () => {
        // Pulisce il file temporaneo
        await unlinkFile(req.file.path);

        res.json({
          success: true,
          message: 'Importazione CSV completata',
          data: {
            summary: {
              totalProcessed: processedCount,
              created: createdCount,
              updated: updatedCount,
              skipped: skippedCount,
              errors: errors.length
            },
            errors: errors.slice(0, 10), // Mostra solo i primi 10 errori
            duplicateStrategy
          }
        });
      })
      .on('error', async (error) => {
        console.error('Errore nell\'importazione del CSV:', error);
        await unlinkFile(req.file.path);
        res.status(400).json({
          success: false,
          message: 'Errore nell\'importazione del file CSV'
        });
      });

  } catch (error) {
    console.error('Errore nell\'importazione del CSV:', error);
    res.status(500).json({
      success: false,
      message: 'Errore interno del server'
    });
  }
};

/**
 * Endpoint principale per l'importazione CSV
 * Gestisce entrambe le fasi in base al parametro 'phase'
 * POST /contacts/import-csv
 */
export const handleCsvImport = async (req, res) => {
  const phase = req.query.phase || 'analyze';
  
  if (phase === 'analyze') {
    return analyzeCsvFile(req, res);
  } else if (phase === 'import') {
    return importCsvFile(req, res);
  } else {
    return res.status(400).json({
      success: false,
      message: 'Fase non valida. Utilizzare "analyze" o "import"'
    });
  }
};

/**
 * Ottieni statistiche sui contatti
 * GET /contacts/stats
 */
export const getContactStats = async (req, res) => {
  try {
    const totalContacts = await Contact.countDocuments();
    
    // Conta contatti per lista
    const listStats = await Contact.aggregate([
      { $unwind: '$lists' },
      { $group: { _id: '$lists', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 10 }
    ]);

    // Conta per proprietà più comuni
    const propertyStats = await Contact.aggregate([
      { $project: { properties: { $objectToArray: '$properties' } } },
      { $unwind: '$properties' },
      { $group: { _id: '$properties.k', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 10 }
    ]);

    res.json({
      success: true,
      data: {
        totalContacts,
        listStats,
        propertyStats,
        lastUpdated: new Date()
      }
    });

  } catch (error) {
    console.error('Errore nel recupero delle statistiche:', error);
    res.status(500).json({
      success: false,
      message: 'Errore interno del server'
    });
  }
}; 

/**
 * Ottieni tutte le proprietà dinamiche disponibili
 * GET /contacts/dynamic-properties
 */
export const getDynamicProperties = async (req, res) => {
  try {
    // Ottieni tutte le proprietà dinamiche uniche dal database
    const propertyKeys = await Contact.aggregate([
      { $match: { properties: { $exists: true, $ne: null } } },
      { $project: { properties: { $objectToArray: '$properties' } } },
      { $unwind: '$properties' },
      { $group: { _id: '$properties.k' } },
      { $sort: { _id: 1 } }
    ]);

    const properties = propertyKeys.map(item => item._id).filter(Boolean);

    console.log('🔍 Proprietà dinamiche trovate:', properties);

    res.json({
      success: true,
      data: {
        properties,
        count: properties.length,
        lastUpdated: new Date()
      }
    });

  } catch (error) {
    console.error('Errore nel recupero delle proprietà dinamiche:', error);
    res.status(500).json({
      success: false,
      message: 'Errore interno del server'
    });
  }
};

/**
 * Aggiorna lo status di un contatto e crea activity automatica
 * PUT /contacts/:id/status
 */
export const updateContactStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, mrr } = req.body;

    // Validazioni di base
    if (!status) {
      return res.status(400).json({
        success: false,
        message: 'Lo status è obbligatorio'
      });
    }

    const validStatuses = ['da contattare', 'contattato', 'da richiamare', 'interessato', 'qr code inviato', 'free trial iniziato', 'won', 'lost'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'Status non valido'
      });
    }

    // Trova il contatto
    const contact = await Contact.findById(id);
    if (!contact) {
      return res.status(404).json({
        success: false,
        message: 'Contatto non trovato'
      });
    }

    // Verifica permessi
    if (req.user.role === 'agent' && contact.owner.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Non hai i permessi per modificare questo contatto'
      });
    }

    // Valida MRR per stati pipeline
    const pipelineStatuses = ['interessato', 'qr code inviato', 'free trial iniziato', 'won', 'lost'];
    if (pipelineStatuses.includes(status)) {
      if (mrr === undefined || mrr === null) {
        return res.status(400).json({
          success: false,
          message: 'MRR è obbligatorio per stati pipeline'
        });
      }
      if (mrr < 0) {
        return res.status(400).json({
          success: false,
          message: 'MRR non può essere negativo'
        });
      }
    }

    // Salva lo status precedente per l'activity
    const oldStatus = contact.status;

    // Aggiorna il contatto
    contact.status = status;
    if (mrr !== undefined) {
      contact.mrr = mrr;
    }
    contact.lastModifiedBy = req.user._id;

    await contact.save();

    // Crea activity automatica per il cambio stato se diverso
    if (oldStatus !== status) {
      const Activity = (await import('../models/activityModel.js')).default;
      
      const activity = new Activity({
        contact: contact._id,
        type: 'status_change',
        title: `Stato cambiato: ${oldStatus} → ${status}`,
        description: mrr ? `MRR impostato: €${mrr}` : undefined,
        data: {
          statusChange: {
            oldStatus,
            newStatus: status,
            mrr
          }
        },
        createdBy: req.user._id
      });

      await activity.save();
    }

    // Popola i dati per la risposta
    await contact.populate('owner', 'firstName lastName email role');

    res.json({
      success: true,
      message: 'Status aggiornato con successo',
      data: contact
    });

  } catch (error) {
    console.error('Errore nell\'aggiornamento status:', error);
    
    if (error.name === 'ValidationError') {
      return res.status(400).json({
        success: false,
        message: error.message
      });
    }

    res.status(500).json({
      success: false,
      message: 'Errore interno del server'
    });
  }
}; 