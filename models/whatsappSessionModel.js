import mongoose from 'mongoose';

/**
 * Schema per le Sessioni WhatsApp
 * Gestisce le connessioni OpenWA attive
 */
const whatsappSessionSchema = new mongoose.Schema({
  // ID univoco della sessione
  sessionId: {
    type: String,
    required: [true, 'Session ID obbligatorio'],
    unique: true,
    trim: true
  },
  
  // Numero WhatsApp collegato
  phoneNumber: {
    type: String,
    required: [true, 'Numero WhatsApp obbligatorio'],
    trim: true
  },
  
  // Nome/descrizione della sessione
  name: {
    type: String,
    required: [true, 'Nome sessione obbligatorio'],
    trim: true,
    maxLength: [100, 'Nome non può superare 100 caratteri']
  },
  
  // Stato della sessione
  status: {
    type: String,
    enum: ['disconnected', 'connecting', 'connected', 'authenticated', 'qr_ready', 'error'],
    default: 'disconnected'
  },
  
  // QR Code (base64) per la connessione
  qrCode: {
    type: String,
    default: null
  },
  
  // Data ultima generazione QR
  qrGeneratedAt: Date,
  
  // Informazioni sulla connessione
  connectionInfo: {
    browserVersion: String,
    waVersion: String,
    platform: String,
    connectedAt: Date,
    lastSeen: Date
  },
  
  // Statistiche sessione
  stats: {
    messagesSent: {
      type: Number,
      default: 0
    },
    messagesReceived: {
      type: Number,
      default: 0
    },
    activeCampaigns: {
      type: Number,
      default: 0
    },
    lastMessageAt: Date
  },
  
  // Configurazione OpenWA
  config: {
    useChrome: {
      type: Boolean,
      default: true
    },
    headless: {
      type: Boolean,
      default: true
    },
    autoRefresh: {
      type: Boolean,
      default: true
    },
    qrTimeout: {
      type: Number,
      default: 30
    },
    authTimeout: {
      type: Number,
      default: 30
    }
  },
  
  // Logs eventi
  eventLogs: [{
    event: {
      type: String,
      required: true
    },
    data: mongoose.Schema.Types.Mixed,
    timestamp: {
      type: Date,
      default: Date.now
    }
  }],
  
  // Utente proprietario
  owner: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'Owner obbligatorio']
  },
  
  // Ultima attività
  lastActivity: Date,
  
  // Metadati
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indici
whatsappSessionSchema.index({ sessionId: 1 });
whatsappSessionSchema.index({ owner: 1 });
whatsappSessionSchema.index({ status: 1 });
whatsappSessionSchema.index({ phoneNumber: 1 });

// Metodi dello schema

/**
 * Aggiorna stato della sessione
 */
whatsappSessionSchema.methods.updateStatus = function(newStatus, additionalData = {}) {
  this.status = newStatus;
  this.lastActivity = new Date();
  
  // Log dell'evento
  this.eventLogs.push({
    event: 'status_change',
    data: {
      oldStatus: this.status,
      newStatus,
      ...additionalData
    }
  });
  
  // Mantieni solo gli ultimi 100 logs
  if (this.eventLogs.length > 100) {
    this.eventLogs = this.eventLogs.slice(-100);
  }
  
  return this;
};

/**
 * Aggiorna QR Code
 */
whatsappSessionSchema.methods.updateQrCode = function(qrCode) {
  this.qrCode = qrCode;
  this.qrGeneratedAt = new Date();
  this.lastActivity = new Date();
  
  this.eventLogs.push({
    event: 'qr_updated',
    data: { generated_at: this.qrGeneratedAt }
  });
  
  return this;
};

/**
 * Marca come connessa
 */
whatsappSessionSchema.methods.markConnected = function(connectionInfo = {}) {
  this.status = 'connected';
  this.connectionInfo = {
    ...this.connectionInfo,
    ...connectionInfo,
    connectedAt: new Date()
  };
  this.lastActivity = new Date();
  this.qrCode = null; // Rimuovi QR code quando connesso
  
  this.eventLogs.push({
    event: 'connected',
    data: connectionInfo
  });
  
  return this;
};

/**
 * Aggiorna ultima attività
 */
whatsappSessionSchema.methods.updateActivity = function() {
  this.lastActivity = new Date();
  return this;
};

/**
 * Incrementa contatore messaggi inviati
 */
whatsappSessionSchema.methods.incrementMessagesSent = function() {
  this.stats.messagesSent += 1;
  this.stats.lastMessageAt = new Date();
  this.lastActivity = new Date();
  return this;
};

/**
 * Incrementa contatore messaggi ricevuti
 */
whatsappSessionSchema.methods.incrementMessagesReceived = function() {
  this.stats.messagesReceived += 1;
  this.stats.lastMessageAt = new Date();
  this.lastActivity = new Date();
  return this;
};

/**
 * Verifica se la sessione è attiva
 */
whatsappSessionSchema.methods.isActive = function() {
  return ['connected', 'authenticated'].includes(this.status);
};

/**
 * Verifica se la sessione è scaduta (inattiva da più di 5 minuti)
 */
whatsappSessionSchema.methods.isExpired = function() {
  if (!this.lastActivity) return true;
  const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
  return this.lastActivity < fiveMinutesAgo;
};

// Metodi statici

/**
 * Trova sessioni attive
 */
whatsappSessionSchema.statics.findActive = function() {
  return this.find({
    status: { $in: ['connected', 'authenticated'] }
  });
};

/**
 * Trova sessioni scadute
 */
whatsappSessionSchema.statics.findExpired = function() {
  const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
  return this.find({
    $or: [
      { lastActivity: { $lt: fiveMinutesAgo } },
      { lastActivity: { $exists: false } }
    ],
    status: { $in: ['connected', 'authenticated'] }
  });
};

/**
 * Trova per utente
 */
whatsappSessionSchema.statics.findByOwner = function(ownerId) {
  return this.find({ owner: ownerId })
    .populate('owner', 'firstName lastName email')
    .sort({ updatedAt: -1 });
};

// Middleware pre-save
whatsappSessionSchema.pre('save', function(next) {
  // Aggiorna ultima attività se modificato
  if (this.isModified() && !this.isModified('lastActivity')) {
    this.lastActivity = new Date();
  }
  
  next();
});

const WhatsappSession = mongoose.model('WhatsappSession', whatsappSessionSchema);
export default WhatsappSession; 