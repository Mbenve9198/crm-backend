import WhatsappCampaign from '../models/whatsappCampaignModel.js';
import WhatsappSession from '../models/whatsappSessionModel.js';
import Contact from '../models/contactModel.js';
import whatsappService from '../services/whatsappService.js';
import multer from 'multer';
import path from 'path';
import fs from 'fs/promises';
import { uploadAudio, uploadToImageKit } from '../config/imagekit.js'; // 🎤 NUOVO

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
    const allowedTypes = /jpeg|jpg|png|gif|mp4|mov|avi|mp3|wav|ogg|opus|m4a|aac|webm|pdf|doc|docx|txt/;
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
      .select('-messageQueue') // 🚀 CRITICO: Escludi messageQueue (può avere 30K elementi!)
      .populate('owner', 'firstName lastName email')
      .populate('createdBy', 'firstName lastName')
      .sort({ updatedAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit)
      .allowDiskUse(true); // 🚀 Permette sort su disco per grandi dataset

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

    // 🚀 Carica campagna SENZA messageQueue (troppo grande)
    const campaign = await WhatsappCampaign.findOne({
      _id: campaignId,
      owner: userId
    })
      .select('-messageQueue') // Escludi messageQueue dalla query principale
      .populate('owner', 'firstName lastName email')
      .populate('createdBy', 'firstName lastName');

    if (!campaign) {
      return res.status(404).json({
        success: false,
        message: 'Campagna non trovata'
      });
    }

    // 🚀 Carica solo un subset della messageQueue per preview (primi 100)
    const campaignWithQueue = await WhatsappCampaign.findById(campaignId)
      .select('messageQueue')
      .slice('messageQueue', 100); // Solo primi 100 messaggi

    // Unisci i dati
    const campaignData = campaign.toObject();
    campaignData.messageQueue = campaignWithQueue?.messageQueue || [];
    campaignData.messageQueueTruncated = campaign.stats.totalContacts > 100; // Flag per indicare che è troncato

    res.json({
      success: true,
      data: campaignData
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
      mode, // 🤖 NUOVO: 'standard' o 'autopilot'
      autopilotConfig, // 🤖 NUOVO: Configurazione autopilot
      messageTemplate,
      attachments, // 🎤 Attachments per messaggio principale (inclusi vocali)
      messageSequences, // NUOVO: Sequenze di messaggi di follow-up
      priority, // ✅ Sistema priorità
      timing,
      scheduledStartAt
    } = req.body;

    // 🤖 Validazione mode
    const campaignMode = mode || 'standard';
    if (!['standard', 'autopilot'].includes(campaignMode)) {
      return res.status(400).json({
        success: false,
        message: 'Mode deve essere "standard" o "autopilot"'
      });
    }

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

    // 🤖 Validazione: dipende dal mode
    if (campaignMode === 'standard') {
      // Mode standard: messaggio principale deve avere testo O vocale
      const hasMainMessage = messageTemplate && messageTemplate.trim();
      const hasMainVoice = attachments && attachments.some(a => a.type === 'voice');
      
      if (!hasMainMessage && !hasMainVoice) {
        return res.status(400).json({
          success: false,
          message: 'Il messaggio principale deve avere almeno un testo o un vocale'
        });
      }
    } else if (campaignMode === 'autopilot') {
      // Mode autopilot: validazione configurazione
      if (!autopilotConfig) {
        return res.status(400).json({
          success: false,
          message: 'autopilotConfig obbligatorio per campagne autopilot'
        });
      }

      // Validazione che i contatti abbiano i campi richiesti (lat/lng)
      // Questo sarà fatto dinamicamente durante l'invio
      console.log('🤖 Campagna autopilot: messaggio verrà generato dinamicamente con AI');
    }

    // Estrai variabili dal template principale (se presente)
    const templateVariables = messageTemplate ? extractTemplateVariables(messageTemplate) : [];

    // Processa le sequenze di messaggi se presenti
    let processedSequences = [];
    if (messageSequences && Array.isArray(messageSequences) && messageSequences.length > 0) {
      processedSequences = await Promise.all(messageSequences.map(async (seq) => {
        const processed = {
        ...seq,
          templateVariables: extractTemplateVariables(seq.messageTemplate || '')
        };
        
        // 🎤 Attachment già uploadato su ImageKit dal frontend
        // L'URL è pubblico e pronto all'uso
        if (seq.attachment && seq.attachment.url) {
          console.log(`🎤 Vocale ImageKit trovato per sequenza ${seq.id}: ${seq.attachment.url}`);
        }
        
        return processed;
      }));
    }

    // Ottieni contatti target
    const contacts = await getTargetContacts(targetList, contactFilters, userId, req.user);

    if (contacts.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Nessun contatto trovato con i criteri specificati'
      });
    }

    // 🚀 OTTIMIZZAZIONE: Crea campagna vuota prima, compila coda dopo
    // Con 17K+ contatti, evita timeout di 30s
    const campaign = new WhatsappCampaign({
      name,
      description,
      whatsappSessionId,
      whatsappNumber: session.phoneNumber,
      targetList,
      contactFilters,
      mode: campaignMode, // 🤖 NUOVO
      autopilotConfig: campaignMode === 'autopilot' ? autopilotConfig : undefined, // 🤖 NUOVO
      messageTemplate: messageTemplate || '', // 🎤 Può essere vuoto se c'è vocale o autopilot
      templateVariables,
      attachments: attachments || [], // 🎤 Include vocali per messaggio principale
      messageSequences: processedSequences, // NUOVO: Include le sequenze
      priority: priority || 'media', // ✅ Default priorità media
      timing,
      scheduledStartAt: scheduledStartAt ? new Date(scheduledStartAt) : null,
      messageQueue: [], // ← Vuota inizialmente
      owner: userId,
      createdBy: userId,
      status: scheduledStartAt ? 'scheduled' : 'draft'
    });

    await campaign.save();
    
    console.log(`✅ Campagna creata: ${campaign.name} (${contacts.length} contatti)`);

    // Rispondi subito al client (no timeout)
    const responseMessage = campaignMode === 'autopilot' 
      ? `Campagna autopilot creata. Compilazione ${contacts.length} messaggi in corso... I messaggi verranno generati con AI al momento dell'invio.`
      : `Campagna creata. Compilazione ${contacts.length} messaggi in corso...`;

    res.status(201).json({
      success: true,
      data: campaign,
      message: responseMessage
    });
    
    // 🚀 Compila messageQueue in background (non blocca response)
    setImmediate(async () => {
      try {
        console.log(`📝 Inizio compilazione messageQueue per ${contacts.length} contatti...`);
        
        // 🤖 Per autopilot, crea placeholder (messaggio verrà generato al momento dell'invio)
        let messageQueue;
        if (campaignMode === 'autopilot') {
          messageQueue = contacts.map(contact => ({
            contactId: contact._id,
            phoneNumber: contact.phone,
            compiledMessage: '[AUTOPILOT - Messaggio verrà generato con AI]', // Placeholder
            status: 'pending',
            sequenceId: 'main',
            sequenceIndex: 0,
            hasReceivedResponse: false
          }));
          console.log(`🤖 MessageQueue autopilot: ${messageQueue.length} placeholder creati`);
        } else {
          messageQueue = await compileMessageQueue(contacts, messageTemplate, templateVariables);
          console.log(`✅ MessageQueue standard: ${messageQueue.length} messaggi compilati`);
        }
        
        campaign.messageQueue = messageQueue;
        campaign.updateStats();
        await campaign.save();
        
        console.log(`✅ MessageQueue salvata: ${messageQueue.length} messaggi`);
      } catch (error) {
        console.error(`❌ Errore compilazione messageQueue background:`, error);
      }
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
 * Cambia la sessione WhatsApp di una campagna (anche in corso)
 * PUT /whatsapp-campaigns/:id/change-session
 */
export const changeCampaignSession = async (req, res) => {
  try {
    const campaignId = req.params.id;
    const userId = req.user._id;
    const { newWhatsappSessionId } = req.body;

    console.log(`🔄 Richiesta cambio sessione per campagna ${campaignId}`);

    // Valida input
    if (!newWhatsappSessionId) {
      return res.status(400).json({
        success: false,
        message: 'newWhatsappSessionId è obbligatorio'
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
        message: 'Campagna non trovata'
      });
    }

    // ✅ PERMETTI CAMBIO ANCHE PER CAMPAGNE IN CORSO
    // Non blocchiamo per status - è sicuro cambiare la sessione in qualsiasi momento
    console.log(`📊 Campagna attuale: status=${campaign.status}, sessionId=${campaign.whatsappSessionId}`);

    // Verifica che non stia cercando di impostare la stessa sessione
    if (campaign.whatsappSessionId === newWhatsappSessionId) {
      return res.status(400).json({
        success: false,
        message: 'La nuova sessione è uguale a quella attuale'
      });
    }

    // Verifica che la nuova sessione esista e sia dell'utente
    const newSession = await WhatsappSession.findOne({
      sessionId: newWhatsappSessionId,
      owner: userId
    });

    if (!newSession) {
      return res.status(400).json({
        success: false,
        message: 'Nuova sessione WhatsApp non trovata o non autorizzata'
      });
    }

    // Verifica che la nuova sessione sia connessa
    if (!newSession.isActive()) {
      return res.status(400).json({
        success: false,
        message: 'La nuova sessione WhatsApp deve essere connessa e attiva',
        details: {
          sessionStatus: newSession.status,
          sessionNumber: newSession.phoneNumber
        }
      });
    }

    // Salva vecchia sessione per logging e risposta
    const oldSessionId = campaign.whatsappSessionId;
    const oldNumber = campaign.whatsappNumber;

    // 🔄 Aggiorna la campagna con la nuova sessione
    campaign.whatsappSessionId = newWhatsappSessionId;
    campaign.whatsappNumber = newSession.phoneNumber;
    campaign.lastModifiedBy = userId;
    
    await campaign.save();

    console.log(`✅ Sessione cambiata con successo per campagna "${campaign.name}"`);
    console.log(`   Da: ${oldSessionId} (${oldNumber})`);
    console.log(`   A:  ${newWhatsappSessionId} (${newSession.phoneNumber})`);
    console.log(`   Messaggi pending: ${campaign.messageQueue.filter(m => m.status === 'pending').length}`);

    res.json({
      success: true,
      data: campaign,
      message: `Sessione cambiata con successo. I messaggi rimanenti verranno inviati tramite ${newSession.phoneNumber}`,
      changes: {
        oldSessionId,
        oldNumber,
        newSessionId: newWhatsappSessionId,
        newNumber: newSession.phoneNumber,
        campaignStatus: campaign.status,
        pendingMessages: campaign.messageQueue.filter(m => m.status === 'pending').length,
        sentMessages: campaign.messageQueue.filter(m => ['sent', 'delivered', 'read'].includes(m.status)).length
      }
    });

  } catch (error) {
    console.error('❌ Errore cambio sessione campagna:', error);
    res.status(500).json({
      success: false,
      message: 'Errore interno del server',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
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

    // 🤖 Validazione messaggio principale (dipende dal mode)
    if (campaign.mode === 'standard') {
      // Mode standard: richiede testo O vocale
      const hasMainText = campaign.messageTemplate && campaign.messageTemplate.trim();
      const hasMainVoice = campaign.attachments && campaign.attachments.some(a => a.type === 'voice');
      
      if (!hasMainText && !hasMainVoice) {
        return res.status(400).json({
          success: false,
          message: 'Il messaggio principale deve avere almeno un testo o un vocale'
        });
      }
    } else if (campaign.mode === 'autopilot') {
      // Mode autopilot: validazione configurazione
      if (!campaign.autopilotConfig || !campaign.autopilotConfig.searchKeyword) {
        return res.status(400).json({
          success: false,
          message: 'Configurazione autopilot non valida (manca searchKeyword)'
        });
      }
      console.log('🤖 Campagna autopilot: messaggio verrà generato dinamicamente con AI');
    }
    
    // 🎤 Validazione vocali nelle sequenze prima di avviare
    if (campaign.messageSequences && campaign.messageSequences.length > 0) {
      for (const sequence of campaign.messageSequences) {
        // Controlla che ci sia almeno un messaggio o un vocale
        const hasMessage = sequence.messageTemplate && sequence.messageTemplate.trim();
        const hasAttachment = sequence.attachment && sequence.attachment.url;
        
        if (!hasMessage && !hasAttachment) {
          return res.status(400).json({
            success: false,
            message: `La sequenza "${sequence.id}" deve avere almeno un messaggio di testo o un vocale`
          });
        }
        
        // Se c'è un vocale, verifica che l'URL sia valido
        if (hasAttachment && sequence.attachment.type === 'voice') {
          const audioUrl = sequence.attachment.url;
          
          // Verifica che non sia un URL trasformato da ImageKit
          if (audioUrl.includes('/ik-video.mp4') || audioUrl.includes('/ik-audio.mp3')) {
            return res.status(400).json({
              success: false,
              message: `❌ Il vocale della sequenza "${sequence.id}" ha un URL ImageKit trasformato. Ricarica il vocale in formato MP3 o M4A.`,
              details: 'ImageKit ha applicato trasformazioni automatiche. Usa formati MP3 o M4A che non vengono trasformati.'
            });
          }
          
          // Verifica che l'URL sia ImageKit o DataURL
          if (!audioUrl.startsWith('http') && !audioUrl.startsWith('data:')) {
            return res.status(400).json({
              success: false,
              message: `URL vocale non valido nella sequenza "${sequence.id}"`
            });
          }
          
          console.log(`✅ Vocale validato per sequenza ${sequence.id}: ${audioUrl.substring(0, 100)}...`);
        }
      }
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
 * 🎤 Upload audio diretto su ImageKit (senza campaignId)
 * POST /whatsapp-campaigns/upload-audio
 * Usato quando si registra vocale PRIMA di creare la campagna
 */
export const uploadAudioDirect = [
  uploadAudio.single('audio'),
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({
          success: false,
          message: 'File audio non fornito'
        });
      }

      console.log(`🎤 Upload diretto vocale: ${req.file.originalname} (${(req.file.size / 1024).toFixed(2)} KB)`);

      // Upload su ImageKit
      const ext = path.extname(req.file.originalname);
      const fileName = `voice-${Date.now()}-${Math.round(Math.random() * 1E9)}${ext}`;
      
      console.log(`📤 Upload su ImageKit: ${fileName} (${req.file.mimetype})`);
      
      // 🎤 Upload diretto usando imagekit SDK
      const fileBuffer = await fs.readFile(req.file.path);
      
      const imagekitResult = await imagekit.upload({
        file: fileBuffer,
        fileName: fileName,
        folder: 'whatsapp-campaign-audio',
        useUniqueFileName: false,
        isPrivateFile: false,
        tags: ['whatsapp-voice', 'campaign-audio']
      });
      
      // Cleanup file temporaneo
      await fs.unlink(req.file.path);
      
      // 🎤 Costruisci URL senza trasformazioni usando filePath
      const audioUrl = `${process.env.IMAGEKIT_URL_ENDPOINT}${imagekitResult.filePath}`;
      
      // 🎤 Verifica che l'URL non contenga trasformazioni
      if (audioUrl.includes('/ik-video.mp4') || audioUrl.includes('/ik-audio.mp3')) {
        console.error(`❌ ImageKit ha applicato trasformazioni: ${audioUrl}`);
        return res.status(500).json({
          success: false,
          message: 'ImageKit ha trasformato il file audio. Riprova con formato MP3 o M4A.',
          details: audioUrl
        });
      }

      console.log(`✅ Vocale uploadato su ImageKit:`);
      console.log(`   - URL originale: ${audioUrl}`);
      console.log(`   - fileId: ${imagekitResult.fileId}`);
      console.log(`   - filePath: ${imagekitResult.filePath}`);

      res.json({
        success: true,
        data: {
          attachment: {
            type: 'voice',
            filename: req.file.originalname,
            url: audioUrl, // 🎤 URL originale (no trasformazioni)
            fileId: imagekitResult.fileId,
            size: req.file.size,
            duration: req.body.duration ? parseInt(req.body.duration) : null
          }
        },
        message: 'Vocale caricato su ImageKit con successo'
      });

    } catch (error) {
      console.error('Errore upload audio diretto:', error);
      res.status(500).json({
        success: false,
        message: 'Errore interno del server'
      });
    }
  }
];

/**
 * 🎤 Upload audio/vocale per una sequenza specifica
 * POST /whatsapp-campaigns/:id/sequences/:sequenceId/audio
 */
export const uploadSequenceAudio = [
  upload.single('audio'),
  async (req, res) => {
    try {
      const { id: campaignId, sequenceId } = req.params;
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
          message: 'Impossibile modificare una campagna in esecuzione'
        });
      }

      if (!req.file) {
        return res.status(400).json({
          success: false,
          message: 'File audio non fornito'
        });
      }

      // Trova la sequenza specifica
      const sequence = campaign.messageSequences.find(seq => seq.id === sequenceId);
      
      if (!sequence) {
        return res.status(404).json({
          success: false,
          message: 'Sequenza non trovata'
        });
      }

      // Crea l'oggetto allegato audio
      const audioAttachment = {
        type: 'voice', // Tipo specifico per vocali PTT
        filename: req.file.originalname,
        url: `/uploads/whatsapp/${req.file.filename}`,
        size: req.file.size,
        duration: req.body.duration ? parseInt(req.body.duration) : null // Durata in secondi se fornita
      };

      // Aggiungi/aggiorna l'allegato della sequenza
      sequence.attachment = audioAttachment;
      
      await campaign.save();

      console.log(`🎤 Audio caricato per sequenza ${sequenceId}: ${req.file.originalname} (${(req.file.size / 1024).toFixed(2)} KB)`);

      res.json({
        success: true,
        data: {
          attachment: audioAttachment,
          sequenceId: sequenceId
        },
        message: 'Audio caricato con successo per la sequenza'
      });

    } catch (error) {
      console.error('Errore upload audio sequenza:', error);
      res.status(500).json({
        success: false,
        message: 'Errore interno del server'
      });
    }
  }
];

/**
 * 🗑️ Rimuovi audio da una sequenza
 * DELETE /whatsapp-campaigns/:id/sequences/:sequenceId/audio
 */
export const deleteSequenceAudio = async (req, res) => {
  try {
    const { id: campaignId, sequenceId } = req.params;
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
        message: 'Impossibile modificare una campagna in esecuzione'
      });
    }

    // Trova la sequenza specifica
    const sequence = campaign.messageSequences.find(seq => seq.id === sequenceId);
    
    if (!sequence) {
      return res.status(404).json({
        success: false,
        message: 'Sequenza non trovata'
      });
    }

    if (!sequence.attachment) {
      return res.status(404).json({
        success: false,
        message: 'Nessun audio associato a questa sequenza'
      });
    }

    // Elimina il file fisico se esiste
    try {
      const filePath = path.join(process.cwd(), sequence.attachment.url);
      await fs.unlink(filePath);
      console.log(`🗑️ File audio eliminato: ${filePath}`);
    } catch (error) {
      console.warn('⚠️ Errore eliminazione file fisico (potrebbe non esistere):', error.message);
    }

    // Rimuovi l'allegato dalla sequenza
    sequence.attachment = undefined;
    
    await campaign.save();

    res.json({
      success: true,
      message: 'Audio rimosso dalla sequenza'
    });

  } catch (error) {
    console.error('Errore rimozione audio sequenza:', error);
    res.status(500).json({
      success: false,
      message: 'Errore interno del server'
    });
  }
};

/**
 * Anteprima campagna (compila messaggi senza salvare)
 * POST /whatsapp-campaigns/preview
 */
export const previewCampaign = async (req, res) => {
  try {
    const userId = req.user._id;
    const { targetList, contactFilters, messageTemplate, limit = 5 } = req.body;

    // Ottieni contatti target
    const contacts = await getTargetContacts(targetList, contactFilters, userId, req.user);
    
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
async function getTargetContacts(targetList, contactFilters, userId, user = null) {
  // Filtro di ownership: manager e admin possono accedere a tutti i contatti
  const filter = {};
  
  // Solo agent e viewer sono limitati ai propri contatti
  if (user && user.hasRole('manager')) {
    // Manager e admin possono accedere a tutti i contatti
    console.log(`🎯 ${user.firstName} ${user.lastName} (${user.role}): accesso a tutti i contatti per campagna WhatsApp`);
  } else {
    // Agent e viewer limitati ai propri contatti
    filter.owner = userId;
    console.log(`🔒 Utente limitato ai propri contatti: ${userId}`);
  }
  
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
  console.log('   UserId:', userId);
  console.log('   User role:', user ? user.role : 'Non disponibile');
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
  if (mimetype.startsWith('audio/')) return 'audio'; // Per allegati generici
  if (mimetype.startsWith('video/')) return 'video';
  return 'document';
}

/**
 * Determina se un file audio è un vocale (per sequenze)
 */
function isVoiceFile(mimetype) {
  const voiceTypes = [
    'audio/ogg',
    'audio/opus', 
    'audio/webm',
    'audio/mpeg', // MP3
    'audio/mp4',  // M4A
    'audio/wav'
  ];
  return voiceTypes.some(type => mimetype.includes(type));
} 