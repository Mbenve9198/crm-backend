import mongoose from 'mongoose';
import Contact from './contactModel.js';

/**
 * Schema per le Campagne WhatsApp
 * Gestisce campagne di messaggi outbound con OpenWA
 */
const whatsappCampaignSchema = new mongoose.Schema({
  // Nome della campagna
  name: {
    type: String,
    required: [true, 'Il nome della campagna è obbligatorio'],
    trim: true,
    maxLength: [200, 'Il nome non può superare 200 caratteri']
  },
  
  // Descrizione della campagna
  description: {
    type: String,
    trim: true,
    maxLength: [1000, 'La descrizione non può superare 1000 caratteri']
  },
  
  // Session ID WhatsApp (numero collegato)
  whatsappSessionId: {
    type: String,
    required: [true, 'Session ID WhatsApp obbligatorio'],
    trim: true
  },
  
  // Numero WhatsApp collegato (per display)
  whatsappNumber: {
    type: String,
    required: [true, 'Numero WhatsApp obbligatorio'],
    trim: true
  },
  
  // Lista contatti selezionata
  targetList: {
    type: String,
    required: [true, 'Lista target obbligatoria'],
    trim: true
  },
  
  // Filtri contatti specifici (opzionale)
  contactFilters: {
    status: [String],
    properties: mongoose.Schema.Types.Mixed
  },
  
  // Template messaggio
  messageTemplate: {
    type: String,
    required: [true, 'Template messaggio obbligatorio'],
    maxLength: [4000, 'Il messaggio non può superare 4000 caratteri']
  },
  
  // Variabili rilevate nel template
  templateVariables: [String],
  
  // NUOVO: Sequenze di messaggi per follow-up automatici
  messageSequences: [{
    id: {
      type: String,
      required: true
    },
    messageTemplate: {
      type: String,
      required: false, // 🎤 Opzionale se c'è un attachment vocale
      default: '', // Default stringa vuota
      maxLength: [4000, 'Il messaggio della sequenza non può superare 4000 caratteri']
    },
    delayMinutes: {
      type: Number,
      required: true,
      min: [1, 'Delay minimo 1 minuto'],
      max: [10080, 'Delay massimo 7 giorni (10080 minuti)'] // 7 giorni in minuti
    },
    condition: {
      type: String,
      enum: ['no_response', 'always'],
      default: 'no_response'
    },
    isActive: {
      type: Boolean,
      default: true
    },
    templateVariables: [String], // Variabili rilevate nel template della sequenza
    
    // 🎤 NUOVO: Supporto per allegati audio/vocali nelle sequenze
    attachment: {
      type: {
        type: String,
        enum: ['voice', 'image', 'video', 'document'],
        required: false
      },
      filename: String,
      url: String,
      size: Number,
      duration: Number, // Durata in secondi (per audio)
      caption: String
    }
  }],
  
  // Media allegati
  attachments: [{
    type: {
      type: String,
      enum: ['image', 'audio', 'video', 'document'],
      required: true
    },
    filename: {
      type: String,
      required: true
    },
    url: {
      type: String,
      required: true
    },
    size: Number,
    caption: String
  }],
  
  // Priorità campagna (gestisce automaticamente timing e rate limiting)
  priority: {
    type: String,
    enum: ['alta', 'media', 'bassa'],
    default: 'media'
  },

  // Configurazione timing (mantenuta per backward compatibility)
  timing: {
    // Intervallo tra messaggi (in secondi) - DEPRECATED: ora gestito da priority
    intervalBetweenMessages: {
      type: Number,
      required: false, // Reso opzionale
      min: [5, 'Intervallo minimo 5 secondi'],
      max: [3600, 'Intervallo massimo 1 ora'],
      default: 120 // Default 2 minuti per backward compatibility
    },
    
    // Fascia oraria di invio (obbligatoria)
    schedule: {
      startTime: {
        type: String,
        required: [true, 'Orario di inizio obbligatorio'],
        validate: {
          validator: function(v) {
            return /^([01]?[0-9]|2[0-3]):[0-5][0-9]$/.test(v);
          },
          message: 'Formato orario non valido (HH:MM)'
        }
      },
      endTime: {
        type: String,
        required: [true, 'Orario di fine obbligatorio'],
        validate: {
          validator: function(v) {
            return /^([01]?[0-9]|2[0-3]):[0-5][0-9]$/.test(v);
          },
          message: 'Formato orario non valido (HH:MM)'
        }
      },
      timezone: {
        type: String,
        default: 'Europe/Rome'
      },
      daysOfWeek: [{
        type: String,
        enum: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']
      }]
    }
  },
  
  // Stato della campagna
  status: {
    type: String,
    enum: ['draft', 'scheduled', 'running', 'paused', 'completed', 'cancelled'],
    default: 'draft'
  },
  
  // Statistiche campagna
  stats: {
    totalContacts: {
      type: Number,
      default: 0
    },
    messagesSent: {
      type: Number,
      default: 0
    },
    messagesDelivered: {
      type: Number,
      default: 0
    },
    messagesRead: {
      type: Number,
      default: 0
    },
    repliesReceived: {
      type: Number,
      default: 0
    },
    errors: {
      type: Number,
      default: 0
    },
    // ✅ Nuovi campi per gestione manuale stati
    replied: {
      type: Number,
      default: 0
    },
    notInterested: {
      type: Number,
      default: 0
    },
    replyRate: {
      type: Number,
      default: 0
    },
    conversionRate: {
      type: Number,
      default: 0
    }
  },
  
  // Dettagli messaggi inviati (include sequenze multiple)
  messageQueue: [{
    contactId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Contact',
      required: true
    },
    phoneNumber: String,
    compiledMessage: String,
    status: {
      type: String,
      enum: ['pending', 'sent', 'delivered', 'read', 'failed', 'not_interested', 'replied'],
      default: 'pending'
    },
    scheduledAt: Date,
    sentAt: Date,
    deliveredAt: Date,
    readAt: Date,
    messageId: String, // ID del messaggio WhatsApp
    errorMessage: String,
    retryCount: {
      type: Number,
      default: 0
    },
    // NUOVO: Supporto per sequenze
    sequenceId: {
      type: String,
      default: 'main' // 'main' per il primo messaggio, poi ID della sequenza
    },
    sequenceIndex: {
      type: Number,
      default: 0 // 0 per il primo messaggio, poi 1, 2, 3...
    },
    followUpScheduledFor: Date, // Quando è programmato il prossimo follow-up
    hasReceivedResponse: {
      type: Boolean,
      default: false // Traccia se il contatto ha risposto
    },
    responseReceivedAt: Date, // Quando è stata ricevuta la risposta
    condition: {
      type: String,
      enum: ['no_response', 'always'],
      default: 'always' // Condizione per inviare il messaggio
    }
    // 🎤 NOTA: Attachment NON copiato qui (evita documenti enormi)
    // L'attachment viene letto da messageSequences quando serve
  }],
  
  // Configurazione retry
  retryConfig: {
    maxRetries: {
      type: Number,
      default: 3
    },
    retryDelay: {
      type: Number,
      default: 300 // 5 minuti
    }
  },
  
  // Utente proprietario
  owner: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'Owner obbligatorio']
  },
  
  // Date programmate
  scheduledStartAt: Date,
  actualStartedAt: Date,
  completedAt: Date,
  
  // Metadati
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  lastModifiedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indici per performance
whatsappCampaignSchema.index({ owner: 1, status: 1 });
whatsappCampaignSchema.index({ whatsappSessionId: 1 });
whatsappCampaignSchema.index({ targetList: 1 });
whatsappCampaignSchema.index({ 'messageQueue.status': 1 });
whatsappCampaignSchema.index({ scheduledStartAt: 1 });
whatsappCampaignSchema.index({ updatedAt: -1 }); // 🚀 Per sort su getCampaigns
whatsappCampaignSchema.index({ owner: 1, updatedAt: -1 }); // 🚀 Indice composto ottimale

// Metodi dello schema

/**
 * Aggiorna le statistiche della campagna
 */
whatsappCampaignSchema.methods.updateStats = function() {
  const totalMessages = this.messageQueue.length;
  const messagesSent = this.messageQueue.filter(m => ['sent', 'delivered', 'read'].includes(m.status)).length;
  const messagesDelivered = this.messageQueue.filter(m => ['delivered', 'read'].includes(m.status)).length;
  const messagesRead = this.messageQueue.filter(m => m.status === 'read').length;
  const messagesFailed = this.messageQueue.filter(m => m.status === 'failed').length;
  
  // ✅ Nuove statistiche per gestione manuale
  const messagesReplied = this.messageQueue.filter(m => m.status === 'replied').length;
  const messagesNotInterested = this.messageQueue.filter(m => m.status === 'not_interested').length;
  
  // ✅ LOGICA CORRETTA: Include repliesReceived esistenti nel calcolo
  const existingRepliesReceived = this.stats?.repliesReceived || 0;
  
  // Reply Rate: (replied manuali + not_interested + risposte automatiche) / messaggi_inviati
  const totalResponses = messagesReplied + messagesNotInterested + existingRepliesReceived;
  const replyRate = messagesSent > 0 ? ((totalResponses / messagesSent) * 100).toFixed(1) : 0;
  
  // Conversion Rate: (replied manuali + risposte automatiche) / messaggi_inviati  
  const totalPositiveResponses = messagesReplied + existingRepliesReceived;
  const conversionRate = messagesSent > 0 ? ((totalPositiveResponses / messagesSent) * 100).toFixed(1) : 0;
  
  const stats = {
    totalContacts: totalMessages,
    messagesSent,
    messagesDelivered,
    messagesRead,
    errors: messagesFailed,
    repliesReceived: existingRepliesReceived, // Mantieni valore esistente
    // ✅ Nuove statistiche
    replied: messagesReplied,
    notInterested: messagesNotInterested,
    replyRate: parseFloat(replyRate),
    conversionRate: parseFloat(conversionRate)
  };
  
  this.stats = { ...this.stats, ...stats };
  return this.stats;
};

/**
 * Ottiene i prossimi messaggi da inviare (include sia messaggi principali che follow-up)
 */
whatsappCampaignSchema.methods.getNextMessages = function(limit = 10) {
  const now = new Date();
  
  console.log(`🔍 getNextMessages chiamato per campagna ${this.name}, ora: ${now.toISOString()}`);
  
  // Controlla fascia oraria prima di restituire messaggi
  if (!this.isInAllowedTimeframe()) {
    console.log(`⏰ Fuori fascia oraria per campagna ${this.name}`);
    return []; // Nessun messaggio se fuori fascia oraria
  }
  
  // Debug: conta messaggi per tipo
  const pendingPrimary = this.messageQueue.filter(m => m.status === 'pending' && m.sequenceIndex === 0).length;
  const pendingFollowUps = this.messageQueue.filter(m => m.status === 'pending' && m.sequenceIndex > 0).length;
  console.log(`📊 Messaggi pending: ${pendingPrimary} principali, ${pendingFollowUps} follow-up`);
  
  // 🎤 NUOVO: Separa follow-up e principali, dai priorità ai follow-up
  const followUps = [];
  const principals = [];
  
  this.messageQueue.forEach(m => {
    if (m.status !== 'pending') return;
    
    // Messaggi principali (sequenceIndex = 0)
    if (m.sequenceIndex === 0) {
      if (!m.scheduledAt || m.scheduledAt <= now) {
        principals.push(m);
      }
      return;
    }
    
    // Follow-up (sequenceIndex > 0)
    if (m.sequenceIndex > 0) {
      // Debug per questo specifico follow-up
      const scheduledFor = m.followUpScheduledFor ? new Date(m.followUpScheduledFor) : null;
      const isTimeReady = scheduledFor && scheduledFor <= now;
      
      console.log(`  🔍 Follow-up seq ${m.sequenceIndex}: scheduled ${scheduledFor?.toISOString()}, now: ${now.toISOString()}, ready: ${isTimeReady}, hasResponse: ${m.hasReceivedResponse}`);
      
      // Deve essere il momento giusto per il follow-up
      if (!m.followUpScheduledFor || m.followUpScheduledFor > now) {
        return;
      }
      
      // Se la condizione è 'no_response', controlla che non ci sia stata risposta
      const sequence = this.messageSequences.find(seq => seq.id === m.sequenceId);
      if (sequence && sequence.condition === 'no_response' && m.hasReceivedResponse) {
        console.log(`  ⏭️ Follow-up seq ${m.sequenceIndex} skipped - contatto ha già risposto`);
        return;
      }
      
      followUps.push(m);
    }
  });
  
  // 🎤 PRIORITÀ: Follow-up PRIMA dei principali
  const messages = [...followUps, ...principals].slice(0, limit);
    
  console.log(`📬 Trovati ${messages.length} messaggi pronti (${followUps.length} follow-up, ${principals.length} principali)`);
  return messages;
};

/**
 * Marca un messaggio come inviato
 */
whatsappCampaignSchema.methods.markMessageSent = async function(contactId, messageId, sequenceIndex = null) {
  // Trova il messaggio specifico da marcare come inviato
  // Priorità: messaggio pending con sequenceIndex specifico, altrimenti il primo pending
  let message;
  
  if (sequenceIndex !== null) {
    // Cerca messaggio specifico per sequenceIndex
    message = this.messageQueue.find(m => 
      m.contactId.toString() === contactId.toString() && 
      m.sequenceIndex === sequenceIndex &&
      m.status === 'pending'
    );
  }
  
  // Fallback: trova il primo messaggio pending per questo contatto
  if (!message) {
    message = this.messageQueue.find(m => 
      m.contactId.toString() === contactId.toString() && 
      m.status === 'pending'
    );
  }
  
  if (message) {
    message.status = 'sent';
    message.sentAt = new Date();
    message.messageId = messageId;
    
    // ✅ SINCRONIZZAZIONE STATO CONTATTO: Solo per messaggi principali (sequenceIndex = 0)
    if (message.sequenceIndex === 0) {
      try {
        const contact = await Contact.findById(contactId);
        if (contact && !['won', 'lost'].includes(contact.status)) {
          const oldStatus = contact.status;
          contact.status = 'contattato';
          await contact.save();
        }
      } catch (error) {
        console.error(`❌ Error updating contact status for ${contactId}:`, error);
      }
    }
  } else {
    console.warn(`⚠️ No pending message found to mark as sent for contact ${contactId}, sequenceIndex ${sequenceIndex}`);
  }
  
  return message;
};

/**
 * Marca un messaggio come fallito
 */
whatsappCampaignSchema.methods.markMessageFailed = function(contactId, errorMessage, sequenceIndex = null) {
  // Trova il messaggio specifico da marcare come fallito
  let message;
  
  if (sequenceIndex !== null) {
    // Cerca messaggio specifico per sequenceIndex
    message = this.messageQueue.find(m => 
      m.contactId.toString() === contactId.toString() && 
      m.sequenceIndex === sequenceIndex &&
      m.status === 'pending'
    );
  }
  
  // Fallback: trova il primo messaggio pending per questo contatto
  if (!message) {
    message = this.messageQueue.find(m => 
      m.contactId.toString() === contactId.toString() && 
      m.status === 'pending'
    );
  }
  
  if (message) {
    message.status = 'failed';
    message.errorMessage = errorMessage;
    message.retryCount += 1;
  } else {
    console.warn(`⚠️ No pending message found to mark as failed for contact ${contactId}, sequenceIndex ${sequenceIndex}`);
  }
  
  return message;
};

/**
 * Marca un messaggio come "replied" (contatto ha risposto)
 */
whatsappCampaignSchema.methods.markMessageAsReplied = async function(contactId, sequenceIndex = null) {
  // Trova il messaggio specifico
  let message;
  
  if (sequenceIndex !== null) {
    message = this.messageQueue.find(m => 
      m.contactId.toString() === contactId.toString() && 
      m.sequenceIndex === sequenceIndex
    );
  }
  
  // Fallback: trova il primo messaggio per questo contatto
  if (!message) {
    message = this.messageQueue.find(m => 
      m.contactId.toString() === contactId.toString()
    );
  }
  
  if (message) {
    message.status = 'replied';
    message.responseReceivedAt = new Date();
    message.hasReceivedResponse = true;
    
    // ✅ SINCRONIZZAZIONE STATO CONTATTO: Rollback a "contattato"
    try {
      const contact = await Contact.findById(contactId);
      if (contact && !['won', 'lost'].includes(contact.status)) {
        const oldStatus = contact.status;
        contact.status = 'contattato';
        await contact.save();
      }
    } catch (error) {
      console.error(`❌ Error updating contact status for ${contactId}:`, error);
    }
    
    // Cancella follow-up programmati per questo contatto
    this.cancelFollowUpsForContact(contactId);
  } else {
    console.warn(`⚠️ No message found to mark as replied for contact ${contactId}`);
  }
  
  return message;
};

/**
 * Marca un messaggio come "not_interested" (contatto non interessato)
 */
whatsappCampaignSchema.methods.markMessageAsNotInterested = async function(contactId, sequenceIndex = null) {
  // Trova il messaggio specifico
  let message;
  
  if (sequenceIndex !== null) {
    message = this.messageQueue.find(m => 
      m.contactId.toString() === contactId.toString() && 
      m.sequenceIndex === sequenceIndex
    );
  }
  
  // Fallback: trova il primo messaggio per questo contatto
  if (!message) {
    message = this.messageQueue.find(m => 
      m.contactId.toString() === contactId.toString()
    );
  }
  
  if (message) {
    message.status = 'not_interested';
    message.responseReceivedAt = new Date();
    message.hasReceivedResponse = true;
    
    // ✅ SINCRONIZZAZIONE STATO CONTATTO: Aggiorna sempre a "non interessato"
    try {
      const contact = await Contact.findById(contactId);
      if (contact) {
        const oldStatus = contact.status;
        contact.status = 'non interessato';
        await contact.save();
      }
    } catch (error) {
      console.error(`❌ Error updating contact status for ${contactId}:`, error);
    }
    
    // Cancella follow-up programmati per questo contatto
    this.cancelFollowUpsForContact(contactId);
  } else {
    console.warn(`⚠️ No message found to mark as not interested for contact ${contactId}`);
  }
  
  return message;
};

/**
 * Cancella follow-up programmati per un contatto specifico
 */
whatsappCampaignSchema.methods.cancelFollowUpsForContact = function(contactId) {
  const cancelledCount = this.messageQueue.filter(m => 
    m.contactId.toString() === contactId.toString() && 
    m.status === 'pending' && 
    m.sequenceIndex > 0
  ).length;
  
  // Rimuovi tutti i follow-up pending per questo contatto
  this.messageQueue = this.messageQueue.filter(m => 
    !(m.contactId.toString() === contactId.toString() && 
      m.status === 'pending' && 
      m.sequenceIndex > 0)
  );
  
  if (cancelledCount > 0) {
    console.log(`🗑️ Cancelled ${cancelledCount} follow-up messages for contact ${contactId}`);
  }
  
  return cancelledCount;
};

/**
 * Verifica se la campagna può essere avviata
 */
whatsappCampaignSchema.methods.canStart = function() {
  return this.status === 'draft' || this.status === 'scheduled';
};

/**
 * Verifica se la campagna è attiva
 */
whatsappCampaignSchema.methods.isActive = function() {
  return this.status === 'running';
};

/**
 * Verifica se siamo nella fascia oraria consentita per l'invio
 */
whatsappCampaignSchema.methods.isInAllowedTimeframe = function() {
  if (!this.timing.schedule.startTime || !this.timing.schedule.endTime) {
    return true; // Se non c'è fascia oraria configurata, sempre permesso
  }
  
  const now = new Date();
  const timezone = this.timing.schedule.timezone || 'Europe/Rome';
  
  // Ottieni l'ora attuale nel fuso orario della campagna
  const currentTimeInTimezone = new Intl.DateTimeFormat('it-IT', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(now);
  
  const startTime = this.timing.schedule.startTime;
  const endTime = this.timing.schedule.endTime;
  
  return currentTimeInTimezone >= startTime && currentTimeInTimezone <= endTime;
};

/**
 * Marca una risposta ricevuta per un contatto
 */
whatsappCampaignSchema.methods.markResponseReceived = function(contactId) {
  const messages = this.messageQueue.filter(m => 
    m.contactId.toString() === contactId.toString()
  );
  
  for (const message of messages) {
    if (!message.hasReceivedResponse) {
      message.hasReceivedResponse = true;
      message.responseReceivedAt = new Date();
    }
  }
  
  return messages;
};

/**
 * Ottiene i prossimi follow-up da inviare
 */
whatsappCampaignSchema.methods.getNextFollowUps = function(limit = 10) {
  const now = new Date();
  
  return this.messageQueue
    .filter(m => 
      m.status === 'pending' && 
      m.sequenceIndex > 0 && // Solo follow-up, non messaggi principali
      m.followUpScheduledFor && 
      m.followUpScheduledFor <= now &&
      (m.condition === 'always' || !m.hasReceivedResponse) // Rispetta la condizione
    )
    .slice(0, limit);
};

/**
 * Programma i follow-up per un contatto dopo l'invio del messaggio principale
 */
whatsappCampaignSchema.methods.scheduleFollowUps = async function(contactId, phoneNumber) {
  console.log(`🔍 scheduleFollowUps chiamato per contatto ${contactId}, phone: ${phoneNumber}`);
  
  if (!this.messageSequences || this.messageSequences.length === 0) {
    console.log(`⚠️ Nessuna sequenza configurata nella campagna ${this.name}`);
    return; // Nessuna sequenza configurata
  }

  console.log(`📋 Trovate ${this.messageSequences.length} sequenze configurate`);

  // ✅ SOLUZIONE 2: Controlla se esistono già follow-up per questo contatto
  const existingFollowUps = this.messageQueue.filter(m => 
    m.contactId.toString() === contactId.toString() && 
    m.sequenceIndex > 0
  );
  
  if (existingFollowUps.length > 0) {
    console.log(`⏭️ Follow-up già esistenti per contatto ${contactId}: ${existingFollowUps.length} sequenze già programmate`);
    return; // Follow-up già programmati, evita duplicazione
  }

  const sentTime = new Date();
  
  console.log(`📅 Programmazione ${this.messageSequences.length} follow-up per contatto ${contactId}`);
  
  for (let i = 0; i < this.messageSequences.length; i++) {
    const sequence = this.messageSequences[i];
    
    if (!sequence.isActive) {
      console.log(`⏭️ Sequenza ${sequence.id} non attiva, saltata`);
      continue;
    }

    // Calcola quando inviare questo follow-up
    const followUpTime = new Date(sentTime.getTime() + sequence.delayMinutes * 60 * 1000);
    
    console.log(`  ⏰ Sequenza ${i + 1}: delay ${sequence.delayMinutes} min, invio programmato: ${followUpTime.toISOString()}`);
    
    // Compila il messaggio della sequenza
    const compiledMessage = await this.compileMessageTemplate(sequence.messageTemplate, contactId);
    console.log(`  📝 Messaggio compilato: "${compiledMessage.substring(0, 50)}${compiledMessage.length > 50 ? '...' : ''}"`);

    
    // Prepara il messaggio per la coda
    const queueMessage = {
      contactId: contactId,
      phoneNumber: phoneNumber,
      compiledMessage: compiledMessage,
      status: 'pending',
      sequenceId: sequence.id,
      sequenceIndex: i + 1,
      followUpScheduledFor: followUpTime,
      hasReceivedResponse: false,
      retryCount: 0,
      condition: sequence.condition // Aggiungi la condizione per facilitare il controllo
    };
    
    // 🎤 OTTIMIZZATO: NON copiare attachment (evita documenti enormi)
    // L'attachment verrà letto dalla sequenza quando serve
    if (sequence.attachment && sequence.attachment.type && sequence.attachment.url) {
      console.log(`🎤 Sequenza ${i + 1} ha allegato ${sequence.attachment.type} (salvato nella sequenza, non copiato)`);
    }
    
    // Aggiungi alla coda (SENZA attachment copiato)
    this.messageQueue.push(queueMessage);
    
    console.log(`📝 Follow-up ${i + 1} programmato per ${followUpTime.toISOString()}, sequenza: ${sequence.id}`);
  }
  
  console.log(`✅ ${this.messageSequences.filter(s => s.isActive).length} follow-up programmati con successo per contatto ${contactId}`);
};

/**
 * Compila un template di messaggio con le variabili del contatto
 */
whatsappCampaignSchema.methods.compileMessageTemplate = async function(template, contactId) {
  try {
    // Popola il contatto per avere accesso ai suoi dati
    const Contact = mongoose.model('Contact');
    const contact = await Contact.findById(contactId);
    
    if (!contact) {
      return template;
    }

    let compiledMessage = template;
    
    // Sostituzioni predefinite
    const variables = {
      'nome': contact.name,
      'email': contact.email,
      'telefono': contact.phone
    };
    
    // Aggiungi proprietà dinamiche
    if (contact.properties) {
      Object.assign(variables, contact.properties);
    }
    
    // Sostituisci tutte le variabili
    for (const [key, value] of Object.entries(variables)) {
      if (value) {
        compiledMessage = compiledMessage.replace(
          new RegExp(`\\{${key}\\}`, 'g'),
          String(value)
        );
      }
    }
    
    return compiledMessage;
    
  } catch (error) {
    console.error('Errore compilazione template:', error);
    return template; // Fallback al template originale
  }
};

// Metodi statici

/**
 * Trova campagne attive per session ID
 */
whatsappCampaignSchema.statics.findActiveBySession = function(sessionId) {
  return this.find({
    whatsappSessionId: sessionId,
    status: 'running'
  });
};

/**
 * Trova campagne da eseguire
 */
whatsappCampaignSchema.statics.findScheduledToRun = function() {
  const now = new Date();
  return this.find({
    status: 'scheduled',
    scheduledStartAt: { $lte: now }
  });
};

// Middleware pre-save
whatsappCampaignSchema.pre('save', function(next) {
  // Aggiorna le statistiche automaticamente
  if (this.isModified('messageQueue')) {
    this.updateStats();
  }
  
  // Imposta date automaticamente
  if (this.isModified('status')) {
    if (this.status === 'running' && !this.actualStartedAt) {
      this.actualStartedAt = new Date();
    }
    if (this.status === 'completed' && !this.completedAt) {
      this.completedAt = new Date();
    }
  }
  
  next();
});

const WhatsappCampaign = mongoose.model('WhatsappCampaign', whatsappCampaignSchema);
export default WhatsappCampaign; 