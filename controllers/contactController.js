import Contact from '../models/contactModel.js';
import mongoose from 'mongoose';
import csv from 'csv-parser';
import fs from 'fs';
import { promisify } from 'util';
import User from '../models/userModel.js'; // Added import for User
import Activity from '../models/activityModel.js';
import claudeService from '../services/claudeService.js'; // Per generazione script AI

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
 * Mappa una colonna frontend al campo MongoDB corrispondente
 */
const mapColumnToField = (column) => {
  const columnMapping = {
    'Contact': 'name',
    'Email': 'email',
    'Phone': 'phone',
    'Owner': 'owner', // Nota: questo richiederà join logic
    'Lists': 'lists',
    'Created': 'createdAt',
    'Status': 'status'
  };

  // Proprietà dinamiche (formato: prop_nomeProprietà)
  if (column.startsWith('prop_')) {
    const propName = column.replace('prop_', '');
    return `properties.${propName}`;
  }

  return columnMapping[column] || column.toLowerCase();
};

/**
 * Costruisce un filtro MongoDB da un filtro di colonna frontend
 */
const buildMongoFilter = (column, columnFilter) => {
  const field = mapColumnToField(column);
  
  if (columnFilter.type === 'value') {
    // Filtro per valori specifici
    if (columnFilter.values && columnFilter.values.length > 0) {
      return { [field]: { $in: columnFilter.values } };
    }
    return null;
  }
  
  if (columnFilter.type === 'condition' && columnFilter.condition) {
    const { type, value } = columnFilter.condition;
    
    switch (type) {
      case 'equals':
        return { [field]: value };
      
      case 'not_equals':
        return { [field]: { $ne: value } };
      
      case 'contains':
        return { [field]: { $regex: value, $options: 'i' } };
      
      case 'not_contains':
        return { [field]: { $not: { $regex: value, $options: 'i' } } };
      
      case 'starts_with':
        return { [field]: { $regex: `^${value}`, $options: 'i' } };
      
      case 'is_empty':
        return { 
          $or: [
            { [field]: { $exists: false } },
            { [field]: null },
            { [field]: '' }
          ]
        };
      
      case 'is_not_empty':
        return { 
          [field]: { 
            $exists: true, 
            $ne: null, 
            $ne: '' 
          }
        };
      
      default:
        console.warn(`⚠️ Tipo di filtro non supportato: ${type}`);
        return null;
    }
  }
  
  return null;
};

/**
 * Ottieni tutti i contatti o filtrati per lista
 * GET /contacts?list=nomeLista
 */
export const getContacts = async (req, res) => {
  try {
    const { 
      list, 
      page = 1, 
      limit = 10, 
      search, 
      owner, 
      sort_by, 
      sort_direction,
      column_filters 
    } = req.query;
    const skip = (page - 1) * limit;

    // Costruisce il filtro di ricerca
    let filter = {};
    
    // Filtro per ownership basato sui permessi
    if (req.user.role === 'agent') {
      // Gli agent vedono solo i loro contatti
      filter.owner = req.user._id;
    } else if (req.user.role === 'manager' || req.user.role === 'admin') {
      // Manager e admin possono filtrare per owner specifico O vedere tutti
      if (owner && owner !== 'all') {
        filter.owner = owner;
      }
      // Se owner è 'all' o undefined, non aggiungere filtro owner (vedono tutti)
    } else {
      // Viewer o altri ruoli - vedono solo i loro contatti per sicurezza
      filter.owner = req.user._id;
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

    // Processa i filtri di colonna avanzati
    if (column_filters) {
      try {
        const columnFilters = typeof column_filters === 'string' 
          ? JSON.parse(column_filters) 
          : column_filters;

        for (const [column, columnFilter] of Object.entries(columnFilters)) {
          const mongoFilter = buildMongoFilter(column, columnFilter);
          if (mongoFilter) {
            Object.assign(filter, mongoFilter);
          }
        }
      } catch (error) {
        console.warn('⚠️ Errore nel parsing dei filtri di colonna:', error.message);
      }
    }

    // Costruisce l'ordinamento
    // Default: updatedAt per far risalire in cima i lead che ricevono interazioni inbound
    let sortOptions = { updatedAt: -1 };
    if (sort_by && sort_direction) {
      const sortField = mapColumnToField(sort_by);
      const sortDir = sort_direction === 'desc' ? -1 : 1;
      sortOptions = { [sortField]: sortDir };
    }

    // Esegue la query con paginazione e popolamento
    const contacts = await Contact.find(filter)
      .select('+properties') // Forza l'inclusione del campo properties
      .populate('owner', 'firstName lastName email role')
      .populate('createdBy', 'firstName lastName email')
      .skip(skip)
      .limit(parseInt(limit))
      .sort(sortOptions);

    const total = await Contact.countDocuments(filter);

    // Debug: mostra i filtri applicati e i risultati
    console.log('🔍 Debug query contatti:');
    console.log('  Filtri applicati:', JSON.stringify(filter, null, 2));
    console.log('  Ordinamento:', JSON.stringify(sortOptions, null, 2));
    console.log(`  Risultati: ${contacts.length}/${total} contatti`);

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
    if (updates.owner && updates.owner !== existingContact.owner?.toString()) {
      if (!req.user.hasRole('manager')) {
        return res.status(403).json({
          success: false,
          message: 'Non hai i permessi per trasferire la ownership del contatto'
        });
      }
    }

    // Aggiunge il campo lastModifiedBy
    updates.lastModifiedBy = req.user._id;

    // 🆕 Controlla se lo status sta cambiando verso uno stato positivo
    const positiveStatuses = ['interessato', 'qr code inviato', 'free trial iniziato', 'won'];
    const oldStatus = existingContact.status;
    const newStatus = updates.status;
    const isStatusChangingToPositive = newStatus && 
                                        positiveStatuses.includes(newStatus) && 
                                        oldStatus !== newStatus;

    const contact = await Contact.findByIdAndUpdate(
      id,
      updates,
      { new: true, runValidators: true }
    )
    .populate('owner', 'firstName lastName email role')
    .populate('createdBy', 'firstName lastName email')
    .populate('lastModifiedBy', 'firstName lastName email');

    // 🆕 Se status cambia a positivo e il contatto ha email, ferma sequenza SOAP OPERA
    if (isStatusChangingToPositive && contact.email) {
      try {
        const menuchatBackendUrl = process.env.MENUCHAT_BACKEND_URL || 'https://menuchat-backend.onrender.com';
        const response = await fetch(`${menuchatBackendUrl}/api/rank-checker-leads/stop-sequence`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-API-Key': process.env.MENUCHAT_API_KEY || ''
          },
          body: JSON.stringify({
            email: contact.email,
            reason: `CRM status cambiato a "${newStatus}"`,
            crmContactId: contact._id.toString(),
            newStatus: newStatus
          })
        });
        
        const result = await response.json();
        if (result.success && result.leadFound) {
          console.log(`🛑 Sequenza SOAP OPERA fermata per ${contact.email} (status: ${newStatus})`);
        }
      } catch (webhookError) {
        // Non bloccare l'update se il webhook fallisce
        console.warn(`⚠️ Errore webhook stop-sequence per ${contact.email}:`, webhookError.message);
      }
    }

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

    // Limite ragionevole per evitare sovraccarico del server (massimo 10,000 contatti)
    if (contactIds.length > 10000) {
      return res.status(400).json({
        success: false,
        message: 'Massimo 10,000 contatti per operazione di eliminazione massiva. Per operazioni più grandi, contattare l\'amministratore.'
      });
    }

    // Log per operazioni massive
    if (contactIds.length > 1000) {
      console.log(`⚠️ Eliminazione massiva richiesta: ${contactIds.length} contatti da utente ${req.user.email}`);
    }

    // Per operazioni grandi, elabora a batch per evitare timeout
    const batchSize = 1000;
    let totalDeleted = 0;
    let totalUnauthorized = 0;
    const unauthorizedContacts = [];

    // Elabora gli ID a batch
    for (let i = 0; i < contactIds.length; i += batchSize) {
      const batch = contactIds.slice(i, i + batchSize);
      
      // Trova i contatti del batch e verifica permessi
      const contacts = await Contact.find({ _id: { $in: batch } });
      
      const authorizedContactIds = [];
      
      contacts.forEach(contact => {
        if (req.user.canModifyContact(contact)) {
          authorizedContactIds.push(contact._id);
        } else {
          unauthorizedContacts.push(contact.name);
          totalUnauthorized++;
        }
      });

      // Elimina i contatti autorizzati del batch
      if (authorizedContactIds.length > 0) {
        const result = await Contact.deleteMany({ _id: { $in: authorizedContactIds } });
        totalDeleted += result.deletedCount;
        
        console.log(`🗑️ Batch ${Math.floor(i / batchSize) + 1}: ${result.deletedCount} contatti eliminati`);
      }
    }

    if (totalDeleted === 0) {
      return res.status(403).json({
        success: false,
        message: 'Non hai i permessi per eliminare nessuno dei contatti selezionati'
      });
    }

    console.log(`🗑️ Eliminazione bulk completata: ${totalDeleted} contatti eliminati da utente ${req.user.email}`);

    res.json({
      success: true,
      message: `Eliminazione bulk completata: ${totalDeleted} contatti eliminati`,
      data: {
        deletedCount: totalDeleted,
        requestedCount: contactIds.length,
        unauthorizedCount: totalUnauthorized,
        unauthorizedContacts: unauthorizedContacts.slice(0, 5), // Mostra max 5 nomi
        hasMoreUnauthorized: unauthorizedContacts.length > 5,
        processedInBatches: contactIds.length > batchSize,
        batchSize: contactIds.length > batchSize ? batchSize : undefined
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
 * Elimina TUTTI i contatti dell'utente (operazione massiva)
 * DELETE /contacts/delete-all
 * ATTENZIONE: Operazione irreversibile
 */
export const deleteAllContacts = async (req, res) => {
  try {
    const { confirmText } = req.body;

    // Richiede conferma esplicita per evitare eliminazioni accidentali
    if (confirmText !== 'DELETE ALL CONTACTS') {
      return res.status(400).json({
        success: false,
        message: 'Per confermare l\'eliminazione di tutti i contatti, invia confirmText: "DELETE ALL CONTACTS"'
      });
    }

    // Costruisce il filtro basato sui permessi utente
    let filter = {};
    
    if (req.user.role === 'agent') {
      // Gli agent possono eliminare solo i propri contatti
      filter.owner = req.user._id;
    } else if (req.user.hasRole('manager')) {
      // Manager e admin possono scegliere se eliminare tutti o solo i propri
      if (req.body.onlyMyContacts) {
        filter.owner = req.user._id;
      }
      // Altrimenti elimina tutti i contatti nel sistema
    }

    // Prima conta quanti contatti verranno eliminati
    const countToDelete = await Contact.countDocuments(filter);
    
    if (countToDelete === 0) {
      return res.status(404).json({
        success: false,
        message: 'Nessun contatto da eliminare trovato'
      });
    }

    console.log(`⚠️ ELIMINAZIONE MASSIVA: ${req.user.email} sta per eliminare ${countToDelete} contatti`);

    // Procede con l'eliminazione
    const result = await Contact.deleteMany(filter);

    console.log(`🗑️ ELIMINAZIONE MASSIVA COMPLETATA: ${result.deletedCount} contatti eliminati da ${req.user.email}`);

    res.json({
      success: true,
      message: `Eliminazione massiva completata: ${result.deletedCount} contatti eliminati`,
      data: {
        deletedCount: result.deletedCount,
        estimatedCount: countToDelete,
        filter: req.user.role === 'agent' ? 'solo i tuoi contatti' : 
                req.body.onlyMyContacts ? 'solo i tuoi contatti' : 'tutti i contatti del sistema',
        timestamp: new Date().toISOString()
      }
    });

  } catch (error) {
    console.error('Errore nell\'eliminazione massiva:', error);
    res.status(500).json({
      success: false,
      message: 'Errore interno del server durante l\'eliminazione massiva'
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
 * Rimuove contatti multipli da una lista
 * POST /contacts/lists/:listName/bulk-remove
 */
export const removeContactsFromListBulk = async (req, res) => {
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

    let removedCount = 0;
    let notInList = 0;

    // Rimuove ogni contatto dalla lista
    for (const contact of contacts) {
      const wasRemoved = contact.removeFromList(listName);
      if (wasRemoved) {
        removedCount++;
        await contact.save();
      } else {
        notInList++;
      }
    }

    res.json({
      success: true,
      message: `${removedCount} contatti rimossi dalla lista "${listName}". ${notInList} non erano presenti nella lista.`,
      data: {
        removedCount,
        notInList,
        totalProcessed: contacts.length,
        totalRequested: contactIds.length
      }
    });

  } catch (error) {
    console.error('Errore nella rimozione bulk dalla lista:', error);
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
    const SAMPLE_SIZE = 5; // Numero di righe di esempio
    let streamDestroyed = false;

    // Legge solo le prime righe per analizzare la struttura
    const stream = fs.createReadStream(req.file.path);
    const csvStream = csv();
    
    stream
      .pipe(csvStream)
      .on('headers', (headerList) => {
        headers = headerList;
      })
      .on('data', (data) => {
        if (results.length < SAMPLE_SIZE) {
          results.push(data);
        } else if (!streamDestroyed) {
          // 🚀 OTTIMIZZAZIONE: Distruggi lo stream dopo aver letto le prime righe
          streamDestroyed = true;
          csvStream.destroy();
          stream.destroy();
        }
      })
      .on('end', async () => {
        await processAnalysisResults();
      })
      .on('close', async () => {
        // 🚀 Chiamato quando lo stream viene distrutto prematuramente
        if (streamDestroyed && results.length >= SAMPLE_SIZE) {
          await processAnalysisResults();
        }
      })
      .on('error', async (error) => {
        console.error('Errore nell\'analisi del CSV:', error);
        await unlinkFile(req.file.path);
        res.status(400).json({
          success: false,
          message: 'Errore nell\'analisi del file CSV'
        });
      });

    // 🚀 Funzione per processare i risultati (evita duplicazione codice)
    const processAnalysisResults = async () => {
        // Pulisce il file temporaneo
        await unlinkFile(req.file.path);

        // Recupera le proprietà dinamiche esistenti dal database
        let existingProperties = [];
        try {
          const propertyKeys = await Contact.aggregate([
            { $match: { properties: { $exists: true, $ne: null } } },
            { $project: { properties: { $objectToArray: '$properties' } } },
            { $unwind: '$properties' },
            { $group: { _id: '$properties.k' } },
            { $sort: { _id: 1 } }
          ]);
          existingProperties = propertyKeys.map(item => item._id).filter(Boolean);
        } catch (error) {
          console.warn('⚠️ Errore nel recupero delle proprietà dinamiche:', error.message);
        }

        // Costruisce le opzioni di mappatura
        const mappingInstructions = {
          'name': 'Campo nome del contatto (obbligatorio)',
          'email': 'Campo email (opzionale ma unico se fornito)',
          'phone': 'Campo telefono (opzionale)',
          'lists': 'Liste separate da virgola (es: "lista1,lista2")',
          'ignore': 'Ignora questa colonna'
        };

        // Aggiunge le proprietà dinamiche esistenti
        existingProperties.forEach(prop => {
          mappingInstructions[`properties.${prop}`] = `Proprietà esistente: ${prop}`;
        });

        // Aggiunge esempi per nuove proprietà
        mappingInstructions['properties.company'] = 'Esempio: crea proprietà "company"';
        mappingInstructions['properties.customField'] = 'Esempio: crea proprietà personalizzata';

        res.json({
          success: true,
          data: {
            headers,
            sampleRows: results,
            totalPreviewRows: results.length,
            availableFields: {
              fixed: ['name', 'email', 'phone', 'lists'],
              existingProperties: existingProperties,
              newProperties: 'Puoi creare nuove proprietà dinamiche usando il formato "properties.nomeProprietà"'
            },
            mappingInstructions,
            dynamicPropertiesInfo: {
              existing: existingProperties,
              count: existingProperties.length,
              usage: 'Usa "properties.nomeProp" per mappare alle proprietà esistenti o crearne di nuove'
            }
          }
        });
    };

  } catch (error) {
    console.error('Errore nell\'analisi del CSV:', error);
    
    // Gestione specifica per errori di permessi
    if (error.code === 'EACCES') {
      return res.status(500).json({
        success: false,
        message: 'Errore di permessi nel filesystem. Contattare l\'amministratore.',
        details: 'Il server non ha i permessi necessari per scrivere i file temporanei.'
      });
    }
    
    res.status(500).json({
      success: false,
      message: 'Errore interno del server',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
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

    const { mapping, duplicateStrategy = 'skip', targetList } = req.body;
    
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
    
    // 📋 NUOVO: Lista target per tutti i contatti importati
    const parsedTargetList = targetList && typeof targetList === 'string' ? targetList.trim() : null;
    console.log(`📋 Target list for import: ${parsedTargetList || 'none'}`);


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
              // Gestisce le liste separate da virgola dal CSV
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

          // 📋 NUOVO: Aggiungi targetList se specificata
          if (parsedTargetList) {
            if (!contactData.lists) {
              contactData.lists = [];
            }
            // Aggiungi targetList solo se non è già presente
            if (!contactData.lists.includes(parsedTargetList)) {
              contactData.lists.push(parsedTargetList);
            }
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
              
              // 📋 Aggiungi targetList anche al contatto esistente
              if (parsedTargetList && !existingContact.lists.includes(parsedTargetList)) {
                existingContact.lists.push(parsedTargetList);
              }
              
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
          message: parsedTargetList 
            ? `Importazione CSV completata. ${createdCount + updatedCount} contatti aggiunti alla lista "${parsedTargetList}"`
            : 'Importazione CSV completata',
          data: {
            summary: {
              totalProcessed: processedCount,
              created: createdCount,
              updated: updatedCount,
              skipped: skippedCount,
              errors: errors.length
            },
            errors: errors.slice(0, 10), // Mostra solo i primi 10 errori
            duplicateStrategy,
            targetList: parsedTargetList // 📋 Info sulla lista target
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
    
    // Gestione specifica per errori di permessi
    if (error.code === 'EACCES') {
      return res.status(500).json({
        success: false,
        message: 'Errore di permessi nel filesystem. Contattare l\'amministratore.',
        details: 'Il server non ha i permessi necessari per scrivere i file temporanei.'
      });
    }
    
    res.status(500).json({
      success: false,
      message: 'Errore interno del server',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
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
 * Analytics lead per fonte (Smartlead vs Rank Checker)
 * GET /contacts/analytics/leads?from=YYYY-MM-DD&to=YYYY-MM-DD
 */
export const getLeadFunnelAnalytics = async (req, res) => {
  try {
    const { from, to } = req.query;

    // Calcola intervallo di date
    let dateFrom;
    let dateTo;

    if (from) {
      const parsedFrom = new Date(from);
      if (isNaN(parsedFrom.getTime())) {
        return res.status(400).json({
          success: false,
          message: 'Parametro "from" non valido (usa formato YYYY-MM-DD)'
        });
      }
      dateFrom = parsedFrom;
    } else {
      // Default: dal primo giorno del mese corrente
      dateFrom = new Date();
      dateFrom.setDate(1);
      dateFrom.setHours(0, 0, 0, 0);
    }

    if (to) {
      const parsedTo = new Date(to);
      if (isNaN(parsedTo.getTime())) {
        return res.status(400).json({
          success: false,
          message: 'Parametro "to" non valido (usa formato YYYY-MM-DD)'
        });
      }
      // Include tutta la giornata "to"
      parsedTo.setHours(23, 59, 59, 999);
      dateTo = parsedTo;
    } else {
      dateTo = new Date();
    }

    const sourcesOfInterest = ['smartlead_outbound', 'inbound_rank_checker', 'inbound_acquisition', 'manual', 'csv_import', 'referral'];
    const pipeline = [
      {
        $match: {
          source: { $in: sourcesOfInterest },
          createdAt: { $gte: dateFrom, $lte: dateTo }
        }
      },
      {
        $group: {
          _id: '$source',
          totalLeads: { $sum: 1 },
          qrCodeSent: {
            $sum: {
              $cond: [{ $eq: ['$status', 'qr code inviato'] }, 1, 0]
            }
          },
          freeTrialStarted: {
            $sum: {
              $cond: [{ $eq: ['$status', 'free trial iniziato'] }, 1, 0]
            }
          },
          wonCount: {
            $sum: {
              $cond: [{ $eq: ['$status', 'won'] }, 1, 0]
            }
          },
          lostCount: {
            $sum: {
              $cond: [
                { $in: ['$status', ['lost before free trial', 'lost after free trial']] },
                1,
                0
              ]
            }
          },
          mrrWon: {
            $sum: {
              $cond: [{ $eq: ['$status', 'won'] }, { $ifNull: ['$mrr', 0] }, 0]
            }
          },
          mrrFreeTrial: {
            $sum: {
              $cond: [
                { $eq: ['$status', 'free trial iniziato'] },
                { $ifNull: ['$mrr', 0] },
                0
              ]
            }
          }
        }
      }
    ];

    const aggResults = await Contact.aggregate(pipeline);

    // Normalizza in oggetto leggibile per il frontend
    const resultBySource = {};
    for (const row of aggResults) {
      const src = row._id;
      resultBySource[src] = {
        totalLeads: row.totalLeads,
        qrCodeSent: row.qrCodeSent,
        freeTrialStarted: row.freeTrialStarted,
        won: row.wonCount,
        lost: row.lostCount,
        mrrWon: row.mrrWon,
        mrrFreeTrial: row.mrrFreeTrial
      };
    }

    // Assicura chiavi presenti anche se 0
    sourcesOfInterest.forEach((src) => {
      if (!resultBySource[src]) {
        resultBySource[src] = {
          totalLeads: 0,
          qrCodeSent: 0,
          freeTrialStarted: 0,
          won: 0,
          lost: 0,
          mrrWon: 0,
          mrrFreeTrial: 0
        };
      }
    });

    res.json({
      success: true,
      data: {
        period: {
          from: dateFrom,
          to: dateTo
        },
        sources: resultBySource
      }
    });
  } catch (error) {
    console.error('Errore nel recupero delle analytics lead:', error);
    res.status(500).json({
      success: false,
      message: 'Errore interno del server'
    });
  }
};

/**
 * Analytics funnel basato sugli eventi di cambio stato (Activities)
 * GET /contacts/analytics/funnel-status-events?from=YYYY-MM-DD&to=YYYY-MM-DD&source=smartlead_outbound|inbound_rank_checker|all
 *
 * Versione semplice:
 * - Conta quante volte i lead ENTRANO in ciascuno stato (eventsByStatus)
 * - Conta quanti lead unici toccano ciascuno stato (uniqueLeadsByStatus)
 */
export const getFunnelStatusEvents = async (req, res) => {
  try {
    const { from, to, source = 'all' } = req.query;

    let dateFrom;
    let dateTo;

    if (from) {
      const parsedFrom = new Date(from);
      if (isNaN(parsedFrom.getTime())) {
        return res.status(400).json({
          success: false,
          message: 'Parametro "from" non valido (usa formato YYYY-MM-DD)'
        });
      }
      dateFrom = parsedFrom;
    } else {
      // Default: dal primo giorno del mese corrente
      dateFrom = new Date();
      dateFrom.setDate(1);
      dateFrom.setHours(0, 0, 0, 0);
    }

    if (to) {
      const parsedTo = new Date(to);
      if (isNaN(parsedTo.getTime())) {
        return res.status(400).json({
          success: false,
          message: 'Parametro "to" non valido (usa formato YYYY-MM-DD)'
        });
      }
      parsedTo.setHours(23, 59, 59, 999);
      dateTo = parsedTo;
    } else {
      dateTo = new Date();
    }

    const baseMatch = {
      type: 'status_change',
      createdAt: { $gte: dateFrom, $lte: dateTo }
    };

    const pipeline = [
      { $match: baseMatch },
      {
        $lookup: {
          from: 'contacts',
          localField: 'contact',
          foreignField: '_id',
          as: 'contact'
        }
      },
      { $unwind: '$contact' }
    ];

    if (source && source !== 'all') {
      pipeline.push({
        $match: {
          'contact.source': source
        }
      });
    }

    pipeline.push({
      $group: {
        _id: {
          source: '$contact.source',
          newStatus: '$data.statusChange.newStatus'
        },
        eventsCount: { $sum: 1 },
        contacts: { $addToSet: '$contact._id' }
      }
    });

    const aggResults = await Activity.aggregate(pipeline);

    const resultBySource = {};

    for (const row of aggResults) {
      const src = row._id.source || 'unknown';
      const status = row._id.newStatus || 'unknown';

      if (!resultBySource[src]) {
        resultBySource[src] = {
          eventsByStatus: {},
          uniqueLeadsByStatus: {},
          conversionFromPrevious: {}
        };
      }

      resultBySource[src].eventsByStatus[status] = row.eventsCount;
      resultBySource[src].uniqueLeadsByStatus[status] = row.contacts.length;
    }

    const sourcesOfInterest = ['smartlead_outbound', 'inbound_rank_checker', 'inbound_acquisition', 'manual', 'csv_import', 'referral'];
    sourcesOfInterest.forEach((src) => {
      if (!resultBySource[src]) {
        resultBySource[src] = {
          eventsByStatus: {},
          uniqueLeadsByStatus: {},
          conversionFromPrevious: {}
        };
      }
    });

    // Calcolo conversion rate step-by-step basato sulla cronologia degli eventi
    const funnelStatuses = [
      'interessato',
      'qr code inviato',
      'free trial iniziato',
      'won',
      'lost before free trial',
      'lost after free trial',
      'ghosted/bad timing'
    ];

    const timelinePipeline = [
      { $match: baseMatch },
      {
        $lookup: {
          from: 'contacts',
          localField: 'contact',
          foreignField: '_id',
          as: 'contact'
        }
      },
      { $unwind: '$contact' }
    ];

    if (source && source !== 'all') {
      timelinePipeline.push({
        $match: {
          'contact.source': source
        }
      });
    }

    timelinePipeline.push({
      $project: {
        source: '$contact.source',
        contactId: '$contact._id',
        newStatus: '$data.statusChange.newStatus',
        createdAt: 1
      }
    });

    const timelineEvents = await Activity.aggregate(timelinePipeline);

    // Mappa: source -> contactId -> status -> firstTimestamp
    const statusTimesBySource = {};

    for (const ev of timelineEvents) {
      const src = ev.source || 'unknown';
      const status = ev.newStatus;
      if (!status || !funnelStatuses.includes(status)) continue;

      if (!statusTimesBySource[src]) {
        statusTimesBySource[src] = {};
      }
      if (!statusTimesBySource[src][ev.contactId]) {
        statusTimesBySource[src][ev.contactId] = {};
      }

      const current = statusTimesBySource[src][ev.contactId][status];
      if (!current || ev.createdAt < current) {
        statusTimesBySource[src][ev.contactId][status] = ev.createdAt;
      }
    }

    // Per ogni sorgente e per ogni coppia consecutiva old->next calcola il conversion rate
    Object.entries(statusTimesBySource).forEach(([src, contactsMap]) => {
      const conversion = {};

      for (let i = 0; i < funnelStatuses.length - 1; i++) {
        const fromStatus = funnelStatuses[i];
        const toStatus = funnelStatuses[i + 1];

        let leadsInFrom = 0;
        let leadsFromTo = 0;

        Object.values(contactsMap).forEach((statusMap) => {
          const fromTime = statusMap[fromStatus];
          if (!fromTime) return;
          leadsInFrom++;

          const toTime = statusMap[toStatus];
          if (toTime && toTime > fromTime) {
            leadsFromTo++;
          }
        });

        const key = `${fromStatus}->${toStatus}`;
        conversion[key] = leadsInFrom > 0 ? leadsFromTo / leadsInFrom : 0;
      }

      if (!resultBySource[src]) {
        resultBySource[src] = {
          eventsByStatus: {},
          uniqueLeadsByStatus: {},
          conversionFromPrevious: {}
        };
      }

      resultBySource[src].conversionFromPrevious = conversion;
    });

    res.json({
      success: true,
      data: {
        period: {
          from: dateFrom,
          to: dateTo
        },
        sources: resultBySource
      }
    });
  } catch (error) {
    console.error('Errore nel recupero degli eventi funnel:', error);
    res.status(500).json({
      success: false,
      message: 'Errore interno del server'
    });
  }
};

/**
 * Elenco contatti WON per sorgente e periodo, basato sugli eventi di cambio stato
 * GET /contacts/analytics/won-contacts?source=smartlead_outbound|inbound_rank_checker&from=YYYY-MM-DD&to=YYYY-MM-DD
 */
export const getWonContactsBySource = async (req, res) => {
  try {
    const { from, to, source } = req.query;

    if (!source) {
      return res.status(400).json({
        success: false,
        message: 'Parametro "source" obbligatorio (es. smartlead_outbound o inbound_rank_checker)'
      });
    }

    let dateFrom;
    let dateTo;

    if (from) {
      const parsedFrom = new Date(from);
      if (isNaN(parsedFrom.getTime())) {
        return res.status(400).json({
          success: false,
          message: 'Parametro "from" non valido (usa formato YYYY-MM-DD)'
        });
      }
      dateFrom = parsedFrom;
    } else {
      // Default: dal primo giorno del mese corrente
      dateFrom = new Date();
      dateFrom.setDate(1);
      dateFrom.setHours(0, 0, 0, 0);
    }

    if (to) {
      const parsedTo = new Date(to);
      if (isNaN(parsedTo.getTime())) {
        return res.status(400).json({
          success: false,
          message: 'Parametro "to" non valido (usa formato YYYY-MM-DD)'
        });
      }
      parsedTo.setHours(23, 59, 59, 999);
      dateTo = parsedTo;
    } else {
      dateTo = new Date();
    }

    const pipeline = [
      {
        $match: {
          type: 'status_change',
          'data.statusChange.newStatus': 'won',
          createdAt: { $gte: dateFrom, $lte: dateTo }
        }
      },
      {
        $lookup: {
          from: 'contacts',
          localField: 'contact',
          foreignField: '_id',
          as: 'contact'
        }
      },
      { $unwind: '$contact' },
      {
        $match: {
          'contact.source': source
        }
      },
      {
        $group: {
          _id: '$contact._id',
          name: { $first: '$contact.name' },
          email: { $first: '$contact.email' },
          mrr: { $first: '$contact.mrr' },
          source: { $first: '$contact.source' },
          wonAt: { $min: '$createdAt' }
        }
      },
      {
        $sort: { wonAt: -1 }
      }
    ];

    const contacts = await Activity.aggregate(pipeline);

    res.json({
      success: true,
      data: {
        source,
        period: {
          from: dateFrom,
          to: dateTo
        },
        contacts: contacts.map((c) => ({
          id: c._id,
          name: c.name,
          email: c.email,
          mrr: c.mrr,
          source: c.source,
          wonAt: c.wonAt
        }))
      }
    });
  } catch (error) {
    console.error('Errore nel recupero dei contatti won per sorgente:', error);
    res.status(500).json({
      success: false,
      message: 'Errore interno del server'
    });
  }
};

/**
 * Analytics lead "a coorte" (creati + riattivati) + funnel per stati (QR -> Free trial -> Won)
 * GET /contacts/analytics/leads-cohort?from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * Definizioni:
 * - Creati: Contact.createdAt nel periodo
 * - Riattivati: prima Activity nel periodo su contatto esistente (createdAt < from)
 *              con "silenzio" di almeno 40 giorni rispetto all'Activity precedente (di QUALUNQUE tipo)
 * - Funnel: membership per stato basata su Activity.type='status_change' nel periodo.
 *          Cumulativo: se un lead entra in "won", appare anche in "free trial iniziato" e "qr code inviato".
 */
export const getLeadCohortFunnelAnalytics = async (req, res) => {
  try {
    const { from, to, owner } = req.query;

    let dateFrom;
    let dateTo;
    let ownerId = null;

    if (from) {
      const parsedFrom = new Date(from);
      if (isNaN(parsedFrom.getTime())) {
        return res.status(400).json({
          success: false,
          message: 'Parametro "from" non valido (usa formato YYYY-MM-DD)'
        });
      }
      dateFrom = parsedFrom;
    } else {
      dateFrom = new Date();
      dateFrom.setDate(1);
      dateFrom.setHours(0, 0, 0, 0);
    }

    if (to) {
      const parsedTo = new Date(to);
      if (isNaN(parsedTo.getTime())) {
        return res.status(400).json({
          success: false,
          message: 'Parametro "to" non valido (usa formato YYYY-MM-DD)'
        });
      }
      parsedTo.setHours(23, 59, 59, 999);
      dateTo = parsedTo;
    } else {
      dateTo = new Date();
    }

    if (owner && owner !== 'all') {
      if (!mongoose.Types.ObjectId.isValid(owner)) {
        return res.status(400).json({
          success: false,
          message: 'Parametro "owner" non valido'
        });
      }
      ownerId = new mongoose.Types.ObjectId(owner);
    }

    const sourcesOfInterest = ['smartlead_outbound', 'inbound_rank_checker', 'inbound_acquisition', 'manual', 'csv_import', 'referral'];
    const SILENCE_DAYS = 40;
    const silenceMs = SILENCE_DAYS * 24 * 60 * 60 * 1000;
    const OUTCOME_WINDOW_DAYS = 60;
    const outcomeWindowMs = OUTCOME_WINDOW_DAYS * 24 * 60 * 60 * 1000;

    // 1) COORTE "CREATI"
    const createdContacts = await Contact.find({
      source: { $in: sourcesOfInterest },
      createdAt: { $gte: dateFrom, $lte: dateTo },
      status: { $nin: ['lost before free trial', 'do_not_contact'] },
      ...(ownerId ? { owner: ownerId } : {})
    })
      .select('_id name email mrr source createdAt')
      .lean();

    const createdById = new Map(
      createdContacts.map((c) => [String(c._id), { ...c, cohortStartAt: c.createdAt }])
    );

    // 2) COORTE "RIATTIVATI" (prima activity nel periodo + gap >= 40gg rispetto alla precedente)
    // Pipeline su Activity per trovare firstActivityAt nel periodo per contatto.
    // ESCLUSIONE NEGATIVI: la prima activity del periodo non deve essere "negativa" (es. NON INTERESSATO / DO NOT CONTACT).
    const reactivatedAgg = await Activity.aggregate([
      {
        $match: {
          createdAt: { $gte: dateFrom, $lte: dateTo }
        }
      },
      {
        $group: {
          _id: '$contact',
          firstActivityAt: { $min: '$createdAt' }
        }
      },
      // Recupera il documento dell'activity "prima" nel periodo per poterla classificare (positiva/negativa)
      {
        $lookup: {
          from: 'activities',
          let: { contactId: '$_id', firstAt: '$firstActivityAt' },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $eq: ['$contact', '$$contactId'] },
                    { $eq: ['$createdAt', '$$firstAt'] }
                  ]
                }
              }
            },
            { $sort: { createdAt: 1, _id: 1 } },
            { $limit: 1 },
            {
              $project: {
                _id: 1,
                type: 1,
                title: 1,
                createdAt: 1,
                'data.statusChange.newStatus': 1
              }
            }
          ],
          as: 'firstActivity'
        }
      },
      { $addFields: { firstActivity: { $arrayElemAt: ['$firstActivity', 0] } } },
      {
        $lookup: {
          from: 'contacts',
          localField: '_id',
          foreignField: '_id',
          as: 'contact'
        }
      },
      { $unwind: '$contact' },
      {
        $match: {
          'contact.source': { $in: sourcesOfInterest },
          'contact.createdAt': { $lt: dateFrom },
          'contact.status': { $nin: ['lost before free trial', 'do_not_contact'] },
          ...(ownerId ? { 'contact.owner': ownerId } : {})
        }
      },
      // Se la prima activity è "negativa", NON considerarla riattivazione
      {
        $match: {
          $expr: {
            $and: [
              // Se manca firstActivity (caso limite), trattalo come non valido per riattivazione
              { $ne: ['$firstActivity', null] },
              // Escludi status_change verso stati negativi
              {
                $not: {
                  $and: [
                    { $eq: ['$firstActivity.type', 'status_change'] },
                    {
                      $in: [
                        '$firstActivity.data.statusChange.newStatus',
                        ['lost before free trial', 'do_not_contact']
                      ]
                    }
                  ]
                }
              }
            ]
          }
        }
      },
      {
        $match: {
          'firstActivity.title': {
            $not: /lost before free trial|do not contact|🚫|🛑/i
          }
        }
      },
      {
        $lookup: {
          from: 'activities',
          let: { contactId: '$_id', firstAt: '$firstActivityAt' },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $eq: ['$contact', '$$contactId'] },
                    { $lt: ['$createdAt', '$$firstAt'] }
                  ]
                }
              }
            },
            { $sort: { createdAt: -1 } },
            { $limit: 1 },
            { $project: { _id: 0, createdAt: 1 } }
          ],
          as: 'prevActivity'
        }
      },
      {
        $addFields: {
          prevActivityAt: { $arrayElemAt: ['$prevActivity.createdAt', 0] }
        }
      },
      {
        $addFields: {
          isReactivated: {
            $or: [
              { $eq: ['$prevActivityAt', null] },
              {
                $gte: [
                  { $subtract: ['$firstActivityAt', '$prevActivityAt'] },
                  silenceMs
                ]
              }
            ]
          }
        }
      },
      { $match: { isReactivated: true } },
      {
        $project: {
          _id: 1,
          firstActivityAt: 1,
          prevActivityAt: 1,
          contact: {
            _id: '$contact._id',
            name: '$contact.name',
            email: '$contact.email',
            mrr: '$contact.mrr',
            source: '$contact.source',
            createdAt: '$contact.createdAt'
          }
        }
      }
    ]);

    // Escludi dai "riattivati" quelli creati nel periodo (precedenza: creati)
    const reactivatedContacts = reactivatedAgg
      .filter((row) => !createdById.has(String(row._id)))
      .map((row) => ({
        ...row.contact,
        cohortStartAt: row.firstActivityAt,
        reactivatedAt: row.firstActivityAt,
        previousActivityAt: row.prevActivityAt || null
      }));

    const reactivatedById = new Map(
      reactivatedContacts.map((c) => [String(c._id), c])
    );

    // 3) Unione coorte (id -> info contatto + cohortStartAt)
    const cohortById = new Map([...createdById.entries(), ...reactivatedById.entries()]);
    const cohortIds = Array.from(cohortById.keys()).map((id) => new mongoose.Types.ObjectId(id));

    // 3b) Conteggio activity totali per contatto nella coorte (per "Not touched")
    // Esclude le activity di riattivazione automatica (data.kind = 'reactivation')
    const activityCountsAgg = await Activity.aggregate([
      { $match: { contact: { $in: cohortIds }, 'data.kind': { $ne: 'reactivation' } } },
      { $group: { _id: '$contact', count: { $sum: 1 } } }
    ]);
    const activityCountById = new Map(
      activityCountsAgg.map((r) => [String(r._id), r.count])
    );

    // 4) Eventi di ingresso stati per la coorte entro outcome window (60 giorni dalla coorte)
    const stageStatuses = ['qr code inviato', 'free trial iniziato', 'won', 'bad_data', 'non_qualificato'];
    const maxOutcomeTo = new Date(dateTo.getTime() + outcomeWindowMs);
    const statusEvents = await Activity.find({
      contact: { $in: cohortIds },
      type: 'status_change',
      createdAt: { $gte: dateFrom, $lte: maxOutcomeTo },
      'data.statusChange.newStatus': { $in: stageStatuses }
    })
      .select('contact createdAt data.statusChange.newStatus')
      .lean();

    // Per contatto: calcola min timestamp per ciascuno stato
    const stageTimesByContact = new Map(); // id -> { qr?, ft?, won? }
    for (const ev of statusEvents) {
      const id = String(ev.contact);
      const cohort = cohortById.get(id);
      if (!cohort?.cohortStartAt) continue;
      const cohortStartAt = new Date(cohort.cohortStartAt);
      const outcomeEndAt = new Date(cohortStartAt.getTime() + outcomeWindowMs);

      const st = ev.data?.statusChange?.newStatus;
      if (!st) continue;
      const m = stageTimesByContact.get(id) || {};
      const key =
        st === 'qr code inviato' ? 'qr' : st === 'free trial iniziato' ? 'ft' : st === 'won' ? 'won' : (st === 'bad_data' || st === 'non_qualificato') ? 'bd' : null;
      if (!key) continue;
      const t = ev.createdAt;
      // Considera solo eventi dopo l'inizio coorte e entro la finestra di outcome
      if (t < cohortStartAt || t > outcomeEndAt) continue;
      if (!m[key] || t < m[key]) m[key] = t;
      stageTimesByContact.set(id, m);
    }

    // 5) Costruisci risposta per sorgente
    const initSource = () => ({
      cohort: {
        created: { count: 0, contacts: [] },
        reactivated: { count: 0, contacts: [] },
        total: { count: 0 }
      },
      steps: {
        notTouched: { count: 0, contacts: [] },
        qrCodeSent: { count: 0, contacts: [] },
        freeTrialStarted: { count: 0, contacts: [] },
        won: { count: 0, contacts: [] },
        badData: { count: 0, contacts: [] }
      }
    });

    const resultBySource = {};
    sourcesOfInterest.forEach((s) => {
      resultBySource[s] = initSource();
    });

    const toPublicContact = (c) => ({
      id: String(c._id),
      name: c.name,
      email: c.email,
      mrr: typeof c.mrr === 'number' ? c.mrr : null,
      source: c.source,
      cohortStartAt: c.cohortStartAt,
      ...(c.reactivatedAt ? { reactivatedAt: c.reactivatedAt, previousActivityAt: c.previousActivityAt } : {})
    });

    // Riempie coorte created/reactivated
    for (const c of createdContacts) {
      const src = c.source;
      if (!resultBySource[src]) resultBySource[src] = initSource();
      resultBySource[src].cohort.created.contacts.push(toPublicContact({ ...c, cohortStartAt: c.createdAt }));
    }
    for (const c of reactivatedContacts) {
      const src = c.source;
      if (!resultBySource[src]) resultBySource[src] = initSource();
      resultBySource[src].cohort.reactivated.contacts.push(toPublicContact(c));
    }

    // Conta totali coorte per sorgente
    Object.values(resultBySource).forEach((srcObj) => {
      srcObj.cohort.created.count = srcObj.cohort.created.contacts.length;
      srcObj.cohort.reactivated.count = srcObj.cohort.reactivated.contacts.length;
      srcObj.cohort.total.count = srcObj.cohort.created.count + srcObj.cohort.reactivated.count;
    });

    // Funnel cumulativo: won ⊆ freeTrial ⊆ qr
    for (const [id, contact] of cohortById.entries()) {
      const c = contact;
      const src = c.source;
      if (!resultBySource[src]) resultBySource[src] = initSource();

      const times = stageTimesByContact.get(id) || {};
      const hasWon = !!times.won;
      const hasFt = !!times.ft || hasWon;
      const hasQr = !!times.qr || hasFt;
      const hasBd = !!times.bd;

      const base = {
        id: String(c._id),
        name: c.name,
        email: c.email,
        mrr: typeof c.mrr === 'number' ? c.mrr : null,
        source: c.source
      };

      // Not touched:
      // - Smartlead: <= 1 activity totale (solo quella iniziale / nessuna)
      // - Rank Checker: 0 activity totali
      const activitiesCount = activityCountById.get(id) || 0;
      const isNotTouched =
        src === 'smartlead_outbound' ? activitiesCount <= 1 : activitiesCount === 0;
      if (isNotTouched) {
        resultBySource[src].steps.notTouched.contacts.push({
          ...base,
          enteredAt: null
        });
      }

      if (hasQr) {
        resultBySource[src].steps.qrCodeSent.contacts.push({
          ...base,
          enteredAt: times.qr || times.ft || times.won || null
        });
      }
      if (hasFt) {
        resultBySource[src].steps.freeTrialStarted.contacts.push({
          ...base,
          enteredAt: times.ft || times.won || null
        });
      }
      if (hasWon) {
        resultBySource[src].steps.won.contacts.push({
          ...base,
          enteredAt: times.won
        });
      }
      if (hasBd) {
        resultBySource[src].steps.badData.contacts.push({
          ...base,
          enteredAt: times.bd
        });
      }
    }

    // Sorting (più recenti prima)
    const sortByEnteredDesc = (a, b) => {
      const ta = a.enteredAt ? new Date(a.enteredAt).getTime() : 0;
      const tb = b.enteredAt ? new Date(b.enteredAt).getTime() : 0;
      return tb - ta;
    };
    const sortByCohortStartDesc = (a, b) =>
      new Date(b.cohortStartAt).getTime() - new Date(a.cohortStartAt).getTime();

    sourcesOfInterest.forEach((src) => {
      const obj = resultBySource[src];
      obj.cohort.created.contacts.sort(sortByCohortStartDesc);
      obj.cohort.reactivated.contacts.sort(sortByCohortStartDesc);

      obj.steps.notTouched.contacts.sort(sortByEnteredDesc);
      obj.steps.qrCodeSent.contacts.sort(sortByEnteredDesc);
      obj.steps.freeTrialStarted.contacts.sort(sortByEnteredDesc);
      obj.steps.won.contacts.sort(sortByEnteredDesc);
      obj.steps.badData.contacts.sort(sortByEnteredDesc);

      obj.steps.notTouched.count = obj.steps.notTouched.contacts.length;
      obj.steps.qrCodeSent.count = obj.steps.qrCodeSent.contacts.length;
      obj.steps.freeTrialStarted.count = obj.steps.freeTrialStarted.contacts.length;
      obj.steps.won.count = obj.steps.won.contacts.length;
      obj.steps.badData.count = obj.steps.badData.contacts.length;
    });

    res.json({
      success: true,
      data: {
        period: { from: dateFrom, to: dateTo },
        silenceDaysThreshold: SILENCE_DAYS,
        outcomeWindowDays: OUTCOME_WINDOW_DAYS,
        sources: resultBySource
      }
    });
  } catch (error) {
    console.error('Errore nel recupero delle analytics lead a coorte:', error);
    res.status(500).json({
      success: false,
      message: 'Errore interno del server'
    });
  }
};

/**
 * GET /contacts/analytics/owner-performance?from=&to=&source=
 * Dashboard comparativa per owner: KPI stage-by-stage, conversion rate,
 * tempo medio 1° tocco, ciclo vendita, lost, in stallo, trend vs periodo
 * precedente.
 */
export const getOwnerPerformanceAnalytics = async (req, res) => {
  try {
    const { from, to, source, closeDateFrom, closeDateTo, wonFrom, wonTo } = req.query;

    let dateFrom, dateTo;
    if (from) {
      const p = new Date(from);
      if (isNaN(p.getTime())) return res.status(400).json({ success: false, message: '"from" non valido' });
      dateFrom = p;
    } else {
      dateFrom = new Date();
      dateFrom.setDate(1);
      dateFrom.setHours(0, 0, 0, 0);
    }
    if (to) {
      const p = new Date(to);
      if (isNaN(p.getTime())) return res.status(400).json({ success: false, message: '"to" non valido' });
      p.setHours(23, 59, 59, 999);
      dateTo = p;
    } else {
      dateTo = new Date();
    }

    let closeDateFromD = dateFrom, closeDateToD = dateTo;
    if (closeDateFrom) {
      const p = new Date(closeDateFrom);
      if (!isNaN(p.getTime())) closeDateFromD = p;
    }
    if (closeDateTo) {
      const p = new Date(closeDateTo);
      if (!isNaN(p.getTime())) { p.setHours(23, 59, 59, 999); closeDateToD = p; }
    }

    const allSources = ['smartlead_outbound', 'inbound_rank_checker', 'inbound_acquisition', 'manual', 'csv_import', 'referral'];
    const sourcesOfInterest = source && source !== 'all'
      ? source.split(',').filter(s => allSources.includes(s))
      : allSources;

    const SILENCE_DAYS = 40;
    const silenceMs = SILENCE_DAYS * 24 * 60 * 60 * 1000;
    const OUTCOME_WINDOW_DAYS = 60;
    const outcomeWindowMs = OUTCOME_WINDOW_DAYS * 24 * 60 * 60 * 1000;
    const STALL_DAYS = 7;

    // Previous period (same duration, shifted back) for trend
    const periodMs = dateTo.getTime() - dateFrom.getTime();
    const prevFrom = new Date(dateFrom.getTime() - periodMs - 1);
    const prevTo = new Date(dateFrom.getTime() - 1);

    async function computeForPeriod(pFrom, pTo) {
      // 1) COHORT "CREATED"
      const createdContacts = await Contact.find({
        source: { $in: sourcesOfInterest },
        createdAt: { $gte: pFrom, $lte: pTo }
      }).select('_id name email mrr source createdAt owner').lean();

      const createdById = new Map(
        createdContacts.map(c => [String(c._id), { ...c, cohortStartAt: c.createdAt }])
      );

      // 2) COHORT "REACTIVATED"
      const reactivatedAgg = await Activity.aggregate([
        { $match: { createdAt: { $gte: pFrom, $lte: pTo } } },
        { $group: { _id: '$contact', firstActivityAt: { $min: '$createdAt' } } },
        {
          $lookup: {
            from: 'activities',
            let: { contactId: '$_id', firstAt: '$firstActivityAt' },
            pipeline: [
              { $match: { $expr: { $and: [{ $eq: ['$contact', '$$contactId'] }, { $eq: ['$createdAt', '$$firstAt'] }] } } },
              { $sort: { createdAt: 1, _id: 1 } }, { $limit: 1 },
              { $project: { _id: 1, type: 1, title: 1, createdAt: 1, 'data.statusChange.newStatus': 1 } }
            ],
            as: 'firstActivity'
          }
        },
        { $addFields: { firstActivity: { $arrayElemAt: ['$firstActivity', 0] } } },
        { $lookup: { from: 'contacts', localField: '_id', foreignField: '_id', as: 'contact' } },
        { $unwind: '$contact' },
        {
          $match: {
            'contact.source': { $in: sourcesOfInterest },
            'contact.createdAt': { $lt: pFrom }
          }
        },
        {
          $match: {
            $expr: {
              $and: [
                { $ne: ['$firstActivity', null] },
                { $not: { $and: [{ $eq: ['$firstActivity.type', 'status_change'] }, { $in: ['$firstActivity.data.statusChange.newStatus', ['lost before free trial', 'do_not_contact']] }] } }
              ]
            }
          }
        },
        { $match: { 'firstActivity.title': { $not: /lost before free trial|do not contact|🚫|🛑/i } } },
        {
          $lookup: {
            from: 'activities',
            let: { contactId: '$_id', firstAt: '$firstActivityAt' },
            pipeline: [
              { $match: { $expr: { $and: [{ $eq: ['$contact', '$$contactId'] }, { $lt: ['$createdAt', '$$firstAt'] }] } } },
              { $sort: { createdAt: -1 } }, { $limit: 1 },
              { $project: { _id: 0, createdAt: 1 } }
            ],
            as: 'prevActivity'
          }
        },
        { $addFields: { prevActivityAt: { $arrayElemAt: ['$prevActivity.createdAt', 0] } } },
        {
          $addFields: {
            isReactivated: {
              $or: [
                { $eq: ['$prevActivityAt', null] },
                { $gte: [{ $subtract: ['$firstActivityAt', '$prevActivityAt'] }, silenceMs] }
              ]
            }
          }
        },
        { $match: { isReactivated: true } },
        {
          $project: {
            _id: 1, firstActivityAt: 1, prevActivityAt: 1,
            contact: { _id: '$contact._id', name: '$contact.name', email: '$contact.email', mrr: '$contact.mrr', source: '$contact.source', createdAt: '$contact.createdAt', owner: '$contact.owner' }
          }
        }
      ]);

      const reactivatedContacts = reactivatedAgg
        .filter(row => !createdById.has(String(row._id)))
        .map(row => ({ ...row.contact, cohortStartAt: row.firstActivityAt, reactivatedAt: row.firstActivityAt }));

      // 3) Union cohort
      const cohortById = new Map([...createdById.entries(), ...reactivatedContacts.map(c => [String(c._id), c])]);
      const cohortIds = Array.from(cohortById.keys()).map(id => new mongoose.Types.ObjectId(id));

      // 3b) Activity counts for "Not touched"
      // Esclude le activity di riattivazione automatica (data.kind = 'reactivation')
      const activityCountsAgg = await Activity.aggregate([
        { $match: { contact: { $in: cohortIds }, 'data.kind': { $ne: 'reactivation' } } },
        { $group: { _id: '$contact', count: { $sum: 1 } } }
      ]);
      const activityCountById = new Map(activityCountsAgg.map(r => [String(r._id), r.count]));

      // 3c) First activity timestamp per contact (for "tempo medio 1° tocco")
      const firstActivityAgg = await Activity.aggregate([
        { $match: { contact: { $in: cohortIds } } },
        { $group: { _id: '$contact', firstAt: { $min: '$createdAt' } } }
      ]);
      const firstActivityById = new Map(firstActivityAgg.map(r => [String(r._id), r.firstAt]));

      // 4) Status change events for funnel + lost
      const stageStatuses = ['qr code inviato', 'free trial iniziato', 'won', 'lost before free trial', 'lost after free trial'];
      const maxOutcomeTo = new Date(pTo.getTime() + outcomeWindowMs);
      const statusEvents = await Activity.find({
        contact: { $in: cohortIds },
        type: 'status_change',
        createdAt: { $gte: pFrom, $lte: maxOutcomeTo },
        'data.statusChange.newStatus': { $in: stageStatuses }
      }).select('contact createdAt data.statusChange.newStatus').lean();

      const stageTimesByContact = new Map();
      for (const ev of statusEvents) {
        const id = String(ev.contact);
        const cohort = cohortById.get(id);
        if (!cohort?.cohortStartAt) continue;
        const cohortStartAt = new Date(cohort.cohortStartAt);
        const outcomeEndAt = new Date(cohortStartAt.getTime() + outcomeWindowMs);
        const st = ev.data?.statusChange?.newStatus;
        if (!st) continue;
        const keyMap = { 'qr code inviato': 'qr', 'free trial iniziato': 'ft', 'won': 'won', 'lost before free trial': 'lbft', 'lost after free trial': 'laft' };
        const key = keyMap[st];
        if (!key) continue;
        const t = ev.createdAt;
        if (t < cohortStartAt || t > outcomeEndAt) continue;
        const m = stageTimesByContact.get(id) || {};
        if (!m[key] || t < m[key]) m[key] = t;
        stageTimesByContact.set(id, m);
      }

      // 5) Stalled contacts (status in qr/ft, last activity > STALL_DAYS ago)
      const now = new Date();
      const stallCutoff = new Date(now.getTime() - STALL_DAYS * 24 * 60 * 60 * 1000);
      const stalledContacts = await Contact.find({
        _id: { $in: cohortIds },
        status: { $in: ['qr code inviato', 'free trial iniziato'] }
      }).select('_id name email source status owner updatedAt').lean();

      const lastActivityAgg = stalledContacts.length > 0
        ? await Activity.aggregate([
            { $match: { contact: { $in: stalledContacts.map(c => c._id) } } },
            { $group: { _id: '$contact', lastAt: { $max: '$createdAt' } } }
          ])
        : [];
      const lastActivityById = new Map(lastActivityAgg.map(r => [String(r._id), r.lastAt]));

      const stalledList = stalledContacts
        .filter(c => {
          const lastAt = lastActivityById.get(String(c._id)) || c.updatedAt;
          return lastAt < stallCutoff;
        })
        .map(c => ({
          id: String(c._id),
          name: c.name,
          email: c.email,
          source: c.source,
          status: c.status,
          owner: c.owner ? String(c.owner) : null,
          lastActivityAt: lastActivityById.get(String(c._id)) || c.updatedAt
        }));

      // 6) Build per-owner data
      const ownerMap = new Map(); // ownerId -> metrics

      const ensureOwner = (ownerId) => {
        if (!ownerMap.has(ownerId)) {
          ownerMap.set(ownerId, {
            cohort: 0, notTouched: 0,
            qrCodeSent: 0, freeTrialStarted: 0, won: 0,
            lostBFT: 0, lostAFT: 0, stalled: 0,
            mrrWon: 0,
            firstTouchDaysSum: 0, firstTouchCount: 0,
            salesCycleDaysSum: 0, salesCycleCount: 0,
            cohortContacts: [],
            notTouchedContacts: [],
            qrContacts: [],
            ftContacts: [],
            wonContacts: [],
            stalledContacts: [],
            lostBFTContacts: [],
            lostAFTContacts: [],
            bySource: {}
          });
        }
        return ownerMap.get(ownerId);
      };

      const ensureOwnerSource = (ownerData, src) => {
        if (!ownerData.bySource[src]) {
          ownerData.bySource[src] = {
            cohort: 0, reactivated: 0, notTouched: 0, qrCodeSent: 0, freeTrialStarted: 0, won: 0,
            lostBFT: 0, lostAFT: 0, mrrWon: 0
          };
        }
        return ownerData.bySource[src];
      };

      for (const [id, contact] of cohortById.entries()) {
        const ownerId = contact.owner ? String(contact.owner) : 'unassigned';
        const src = contact.source;
        const od = ensureOwner(ownerId);
        const osd = ensureOwnerSource(od, src);

        od.cohort++;
        osd.cohort++;
        od.cohortContacts.push({ id, name: contact.name, email: contact.email, source: src });
        if (contact.reactivatedAt) osd.reactivated++;

        // Not touched
        const activitiesCount = activityCountById.get(id) || 0;
        const isNotTouched = src === 'smartlead_outbound' ? activitiesCount <= 1 : activitiesCount === 0;
        if (isNotTouched) {
          od.notTouched++;
          osd.notTouched++;
          od.notTouchedContacts.push({
            id, name: contact.name, email: contact.email, source: src,
            createdAt: contact.createdAt || contact.cohortStartAt
          });
        }

        // First touch time
        const firstAt = firstActivityById.get(id);
        if (firstAt && contact.createdAt) {
          const diffDays = (new Date(firstAt).getTime() - new Date(contact.createdAt).getTime()) / (1000 * 60 * 60 * 24);
          if (diffDays >= 0) {
            od.firstTouchDaysSum += diffDays;
            od.firstTouchCount++;
          }
        }

        // Funnel stages
        const times = stageTimesByContact.get(id) || {};
        const hasWon = !!times.won;
        const hasFt = !!times.ft || hasWon;
        const hasQr = !!times.qr || hasFt;
        const hasLbft = !!times.lbft;
        const hasLaft = !!times.laft;

        const contactRef = { id, name: contact.name, email: contact.email, source: src };
        if (hasQr) { od.qrCodeSent++; osd.qrCodeSent++; od.qrContacts.push(contactRef); }
        if (hasFt) { od.freeTrialStarted++; osd.freeTrialStarted++; od.ftContacts.push(contactRef); }
        if (hasWon) {
          od.won++; osd.won++;
          const mrr = typeof contact.mrr === 'number' ? contact.mrr : 0;
          od.mrrWon += mrr; osd.mrrWon += mrr;
          od.wonContacts.push({ ...contactRef, mrr });

          // Sales cycle: QR → Won
          const qrTime = times.qr || times.ft || times.won;
          if (qrTime && times.won) {
            const cycleDays = (new Date(times.won).getTime() - new Date(qrTime).getTime()) / (1000 * 60 * 60 * 24);
            if (cycleDays >= 0) {
              od.salesCycleDaysSum += cycleDays;
              od.salesCycleCount++;
            }
          }
        }
        if (hasLbft) { od.lostBFT++; osd.lostBFT++; od.lostBFTContacts.push({ id, name: contact.name, email: contact.email, source: src }); }
        if (hasLaft) { od.lostAFT++; osd.lostAFT++; od.lostAFTContacts.push({ id, name: contact.name, email: contact.email, source: src }); }
      }

      // Add stalled contacts
      for (const s of stalledList) {
        const ownerId = s.owner || 'unassigned';
        const od = ensureOwner(ownerId);
        od.stalled++;
        od.stalledContacts.push(s);
      }

      return ownerMap;
    }

    // Compute current and previous periods
    const [currentMap, prevMap] = await Promise.all([
      computeForPeriod(dateFrom, dateTo),
      computeForPeriod(prevFrom, prevTo)
    ]);

    // Fetch owner details
    const allOwnerIds = new Set([...currentMap.keys(), ...prevMap.keys()]);
    allOwnerIds.delete('unassigned');
    const ownerUsers = await User.find({ _id: { $in: Array.from(allOwnerIds) } }).select('firstName lastName email role').lean();
    const ownerNameMap = new Map(ownerUsers.map(u => [String(u._id), `${u.firstName} ${u.lastName}`]));

    // Build response (skip unassigned / null owner)
    const owners = [];
    for (const [ownerId, cur] of currentMap.entries()) {
      if (!ownerId || ownerId === 'unassigned' || ownerId === 'null') continue;
      const prev = prevMap.get(ownerId);
      const pctNT = cur.cohort > 0 ? Math.round((cur.notTouched / cur.cohort) * 100) : 0;
      const convQR = cur.cohort > 0 ? Math.round((cur.qrCodeSent / cur.cohort) * 100) : 0;
      const convQRtoFT = cur.qrCodeSent > 0 ? Math.round((cur.freeTrialStarted / cur.qrCodeSent) * 100) : 0;
      const convFTtoWon = cur.freeTrialStarted > 0 ? Math.round((cur.won / cur.freeTrialStarted) * 100) : 0;
      const avgFirstTouch = cur.firstTouchCount > 0 ? +(cur.firstTouchDaysSum / cur.firstTouchCount).toFixed(1) : null;
      const avgSalesCycle = cur.salesCycleCount > 0 ? +(cur.salesCycleDaysSum / cur.salesCycleCount).toFixed(1) : null;

      let trendPctNT = null, trendConvQR = null, trendConvFTtoWon = null;
      if (prev) {
        const prevPctNT = prev.cohort > 0 ? (prev.notTouched / prev.cohort) * 100 : 0;
        const prevConvQR = prev.cohort > 0 ? (prev.qrCodeSent / prev.cohort) * 100 : 0;
        const prevConvFTtoWon = prev.freeTrialStarted > 0 ? (prev.won / prev.freeTrialStarted) * 100 : 0;
        trendPctNT = Math.round(pctNT - prevPctNT);
        trendConvQR = Math.round(convQR - prevConvQR);
        trendConvFTtoWon = Math.round(convFTtoWon - prevConvFTtoWon);
      }

      owners.push({
        ownerId,
        ownerName: ownerNameMap.get(ownerId) || (ownerId === 'unassigned' ? 'Non assegnato' : ownerId),
        cohort: cur.cohort,
        notTouched: cur.notTouched,
        pctNotTouched: pctNT,
        avgFirstTouchDays: avgFirstTouch,
        qrCodeSent: cur.qrCodeSent,
        convToQR: convQR,
        freeTrialStarted: cur.freeTrialStarted,
        convQRtoFT: convQRtoFT,
        won: cur.won,
        convFTtoWon: convFTtoWon,
        lostBFT: cur.lostBFT,
        lostAFT: cur.lostAFT,
        stalled: cur.stalled,
        mrrWon: cur.mrrWon,
        avgSalesCycleDays: avgSalesCycle,
        trends: { pctNotTouched: trendPctNT, convToQR: trendConvQR, convFTtoWon: trendConvFTtoWon },
        bySource: cur.bySource,
        cohortContacts: cur.cohortContacts,
        notTouchedContacts: cur.notTouchedContacts,
        qrContacts: cur.qrContacts,
        ftContacts: cur.ftContacts,
        wonContacts: cur.wonContacts,
        stalledContacts: cur.stalledContacts,
        lostBFTContacts: cur.lostBFTContacts,
        lostAFTContacts: cur.lostAFTContacts
      });
    }

    // Override won data if wonFrom/wonTo are provided (filter by close date, not cohort date)
    if (wonFrom || wonTo) {
      let wFrom = dateFrom, wTo = dateTo;
      if (wonFrom) { const p = new Date(wonFrom); if (!isNaN(p.getTime())) wFrom = p; }
      if (wonTo) { const p = new Date(wonTo); if (!isNaN(p.getTime())) { p.setHours(23, 59, 59, 999); wTo = p; } }

      const wonEvents = await Activity.find({
        type: 'status_change',
        'data.statusChange.newStatus': 'won',
        createdAt: { $gte: wFrom, $lte: wTo }
      }).select('contact createdAt').lean();

      const wonContactIds = [...new Set(wonEvents.map(e => String(e.contact)))];
      const wonContacts = wonContactIds.length > 0
        ? await Contact.find({ _id: { $in: wonContactIds.map(id => new mongoose.Types.ObjectId(id)) }, ...(sourcesOfInterest.length < 4 ? { source: { $in: sourcesOfInterest } } : {}) })
            .select('_id name email mrr owner source').lean()
        : [];

      const wonByOwner = new Map();
      for (const c of wonContacts) {
        const oid = c.owner ? String(c.owner) : 'unassigned';
        if (!wonByOwner.has(oid)) wonByOwner.set(oid, { count: 0, mrr: 0, contacts: [] });
        const entry = wonByOwner.get(oid);
        const mrr = typeof c.mrr === 'number' ? c.mrr : 0;
        entry.count++;
        entry.mrr += mrr;
        entry.contacts.push({ id: String(c._id), name: c.name, email: c.email, source: c.source, mrr });
      }

      for (const o of owners) {
        const w = wonByOwner.get(o.ownerId);
        if (w) {
          o.won = w.count;
          o.mrrWon = w.mrr;
          o.wonContacts = w.contacts;
        } else {
          o.won = 0;
          o.mrrWon = 0;
          o.wonContacts = [];
        }
        o.convFTtoWon = o.freeTrialStarted > 0 ? Math.round((o.won / o.freeTrialStarted) * 100) : 0;
      }
    }

    owners.sort((a, b) => b.cohort - a.cohort);

    // Prove attive: contatti in "qr code inviato" o "free trial iniziato" con closeDate nel periodo selezionato
    const DEFAULT_CLOSE_DAYS = 25;
    const FORECAST_CONV_RATE = 0.5;

    const activeTrialContacts = await Contact.find({
      status: { $in: ['qr code inviato', 'free trial iniziato'] },
      ...(sourcesOfInterest.length < 2 ? { source: { $in: sourcesOfInterest } } : {})
    }).select('_id name email mrr owner source status properties').lean();

    const atIds = activeTrialContacts.map(c => c._id);

    // QR entry dates (for fallback closeDate and display)
    const qrStatusEvents = atIds.length > 0
      ? await Activity.aggregate([
          { $match: { contact: { $in: atIds }, type: 'status_change', 'data.statusChange.newStatus': 'qr code inviato' } },
          { $sort: { createdAt: 1 } },
          { $group: { _id: '$contact', enteredAt: { $first: '$createdAt' } } }
        ])
      : [];
    const qrEnteredMap = new Map(qrStatusEvents.map(r => [String(r._id), r.enteredAt]));

    // FT entry dates (for display)
    const ftStatusEvents = atIds.length > 0
      ? await Activity.aggregate([
          { $match: { contact: { $in: atIds }, type: 'status_change', 'data.statusChange.newStatus': 'free trial iniziato' } },
          { $sort: { createdAt: 1 } },
          { $group: { _id: '$contact', enteredAt: { $first: '$createdAt' } } }
        ])
      : [];
    const ftEnteredMap = new Map(ftStatusEvents.map(r => [String(r._id), r.enteredAt]));

    const forecastByOwner = new Map();
    const forecastContacts = [];

    for (const c of activeTrialContacts) {
      const ownerId = c.owner ? String(c.owner) : 'unassigned';
      const qrEnteredAt = qrEnteredMap.get(String(c._id));
      const ftEnteredAt = ftEnteredMap.get(String(c._id));

      // closeDate: use manual property if set, otherwise QR entry + 25 days
      let closeDateStr = c.properties?.closeDate || null;
      if (!closeDateStr && qrEnteredAt) {
        const auto = new Date(new Date(qrEnteredAt).getTime() + DEFAULT_CLOSE_DAYS * 86400000);
        closeDateStr = auto.toISOString();
      }
      if (!closeDateStr) continue;

      const closeDateObj = new Date(closeDateStr);
      if (closeDateObj < closeDateFromD || closeDateObj > closeDateToD) continue;

      const mrr = typeof c.mrr === 'number' ? c.mrr : 0;
      const weightedMrr = Math.round(mrr * FORECAST_CONV_RATE);

      if (!forecastByOwner.has(ownerId)) {
        forecastByOwner.set(ownerId, { deals: 0, mrrPotential: 0, mrrForecast: 0 });
      }
      const fo = forecastByOwner.get(ownerId);
      fo.deals++;
      fo.mrrPotential += mrr;
      fo.mrrForecast += weightedMrr;

      forecastContacts.push({
        id: String(c._id),
        name: c.name,
        email: c.email,
        mrr,
        source: c.source,
        owner: ownerId,
        status: c.status,
        qrEnteredAt: qrEnteredAt || null,
        ftEnteredAt: ftEnteredAt || null,
        closeDateAt: closeDateStr,
        isManualCloseDate: !!(c.properties?.closeDate),
        weightedMrr
      });
    }

    const forecastOwners = owners.map(o => {
      const fo = forecastByOwner.get(o.ownerId);
      return {
        ownerId: o.ownerId,
        ownerName: o.ownerName,
        deals: fo?.deals || 0,
        mrrPotential: fo?.mrrPotential || 0,
        mrrForecast: fo?.mrrForecast || 0
      };
    }).filter(o => o.deals > 0);

    const forecastTotals = {
      deals: forecastContacts.length,
      mrrPotential: forecastContacts.reduce((s, c) => s + c.mrr, 0),
      mrrForecast: forecastContacts.reduce((s, c) => s + c.weightedMrr, 0),
      conversionRate: FORECAST_CONV_RATE
    };

    res.json({
      success: true,
      data: {
        period: { from: dateFrom, to: dateTo },
        previousPeriod: { from: prevFrom, to: prevTo },
        owners,
        forecast: {
          period: { from: closeDateFromD, to: closeDateToD },
          totals: forecastTotals,
          owners: forecastOwners,
          contacts: forecastContacts
        }
      }
    });
  } catch (error) {
    console.error('Errore owner-performance analytics:', error);
    res.status(500).json({ success: false, message: 'Errore interno del server' });
  }
};

/**
 * Ottieni tutte le proprietà dinamiche disponibili per la mappatura CSV
 * GET /contacts/csv-mapping-options
 */
export const getCsvMappingOptions = async (req, res) => {
  try {
    // Recupera le proprietà dinamiche esistenti dal database
    const propertyKeys = await Contact.aggregate([
      { $match: { properties: { $exists: true, $ne: null } } },
      { $project: { properties: { $objectToArray: '$properties' } } },
      { $unwind: '$properties' },
      { $group: { _id: '$properties.k' } },
      { $sort: { _id: 1 } }
    ]);

    const existingProperties = propertyKeys.map(item => item._id).filter(Boolean);

    // Costruisce le opzioni di mappatura complete
    const mappingOptions = {
      // Campi fissi del modello Contact
      fixed: [
        { key: 'name', label: 'Nome', description: 'Campo nome del contatto (obbligatorio)', required: true },
        { key: 'email', label: 'Email', description: 'Campo email (opzionale ma unico se fornito)', required: false },
        { key: 'phone', label: 'Telefono', description: 'Campo telefono (opzionale)', required: false },
        { key: 'lists', label: 'Liste', description: 'Liste separate da virgola (es: "lista1,lista2")', required: false }
      ],
      
      // Proprietà dinamiche esistenti
      existingProperties: existingProperties.map(prop => ({
        key: `properties.${prop}`,
        label: prop,
        description: `Proprietà esistente: ${prop}`,
        type: 'existing'
      })),
      
      // Opzioni speciali
      special: [
        { key: 'ignore', label: 'Ignora colonna', description: 'Ignora questa colonna durante l\'importazione', type: 'ignore' }
      ],
      
      // Istruzioni per nuove proprietà
      newPropertyFormat: 'properties.nomeProprietà',
      newPropertyDescription: 'Puoi creare nuove proprietà dinamiche usando il formato "properties.nomeProprietà"'
    };

    res.json({
      success: true,
      data: mappingOptions,
      summary: {
        fixedFields: mappingOptions.fixed.length,
        existingProperties: existingProperties.length,
        totalOptions: mappingOptions.fixed.length + existingProperties.length + 1
      }
    });

  } catch (error) {
    console.error('Errore nel recupero delle opzioni di mappatura CSV:', error);
    res.status(500).json({
      success: false,
      message: 'Errore interno del server',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
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
    const { status, mrr, closeDate } = req.body;

    // Validazioni di base
    if (!status) {
      return res.status(400).json({
        success: false,
        message: 'Lo status è obbligatorio'
      });
    }

    const validStatuses = [
      'da contattare',
      'contattato',
      'da richiamare',
      'interessato',
      'ghosted/bad timing',
      'qr code inviato',
      'free trial iniziato',
      'won',
      'lost before free trial',
      'lost after free trial',
      'bad_data',
      'non_qualificato',
      'do_not_contact'
    ];
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
    if (req.user.role === 'agent' && contact.owner?.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Non hai i permessi per modificare questo contatto'
      });
    }

    // Valida MRR per stati pipeline
    const pipelineStatuses = [
      'interessato',
      'qr code inviato',
      'free trial iniziato',
      'won',
      'lost before free trial',
      'lost after free trial'
    ];
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

    // closeDate: se fornita dal frontend usala, altrimenti auto-set a +25gg quando si entra in QR o FT
    const closeDateStatuses = ['qr code inviato', 'free trial iniziato'];
    if (closeDate !== undefined) {
      if (!contact.properties) contact.properties = {};
      contact.properties.closeDate = closeDate || null;
      contact.markModified('properties');
    } else if (closeDateStatuses.includes(status) && !closeDateStatuses.includes(oldStatus)) {
      if (!contact.properties) contact.properties = {};
      if (!contact.properties.closeDate) {
        const auto = new Date();
        auto.setDate(auto.getDate() + 25);
        contact.properties.closeDate = auto.toISOString();
        contact.markModified('properties');
      }
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

/**
 * Cambia owner di contatti specifici in bulk
 * PUT /contacts/bulk-change-owner
 */
export const bulkChangeOwner = async (req, res) => {
  try {
    const { contactIds, newOwnerId } = req.body;
    const currentUserId = req.user._id;

    // Validazione input
    if (!contactIds || !Array.isArray(contactIds) || contactIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Array di IDs contatti obbligatorio e non vuoto'
      });
    }

    if (!newOwnerId) {
      return res.status(400).json({
        success: false,
        message: 'ID del nuovo proprietario obbligatorio'
      });
    }

    console.log(`🔄 Bulk change owner: ${contactIds.length} contatti → nuovo owner: ${newOwnerId}`);

    // Verifica che il nuovo owner esista e sia attivo
    const newOwner = await User.findById(newOwnerId);
    if (!newOwner) {
      return res.status(404).json({
        success: false,
        message: 'Nuovo proprietario non trovato'
      });
    }

    if (!newOwner.isActive) {
      return res.status(400).json({
        success: false,
        message: 'Il nuovo proprietario deve essere attivo'
      });
    }

    // Verifica permessi: admin/manager possono trasferire qualsiasi contatto,
    // agent possono trasferire solo i propri contatti
    let contactFilter = { _id: { $in: contactIds } };
    
    if (req.user.role === 'agent') {
      // Agent possono modificare solo i propri contatti
      contactFilter.owner = currentUserId;
      console.log(`🔒 Agent ${req.user.firstName}: limitato ai propri contatti`);
    } else {
      console.log(`🎯 ${req.user.role} ${req.user.firstName}: accesso a tutti i contatti`);
    }

    // Trova i contatti che l'utente può modificare
    const contactsToUpdate = await Contact.find(contactFilter);
    
    if (contactsToUpdate.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Nessun contatto trovato o non hai i permessi per modificarli'
      });
    }

    if (contactsToUpdate.length < contactIds.length) {
      console.warn(`⚠️ Richiesti ${contactIds.length} contatti, trovati solo ${contactsToUpdate.length} modificabili`);
    }

    // Aggiorna l'ownership dei contatti
    const updateResult = await Contact.updateMany(
      { _id: { $in: contactsToUpdate.map(c => c._id) } },
      {
        owner: newOwnerId,
        lastModifiedBy: currentUserId,
        updatedAt: new Date()
      }
    );

    console.log(`✅ Aggiornati ${updateResult.modifiedCount} contatti con nuovo owner`);

    // Aggiorna le statistiche degli utenti (se necessario)
    if (updateResult.modifiedCount > 0) {
      // Conta quanti contatti per vecchio owner
      const ownerChanges = {};
      contactsToUpdate.forEach(contact => {
        const oldOwnerId = contact.owner?.toString() || 'unassigned';
        if (!ownerChanges[oldOwnerId]) {
          ownerChanges[oldOwnerId] = 0;
        }
        ownerChanges[oldOwnerId]++;
      });

      // Aggiorna le statistiche
      const statUpdates = [];
      
      // Rimuovi dai vecchi owner
      for (const [oldOwnerId, count] of Object.entries(ownerChanges)) {
        if (oldOwnerId !== newOwnerId) {
          statUpdates.push(
            User.findByIdAndUpdate(oldOwnerId, {
              $inc: { 'stats.totalContacts': -count }
            })
          );
        }
      }
      
      // Aggiungi al nuovo owner
      const totalTransferred = Object.values(ownerChanges).reduce((sum, count) => sum + count, 0);
      statUpdates.push(
        User.findByIdAndUpdate(newOwnerId, {
          $inc: { 'stats.totalContacts': totalTransferred }
        })
      );

      await Promise.all(statUpdates);
    }

    res.json({
      success: true,
      message: `Proprietario cambiato per ${updateResult.modifiedCount} contatto${updateResult.modifiedCount !== 1 ? 'i' : ''}`,
      data: {
        requestedCount: contactIds.length,
        updatedCount: updateResult.modifiedCount,
        newOwner: {
          id: newOwner._id,
          name: `${newOwner.firstName} ${newOwner.lastName}`,
          email: newOwner.email
        },
        changedBy: {
          id: currentUserId,
          name: `${req.user.firstName} ${req.user.lastName}`,
          email: req.user.email
        },
        changedAt: new Date()
      }
    });

  } catch (error) {
    console.error('Errore nel cambio owner bulk:', error);
    res.status(500).json({
      success: false,
      message: 'Errore interno del server'
    });
  }
};

/**
 * Aggiorna i dati di callback (richiamo) di un contatto
 * PUT /contacts/:id/callback
 */
export const updateContactCallback = async (req, res) => {
  try {
    const { id } = req.params;
    const { callbackAt, callbackNote } = req.body;

    if (callbackAt !== null && callbackAt !== undefined) {
      const d = new Date(callbackAt);
      if (isNaN(d.getTime())) {
        return res.status(400).json({
          success: false,
          message: 'callbackAt deve essere una data ISO valida oppure null'
        });
      }
    }

    if (callbackNote !== null && callbackNote !== undefined) {
      if (typeof callbackNote !== 'string' || callbackNote.length > 300) {
        return res.status(400).json({
          success: false,
          message: 'callbackNote deve essere una stringa di massimo 300 caratteri oppure null'
        });
      }
    }

    const contact = await Contact.findById(id);
    if (!contact) {
      return res.status(404).json({ success: false, message: 'Contatto non trovato' });
    }

    if (req.user.role === 'agent' && contact.owner?.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Non hai i permessi per modificare questo contatto'
      });
    }

    if (!contact.properties) contact.properties = {};

    if (callbackAt === null) {
      delete contact.properties.callbackAt;
    } else if (callbackAt !== undefined) {
      contact.properties.callbackAt = callbackAt;
    }

    if (callbackNote === null) {
      delete contact.properties.callbackNote;
    } else if (callbackNote !== undefined) {
      contact.properties.callbackNote = callbackNote;
    }

    contact.lastModifiedBy = req.user._id;
    contact.markModified('properties');
    await contact.save();

    await contact.populate('owner', 'firstName lastName email role');

    res.json({
      success: true,
      message: 'Dati di callback aggiornati con successo',
      data: contact
    });
  } catch (error) {
    console.error('Errore aggiornamento callback:', error);
    if (error.name === 'CastError') {
      return res.status(400).json({ success: false, message: 'ID contatto non valido' });
    }
    res.status(500).json({ success: false, message: 'Errore interno del server' });
  }
};

/**
 * 📞 Genera script di chiamata personalizzato usando AI (Claude)
 * GET /contacts/:id/call-script
 * 
 * Genera uno script di vendita basato sui dati del report Rank Checker del contatto.
 * Lo script viene salvato nel contatto e riutilizzato nelle chiamate successive.
 * Usa ?regenerate=true per forzare una nuova generazione.
 * 
 * Funziona solo per contatti inbound con rankCheckerData.
 */
export const generateCallScript = async (req, res) => {
  try {
    const { id } = req.params;
    const { regenerate } = req.query; // Se true, forza rigenerazione
    
    // Trova il contatto
    const contact = await Contact.findById(id).populate('owner', 'firstName lastName email');
    
    if (!contact) {
      return res.status(404).json({
        success: false,
        message: 'Contatto non trovato'
      });
    }

    // Verifica che sia un contatto inbound con dati rank checker
    if (contact.source !== 'inbound_rank_checker') {
      return res.status(400).json({
        success: false,
        message: 'Lo script è disponibile solo per contatti inbound del Rank Checker'
      });
    }

    if (!contact.rankCheckerData) {
      return res.status(400).json({
        success: false,
        message: 'Il contatto non ha dati Rank Checker disponibili'
      });
    }

    // Verifica che ci siano almeno i dati base del report
    const hasBaseReport = contact.rankCheckerData.restaurantData || 
                          contact.rankCheckerData.ranking;
    
    if (!hasBaseReport) {
      return res.status(400).json({
        success: false,
        message: 'Il contatto deve avere almeno il report base del Rank Checker'
      });
    }

    // Controlla se esiste già uno script salvato e non è richiesta rigenerazione
    const existingScript = contact.properties?.generatedCallScript;
    const scriptGeneratedAt = contact.properties?.callScriptGeneratedAt;
    
    if (existingScript && !regenerate) {
      console.log(`📞 Restituisco script esistente per contatto: ${contact.name}`);
      
      return res.json({
        success: true,
        message: 'Script di chiamata recuperato dalla cache',
        data: {
          script: existingScript,
          contactId: contact._id,
          contactName: contact.name,
          generatedAt: scriptGeneratedAt,
          hasCompleteReport: !!contact.properties?.rankCheckerCompleteReport,
          fromCache: true
        }
      });
    }

    console.log(`📞 Generazione nuovo script chiamata per contatto: ${contact.name}`);

    // Genera lo script usando Claude
    const script = await claudeService.generateCallScript(contact);
    const generatedAt = new Date().toISOString();

    // Salva lo script nel contatto
    contact.properties = {
      ...contact.properties,
      generatedCallScript: script,
      callScriptGeneratedAt: generatedAt
    };
    contact.lastModifiedBy = req.user._id;
    await contact.save();

    console.log(`✅ Script salvato nel contatto: ${contact.name}`);

    res.json({
      success: true,
      message: 'Script di chiamata generato e salvato con successo',
      data: {
        script,
        contactId: contact._id,
        contactName: contact.name,
        generatedAt,
        hasCompleteReport: !!contact.properties?.rankCheckerCompleteReport,
        fromCache: false
      }
    });

  } catch (error) {
    console.error('❌ Errore generazione script chiamata:', error);
    
    // Gestisci errore specifico di API key mancante
    if (error.message?.includes('ANTHROPIC_API_KEY')) {
      return res.status(503).json({
        success: false,
        message: 'Servizio AI non configurato. Contatta l\'amministratore.'
      });
    }

    res.status(500).json({
      success: false,
      message: 'Errore durante la generazione dello script',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
}; 