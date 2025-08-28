import WhatsappCampaign from '../models/whatsappCampaignModel.js';
import WhatsappSession from '../models/whatsappSessionModel.js';
import Contact from '../models/contactModel.js';
import whatsappService from '../services/whatsappService.js';
import multer from 'multer';
import path from 'path';
import fs from 'fs/promises';

/**
 * Controller per gestire le Campagne WhatsApp
 */

// Configurazione upload per allegati
const storage = multer.diskStorage({
  destination: async (req, file, cb) => {
    const uploadDir = path.join(process.cwd(), 'uploads', 'whatsapp');
    try {
      await fs.mkdir(uploadDir, { recursive: true });
      cb(null, uploadDir);
    } catch (error) {
      cb(error);
    }
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage,
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|gif|mp4|mov|avi|mp3|wav|pdf|doc|docx|txt/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);

    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb(new Error('Tipo di file non supportato'));
    }
  }
});

/**
 * Ottieni tutte le campagne dell'utente
 * GET /whatsapp-campaigns
 */
export const getCampaigns = async (req, res) => {
  try {
    const userId = req.user._id;
    const { status, page = 1, limit = 10 } = req.query;

    const filter = { owner: userId };
    if (status) {
      filter.status = status;
    }

    const campaigns = await WhatsappCampaign.find(filter)
      .populate('owner', 'firstName lastName email')
      .populate('createdBy', 'firstName lastName')
      .sort({ updatedAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const totalCampaigns = await WhatsappCampaign.countDocuments(filter);

    res.json({
      success: true,
      data: {
        campaigns,
        pagination: {
          currentPage: parseInt(page),
          totalPages: Math.ceil(totalCampaigns / limit),
          totalCampaigns,
          hasNext: page < Math.ceil(totalCampaigns / limit),
          hasPrev: page > 1
        }
      }
    });

  } catch (error) {
    console.error('Errore ottenimento campagne:', error);
    res.status(500).json({
      success: false,
      message: 'Errore interno del server'
    });
  }
};

/**
 * Ottieni una campagna specifica
 * GET /whatsapp-campaigns/:id
 */
export const getCampaign = async (req, res) => {
  try {
    const campaignId = req.params.id;
    const userId = req.user._id;

    const campaign = await WhatsappCampaign.findOne({
      _id: campaignId,
      owner: userId
    })
      .populate('owner', 'firstName lastName email')
      .populate('createdBy', 'firstName lastName')
      .populate('messageQueue.contactId', 'name phone email');

    if (!campaign) {
      return res.status(404).json({
        success: false,
        message: 'Campagna non trovata'
      });
    }

    res.json({
      success: true,
      data: campaign
    });

  } catch (error) {
    console.error('Errore ottenimento campagna:', error);
    res.status(500).json({
      success: false,
      message: 'Errore interno del server'
    });
  }
};

/**
 * Crea una nuova campagna
 * POST /whatsapp-campaigns
 */
export const createCampaign = async (req, res) => {
  try {
    const userId = req.user._id;
    const {
      name,
      description,
      whatsappSessionId,
      targetList,
      contactFilters,
      messageTemplate,
      messageSequences, // NUOVO: Sequenze di messaggi di follow-up
      priority, // ✅ Sistema priorità
      timing,
      scheduledStartAt
    } = req.body;

    // Verifica che la sessione WhatsApp esista e sia dell'utente
    const session = await WhatsappSession.findOne({
      sessionId: whatsappSessionId,
      owner: userId
    });

    if (!session) {
      return res.status(400).json({
        success: false,
        message: 'Sessione WhatsApp non trovata o non autorizzata'
      });
    }

    // Verifica che la sessione sia connessa
    if (!session.isActive()) {
      return res.status(400).json({
        success: false,
        message: 'La sessione WhatsApp deve essere connessa'
      });
    }

    // Estrai variabili dal template principale
    const templateVariables = extractTemplateVariables(messageTemplate);

    // Processa le sequenze di messaggi se presenti
    let processedSequences = [];
    if (messageSequences && Array.isArray(messageSequences) && messageSequences.length > 0) {
      processedSequences = messageSequences.map(seq => ({
        ...seq,
        templateVariables: extractTemplateVariables(seq.messageTemplate)
      }));
    }

    // Ottieni contatti target
    const contacts = await getTargetContacts(targetList, contactFilters, userId);

    if (contacts.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Nessun contatto trovato con i criteri specificati'
      });
    }

    // Compila la coda messaggi
    const messageQueue = await compileMessageQueue(contacts, messageTemplate, templateVariables);

    // Crea la campagna
    const campaign = new WhatsappCampaign({
      name,
      description,
      whatsappSessionId,
      whatsappNumber: session.phoneNumber,
      targetList,
      contactFilters,
      messageTemplate,
      templateVariables,
      messageSequences: processedSequences, // NUOVO: Include le sequenze
      priority: priority || 'media', // ✅ Default priorità media
      timing,
      scheduledStartAt: scheduledStartAt ? new Date(scheduledStartAt) : null,
      messageQueue,
      owner: userId,
      createdBy: userId,
      status: scheduledStartAt ? 'scheduled' : 'draft'
    });

    await campaign.save();

    res.status(201).json({
      success: true,
      data: campaign,
      message: 'Campagna creata con successo'
    });

  } catch (error) {
    console.error('Errore creazione campagna:', error);
    res.status(500).json({
      success: false,
      message: 'Errore interno del server'
    });
  }
};

/**
 * Aggiorna una campagna
 * PUT /whatsapp-campaigns/:id
 */
export const updateCampaign = async (req, res) => {
  try {
    const campaignId = req.params.id;
    const userId = req.user._id;
    
    const campaign = await WhatsappCampaign.findOne({
      _id: campaignId,
      owner: userId
    });

    if (!campaign) {
      return res.status(404).json({
        success: false,
        message: 'Campagna non trovata'
      });
    }

    // Verifica che la campagna possa essere modificata
    if (!['draft', 'scheduled'].includes(campaign.status)) {
      return res.status(400).json({
        success: false,
        message: 'Impossibile modificare una campagna in esecuzione o completata'
      });
    }

    const updateData = { ...req.body };
    updateData.lastModifiedBy = userId;

    // Se il template è cambiato, ricompila la coda
    if (updateData.messageTemplate && updateData.messageTemplate !== campaign.messageTemplate) {
      const templateVariables = extractTemplateVariables(updateData.messageTemplate);
      updateData.templateVariables = templateVariables;

      // Ricompila i messaggi se necessario
      if (campaign.messageQueue.length > 0) {
        const contacts = await Contact.find({
          _id: { $in: campaign.messageQueue.map(m => m.contactId) }
        });
        updateData.messageQueue = await compileMessageQueue(contacts, updateData.messageTemplate, templateVariables);
      }
    }

    Object.assign(campaign, updateData);
    await campaign.save();

    res.json({
      success: true,
      data: campaign,
      message: 'Campagna aggiornata con successo'
    });

  } catch (error) {
    console.error('Errore aggiornamento campagna:', error);
    res.status(500).json({
      success: false,
      message: 'Errore interno del server'
    });
  }
};

/**
 * Aggiorna lo stato di un messaggio specifico in una campagna
 * PUT /whatsapp-campaigns/:campaignId/messages/:messageId/status
 */
export const updateMessageStatus = async (req, res) => {
  try {
    const { campaignId, messageId } = req.params;
    const { status, additionalData } = req.body;
    const userId = req.user._id;

    // Valida i parametri
    if (!campaignId || !messageId || !status) {
      return res.status(400).json({
        success: false,
        message: 'Parametri mancanti: campaignId, messageId, status sono obbligatori'
      });
    }

    // Trova la campagna
    const campaign = await WhatsappCampaign.findOne({
      _id: campaignId,
      owner: userId
    });

    if (!campaign) {
      return res.status(404).json({
        success: false,
        message: 'Campagna non trovata o non autorizzata'
      });
    }

    // Trova il messaggio nella coda
    const message = campaign.messageQueue.find(m => m._id.toString() === messageId);
    
    if (!message) {
      return res.status(404).json({
        success: false,
        message: 'Messaggio non trovato nella campagna'
      });
    }

    const oldStatus = message.status;
    let updatedMessage;

    // Aggiorna lo status in base al tipo
    switch (status) {
      case 'replied':
        updatedMessage = await campaign.markMessageAsReplied(message.contactId, message.sequenceIndex);
        break;
        
      case 'not_interested':
        updatedMessage = await campaign.markMessageAsNotInterested(message.contactId, message.sequenceIndex);
        break;
        
      case 'pending':
      case 'sent':
      case 'delivered':
      case 'read':
      case 'failed':
        // Stati standard - aggiorna direttamente
        message.status = status;
        if (additionalData?.messageId) message.messageId = additionalData.messageId;
        if (additionalData?.errorMessage) message.errorMessage = additionalData.errorMessage;
        updatedMessage = message;
        break;
        
      default:
        return res.status(400).json({
          success: false,
          message: `Status non valido: ${status}`
        });
    }

    // Aggiorna statistiche campagna
    campaign.updateStats();
    
    // Salva la campagna
    await campaign.save();

    console.log(`📝 Message status updated: ${oldStatus} → ${status} for contact ${message.contactId} in campaign ${campaign.name}`);

    res.json({
      success: true,
      message: 'Status messaggio aggiornato con successo',
      data: {
        messageId: messageId,
        oldStatus: oldStatus,
        newStatus: status,
        cancelledFollowUps: status === 'replied' || status === 'not_interested' ? true : false
      }
    });

  } catch (error) {
    console.error('Errore aggiornamento status messaggio:', error);
    res.status(500).json({
      success: false,
      message: 'Errore interno del server'
    });
  }
};

/**
 * Avvia una campagna
 * POST /whatsapp-campaigns/:id/start
 */
export const startCampaign = async (req, res) => {
  try {
    const campaignId = req.params.id;
    const userId = req.user._id;

    const campaign = await WhatsappCampaign.findOne({
      _id: campaignId,
      owner: userId
    });

    if (!campaign) {
      return res.status(404).json({
        success: false,
        message: 'Campagna non trovata'
      });
    }

    if (!campaign.canStart()) {
      return res.status(400).json({
        success: false,
        message: 'La campagna non può essere avviata nel suo stato attuale'
      });
    }

    // Verifica che la sessione sia ancora attiva
    const session = await WhatsappSession.findOne({
      sessionId: campaign.whatsappSessionId
    });

    if (!session || !session.isActive()) {
      return res.status(400).json({
        success: false,
        message: 'Sessione WhatsApp non attiva'
      });
    }

    // Avvia la campagna
    campaign.status = 'running';
    campaign.actualStartedAt = new Date();
    campaign.lastModifiedBy = userId;
    await campaign.save();

    res.json({
      success: true,
      data: campaign,
      message: 'Campagna avviata con successo'
    });

  } catch (error) {
    console.error('Errore avvio campagna:', error);
    res.status(500).json({
      success: false,
      message: 'Errore interno del server'
    });
  }
};

/**
 * Pausa una campagna
 * POST /whatsapp-campaigns/:id/pause
 */
export const pauseCampaign = async (req, res) => {
  try {
    const campaignId = req.params.id;
    const userId = req.user._id;

    const campaign = await WhatsappCampaign.findOne({
      _id: campaignId,
      owner: userId
    });

    if (!campaign) {
      return res.status(404).json({
        success: false,
        message: 'Campagna non trovata'
      });
    }

    if (campaign.status !== 'running') {
      return res.status(400).json({
        success: false,
        message: 'Solo le campagne in esecuzione possono essere pausate'
      });
    }

    campaign.status = 'paused';
    campaign.lastModifiedBy = userId;
    await campaign.save();

    res.json({
      success: true,
      data: campaign,
      message: 'Campagna pausata con successo'
    });

  } catch (error) {
    console.error('Errore pausa campagna:', error);
    res.status(500).json({
      success: false,
      message: 'Errore interno del server'
    });
  }
};

/**
 * Riprendi una campagna pausata
 * POST /whatsapp-campaigns/:id/resume
 */
export const resumeCampaign = async (req, res) => {
  try {
    const campaignId = req.params.id;
    const userId = req.user._id;

    const campaign = await WhatsappCampaign.findOne({
      _id: campaignId,
      owner: userId
    });

    if (!campaign) {
      return res.status(404).json({
        success: false,
        message: 'Campagna non trovata'
      });
    }

    if (campaign.status !== 'paused') {
      return res.status(400).json({
        success: false,
        message: 'Solo le campagne pausate possono essere riprese'
      });
    }

    campaign.status = 'running';
    campaign.lastModifiedBy = userId;
    await campaign.save();

    res.json({
      success: true,
      data: campaign,
      message: 'Campagna ripresa con successo'
    });

  } catch (error) {
    console.error('Errore ripresa campagna:', error);
    res.status(500).json({
      success: false,
      message: 'Errore interno del server'
    });
  }
};

/**
 * Cancella una campagna
 * POST /whatsapp-campaigns/:id/cancel
 */
export const cancelCampaign = async (req, res) => {
  try {
    const campaignId = req.params.id;
    const userId = req.user._id;

    const campaign = await WhatsappCampaign.findOne({
      _id: campaignId,
      owner: userId
    });

    if (!campaign) {
      return res.status(404).json({
        success: false,
        message: 'Campagna non trovata'
      });
    }

    if (['completed', 'cancelled'].includes(campaign.status)) {
      return res.status(400).json({
        success: false,
        message: 'La campagna è già completata o cancellata'
      });
    }

    campaign.status = 'cancelled';
    campaign.lastModifiedBy = userId;
    await campaign.save();

    res.json({
      success: true,
      data: campaign,
      message: 'Campagna cancellata con successo'
    });

  } catch (error) {
    console.error('Errore cancellazione campagna:', error);
    res.status(500).json({
      success: false,
      message: 'Errore interno del server'
    });
  }
};

/**
 * Elimina una campagna
 * DELETE /whatsapp-campaigns/:id
 */
export const deleteCampaign = async (req, res) => {
  try {
    const campaignId = req.params.id;
    const userId = req.user._id;

    const campaign = await WhatsappCampaign.findOne({
      _id: campaignId,
      owner: userId
    });

    if (!campaign) {
      return res.status(404).json({
        success: false,
        message: 'Campagna non trovata'
      });
    }

    // Verifica che la campagna possa essere eliminata
    if (['running'].includes(campaign.status)) {
      return res.status(400).json({
        success: false,
        message: 'Impossibile eliminare una campagna in esecuzione'
      });
    }

    await WhatsappCampaign.findByIdAndDelete(campaignId);

    res.json({
      success: true,
      message: 'Campagna eliminata con successo'
    });

  } catch (error) {
    console.error('Errore eliminazione campagna:', error);
    res.status(500).json({
      success: false,
      message: 'Errore interno del server'
    });
  }
};

/**
 * Upload allegati per campagna
 * POST /whatsapp-campaigns/:id/attachments
 */
export const uploadAttachments = [
  upload.array('files', 5),
  async (req, res) => {
    try {
      const campaignId = req.params.id;
      const userId = req.user._id;

      const campaign = await WhatsappCampaign.findOne({
        _id: campaignId,
        owner: userId
      });

      if (!campaign) {
        return res.status(404).json({
          success: false,
          message: 'Campagna non trovata'
        });
      }

      if (!['draft', 'scheduled'].includes(campaign.status)) {
        return res.status(400).json({
          success: false,
          message: 'Impossibile modificare allegati di una campagna in esecuzione'
        });
      }

      // Processa i file caricati
      const attachments = req.files.map(file => {
        const fileType = getFileType(file.mimetype);
        return {
          type: fileType,
          filename: file.originalname,
          url: `/uploads/whatsapp/${file.filename}`,
          size: file.size,
          caption: req.body.caption || ''
        };
      });

      // Aggiungi agli allegati esistenti
      campaign.attachments.push(...attachments);
      await campaign.save();

      res.json({
        success: true,
        data: {
          attachments,
          totalAttachments: campaign.attachments.length
        },
        message: 'Allegati caricati con successo'
      });

    } catch (error) {
      console.error('Errore upload allegati:', error);
      res.status(500).json({
        success: false,
        message: 'Errore interno del server'
      });
    }
  }
];

/**
 * Anteprima campagna (compila messaggi senza salvare)
 * POST /whatsapp-campaigns/preview
 */
export const previewCampaign = async (req, res) => {
  try {
    const userId = req.user._id;
    const { targetList, contactFilters, messageTemplate, limit = 5 } = req.body;

    // Ottieni contatti target
    const contacts = await getTargetContacts(targetList, contactFilters, userId);
    
    if (contacts.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Nessun contatto trovato con i criteri specificati'
      });
    }

    // Compila messaggi per anteprima
    const templateVariables = extractTemplateVariables(messageTemplate);
    const previewContacts = contacts.slice(0, limit);
    const preview = await compileMessageQueue(previewContacts, messageTemplate, templateVariables);

    res.json({
      success: true,
      data: {
        totalContacts: contacts.length,
        templateVariables,
        preview: preview.map(p => ({
          contact: previewContacts.find(c => c._id.toString() === p.contactId.toString()),
          compiledMessage: p.compiledMessage
        }))
      }
    });

  } catch (error) {
    console.error('Errore anteprima campagna:', error);
    res.status(500).json({
      success: false,
      message: 'Errore interno del server'
    });
  }
};

// Funzioni helper

/**
 * Estrae le variabili dal template
 */
function extractTemplateVariables(template) {
  const regex = /\{([^}]+)\}/g;
  const variables = [];
  let match;
  
  while ((match = regex.exec(template)) !== null) {
    if (!variables.includes(match[1])) {
      variables.push(match[1]);
    }
  }
  
  return variables;
}

/**
 * Ottieni contatti target basati sui filtri
 */
async function getTargetContacts(targetList, contactFilters, userId) {
  const filter = { owner: userId };
  
  // Filtra per lista
  if (targetList && targetList !== 'all') {
    filter.lists = targetList;
  }
  
  // Applica filtri aggiuntivi
  if (contactFilters) {
    if (contactFilters.status && contactFilters.status.length > 0) {
      filter.status = { $in: contactFilters.status };
    }
    
    if (contactFilters.properties) {
      for (const [key, value] of Object.entries(contactFilters.properties)) {
        filter[`properties.${key}`] = value;
      }
    }
  }
  
  // Filtra solo contatti con numero di telefono
  filter.phone = { $exists: true, $ne: null, $ne: '' };
  
  // ✅ LOGGING DIAGNOSTICO: Analizza perché non vengono trovati contatti
  console.log('🔍 Debug getTargetContacts:');
  console.log('   Filter applicato:', JSON.stringify(filter, null, 2));
  
  const contacts = await Contact.find(filter).select('name phone email properties');
  
  if (contacts.length === 0) {
    console.warn('⚠️ Nessun contatto trovato! Analisi diagnostica:');
    
    // Conta contatti per step per capire dove si perde
    const totalForUser = await Contact.countDocuments({ owner: userId });
    console.warn(`   👤 Contatti totali per user ${userId}: ${totalForUser}`);
    
    if (totalForUser === 0) {
      console.warn('   ❌ PROBLEMA: Questo utente non ha nessun contatto!');
      return [];
    }
    
    const withPhone = await Contact.countDocuments({ 
      owner: userId,
      phone: { $exists: true, $ne: null, $ne: '' }
    });
    console.warn(`   📱 Contatti con telefono: ${withPhone}`);
    
    if (withPhone === 0) {
      console.warn('   ❌ PROBLEMA: Nessun contatto ha un numero di telefono valido!');
      return [];
    }
    
    if (targetList && targetList !== 'all') {
      const inList = await Contact.countDocuments({ 
        owner: userId,
        phone: { $exists: true, $ne: null, $ne: '' },
        lists: targetList
      });
      console.warn(`   📋 Contatti nella lista "${targetList}" con telefono: ${inList}`);
      
      if (inList === 0) {
        console.warn(`   ❌ PROBLEMA: La lista "${targetList}" non contiene contatti con telefono!`);
        
        // Mostra liste disponibili
        const availableLists = await Contact.aggregate([
          { $match: { owner: userId, phone: { $exists: true, $ne: null, $ne: '' } } },
          { $unwind: '$lists' },
          { $group: { _id: '$lists', count: { $sum: 1 } } },
          { $sort: { count: -1 } }
        ]);
        
        if (availableLists.length > 0) {
          console.warn('   💡 Liste disponibili con contatti validi:');
          availableLists.forEach(list => {
            console.warn(`      - ${list._id}: ${list.count} contatti`);
          });
        } else {
          console.warn('   ❌ Nessuna lista contiene contatti con telefono!');
        }
        
        return [];
      }
    }
    
    if (contactFilters && contactFilters.status && contactFilters.status.length > 0) {
      const withStatus = await Contact.countDocuments({ 
        owner: userId,
        phone: { $exists: true, $ne: null, $ne: '' },
        ...(targetList && targetList !== 'all' ? { lists: targetList } : {}),
        status: { $in: contactFilters.status }
      });
      console.warn(`   🎯 Contatti con status ${contactFilters.status.join(', ')}: ${withStatus}`);
      
      if (withStatus === 0) {
        console.warn('   ❌ PROBLEMA: Nessun contatto ha gli status richiesti!');
        
        // Mostra status disponibili
        const availableStatuses = await Contact.aggregate([
          { 
            $match: { 
              owner: userId, 
              phone: { $exists: true, $ne: null, $ne: '' },
              ...(targetList && targetList !== 'all' ? { lists: targetList } : {})
            } 
          },
          { $group: { _id: '$status', count: { $sum: 1 } } },
          { $sort: { count: -1 } }
        ]);
        
        if (availableStatuses.length > 0) {
          console.warn('   💡 Status disponibili:');
          availableStatuses.forEach(status => {
            console.warn(`      - ${status._id || 'undefined'}: ${status.count} contatti`);
          });
        }
        
        return [];
      }
    }
    
    console.warn('   ❓ PROBLEMA SCONOSCIUTO: Tutti i filtri sembrano OK ma nessun contatto trovato');
  } else {
    console.log(`   ✅ Trovati ${contacts.length} contatti validi per la campagna`);
  }
  
  return contacts;
}

/**
 * Compila la coda dei messaggi
 */
async function compileMessageQueue(contacts, messageTemplate, templateVariables) {
  return contacts.map(contact => {
    let compiledMessage = messageTemplate;
    
    // Sostituisci variabili
    for (const variable of templateVariables) {
      const value = getContactVariable(contact, variable);
      compiledMessage = compiledMessage.replace(
        new RegExp(`\\{${variable}\\}`, 'g'),
        value || `{${variable}}`
      );
    }
    
    return {
      contactId: contact._id,
      phoneNumber: contact.phone,
      compiledMessage,
      status: 'pending',
      sequenceId: 'main', // NUOVO: Messaggio principale
      sequenceIndex: 0,   // NUOVO: Primo messaggio della sequenza
      hasReceivedResponse: false // NUOVO: Inizialmente nessuna risposta
    };
  });
}

/**
 * Ottieni il valore di una variabile per un contatto
 */
function getContactVariable(contact, variable) {
  // Variabili predefinite
  const predefined = {
    'nome': contact.name,
    'email': contact.email,
    'telefono': contact.phone
  };
  
  if (predefined[variable]) {
    return predefined[variable];
  }
  
  // Cerca nelle proprietà dinamiche
  return contact.properties ? contact.properties[variable] : undefined;
}

/**
 * Determina il tipo di file dal mimetype
 */
function getFileType(mimetype) {
  if (mimetype.startsWith('image/')) return 'image';
  if (mimetype.startsWith('audio/')) return 'audio';
  if (mimetype.startsWith('video/')) return 'video';
  return 'document';
} 