import mongoose from 'mongoose';

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
      required: true,
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
    templateVariables: [String] // Variabili rilevate nel template della sequenza
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
  
  // Configurazione timing
  timing: {
    // Intervallo tra messaggi (in secondi)
    intervalBetweenMessages: {
      type: Number,
      required: true,
      min: [5, 'Intervallo minimo 5 secondi'],
      max: [3600, 'Intervallo massimo 1 ora']
    },
    
    // Limite messaggi per ora
    messagesPerHour: {
      type: Number,
      default: 60,
      min: [1, 'Minimo 1 messaggio per ora'],
      max: [200, 'Massimo 200 messaggi per ora']
    },
    
    // Orario di invio (opzionale)
    schedule: {
      startTime: String, // HH:MM
      endTime: String,   // HH:MM
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
      enum: ['pending', 'sent', 'delivered', 'read', 'failed'],
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

// Metodi dello schema

/**
 * Aggiorna le statistiche della campagna
 */
whatsappCampaignSchema.methods.updateStats = function() {
  const stats = {
    totalContacts: this.messageQueue.length,
    messagesSent: this.messageQueue.filter(m => m.status === 'sent' || m.status === 'delivered' || m.status === 'read').length,
    messagesDelivered: this.messageQueue.filter(m => m.status === 'delivered' || m.status === 'read').length,
    messagesRead: this.messageQueue.filter(m => m.status === 'read').length,
    errors: this.messageQueue.filter(m => m.status === 'failed').length
  };
  
  this.stats = { ...this.stats, ...stats };
  return this.stats;
};

/**
 * Ottiene i prossimi messaggi da inviare (include sia messaggi principali che follow-up)
 */
whatsappCampaignSchema.methods.getNextMessages = function(limit = 10) {
  const now = new Date();
  
  return this.messageQueue
    .filter(m => {
      if (m.status !== 'pending') return false;
      
      // Messaggi principali (sequenceIndex = 0)
      if (m.sequenceIndex === 0) {
        return !m.scheduledAt || m.scheduledAt <= now;
      }
      
      // Follow-up (sequenceIndex > 0)
      if (m.sequenceIndex > 0) {
        // Deve essere il momento giusto per il follow-up
        if (!m.followUpScheduledFor || m.followUpScheduledFor > now) {
          return false;
        }
        
        // Se la condizione è 'no_response', controlla che non ci sia stata risposta
        const sequence = this.messageSequences.find(seq => seq.id === m.sequenceId);
        if (sequence && sequence.condition === 'no_response' && m.hasReceivedResponse) {
          return false;
        }
        
        return true;
      }
      
      return false;
    })
    .slice(0, limit);
};

/**
 * Marca un messaggio come inviato
 */
whatsappCampaignSchema.methods.markMessageSent = function(contactId, messageId) {
  const message = this.messageQueue.find(m => m.contactId.toString() === contactId.toString());
  if (message) {
    message.status = 'sent';
    message.sentAt = new Date();
    message.messageId = messageId;
  }
  return message;
};

/**
 * Marca un messaggio come fallito
 */
whatsappCampaignSchema.methods.markMessageFailed = function(contactId, errorMessage) {
  const message = this.messageQueue.find(m => m.contactId.toString() === contactId.toString());
  if (message) {
    message.status = 'failed';
    message.errorMessage = errorMessage;
    message.retryCount += 1;
  }
  return message;
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
  if (!this.messageSequences || this.messageSequences.length === 0) {
    return; // Nessuna sequenza configurata
  }

  const sentTime = new Date();
  
  for (let i = 0; i < this.messageSequences.length; i++) {
    const sequence = this.messageSequences[i];
    
    if (!sequence.isActive) continue;

    // Calcola quando inviare questo follow-up
    const followUpTime = new Date(sentTime.getTime() + sequence.delayMinutes * 60 * 1000);
    
    // Compila il messaggio della sequenza
    const compiledMessage = await this.compileMessageTemplate(sequence.messageTemplate, contactId);
    
    // Aggiungi alla coda
    this.messageQueue.push({
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
    });
  }
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