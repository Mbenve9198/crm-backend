import mongoose from 'mongoose';

/**
 * Schema del modello Call per MenuChatCRM
 * Gestisce le chiamate Twilio con registrazioni e stati
 */
const callSchema = new mongoose.Schema({
  // ID della chiamata Twilio
  twilioCallSid: {
    type: String,
    required: [true, 'Twilio Call SID è obbligatorio'],
    unique: true,
    index: true
  },
  
  // Contatto associato alla chiamata
  contact: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Contact',
    required: [true, 'Il contatto è obbligatorio'],
    index: true
  },
  
  // Utente che ha iniziato la chiamata
  initiatedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'L\'utente che ha iniziato la chiamata è obbligatorio']
  },
  
  // Numero chiamante (Twilio verified number)
  fromNumber: {
    type: String,
    required: [true, 'Il numero chiamante è obbligatorio']
  },
  
  // Numero ricevente (contatto)
  toNumber: {
    type: String,
    required: [true, 'Il numero ricevente è obbligatorio']
  },
  
  // Stato della chiamata
  status: {
    type: String,
    enum: [
      'initiated',    // Iniziata (Twilio)
      'queued',       // In coda
      'ringing',      // Squilla
      'in-progress',  // In corso
      'completed',    // Completata
      'busy',         // Occupato
      'no-answer',    // Nessuna risposta
      'failed',       // Fallita
      'canceled'      // Annullata
    ],
    default: 'queued',
    index: true
  },
  
  // Direzione della chiamata
  direction: {
    type: String,
    enum: ['outbound-api', 'inbound'],
    default: 'outbound-api'
  },
  
  // Durata della chiamata in secondi
  duration: {
    type: Number,
    min: 0,
    default: 0
  },
  
  // Timestamp di inizio chiamata
  startTime: {
    type: Date
  },
  
  // Timestamp di fine chiamata
  endTime: {
    type: Date
  },
  
  // URL della registrazione (se disponibile)
  recordingUrl: {
    type: String
  },
  
  // SID della registrazione Twilio
  recordingSid: {
    type: String
  },
  
  // Durata della registrazione in secondi
  recordingDuration: {
    type: Number,
    min: 0
  },
  
  // Prezzo della chiamata
  price: {
    type: Number
  },
  
  // Unità di prezzo (es. USD, EUR)
  priceUnit: {
    type: String,
    default: 'USD'
  },
  
  // Note sulla chiamata
  notes: {
    type: String,
    maxLength: [1000, 'Le note non possono superare 1000 caratteri']
  },
  
  // Outcome della chiamata (per tracking vendite)
  outcome: {
    type: String,
    enum: [
      'interested',     // Interessato
      'not-interested', // Non interessato
      'callback',       // Richiamale
      'voicemail',     // Segreteria
      'wrong-number',   // Numero sbagliato
      'meeting-set',    // Appuntamento fissato
      'sale-made',      // Vendita conclusa
      'no-answer'       // Nessuna risposta
    ]
  },
  
  // Errori Twilio (se presenti)
  errorCode: {
    type: String
  },
  
  errorMessage: {
    type: String
  },
  
  // Metadati aggiuntivi da Twilio
  twilioData: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indici per ottimizzare le query
callSchema.index({ contact: 1, createdAt: -1 }); // Chiamate per contatto (più recenti prima)
callSchema.index({ initiatedBy: 1, createdAt: -1 }); // Chiamate per utente
callSchema.index({ status: 1 }); // Filtro per stato
callSchema.index({ outcome: 1 }); // Filtro per outcome
callSchema.index({ startTime: 1 }); // Ordinamento per data

// Virtual per calcolare la durata automaticamente
callSchema.virtual('calculatedDuration').get(function() {
  if (this.startTime && this.endTime) {
    return Math.floor((this.endTime - this.startTime) / 1000);
  }
  return this.duration || 0;
});

// Metodi dell'istanza

/**
 * Aggiorna lo stato della chiamata
 * @param {string} newStatus - Nuovo stato
 * @param {Object} additionalData - Dati aggiuntivi da Twilio
 */
callSchema.methods.updateStatus = function(newStatus, additionalData = {}) {
  this.status = newStatus;
  
  // Aggiorna timestamps basati sullo stato
  if (newStatus === 'in-progress' && !this.startTime) {
    this.startTime = new Date();
  }
  
  if (['completed', 'busy', 'no-answer', 'failed', 'canceled'].includes(newStatus) && !this.endTime) {
    this.endTime = new Date();
  }
  
  // Merge dei dati aggiuntivi
  this.twilioData = { ...this.twilioData, ...additionalData };
  
  return this.save();
};

/**
 * Aggiunge informazioni sulla registrazione
 * @param {string} recordingSid - SID della registrazione
 * @param {string} recordingUrl - URL della registrazione
 * @param {number} duration - Durata della registrazione
 */
callSchema.methods.addRecording = function(recordingSid, recordingUrl, duration) {
  this.recordingSid = recordingSid;
  this.recordingUrl = recordingUrl;
  this.recordingDuration = duration;
  
  return this.save();
};

// Metodi statici

/**
 * Trova chiamate per contatto
 * @param {string} contactId - ID del contatto
 * @param {Object} options - Opzioni di query
 * @returns {Promise<Call[]>} - Array di chiamate
 */
callSchema.statics.findByContact = function(contactId, options = {}) {
  const query = this.find({ contact: contactId })
    .populate('contact', 'name phone')
    .populate('initiatedBy', 'firstName lastName')
    .sort({ createdAt: -1 });
    
  if (options.limit) query.limit(options.limit);
  if (options.status) query.where({ status: options.status });
  
  return query;
};

/**
 * Trova chiamate per utente
 * @param {string} userId - ID dell'utente
 * @param {Object} options - Opzioni di query
 * @returns {Promise<Call[]>} - Array di chiamate
 */
callSchema.statics.findByUser = function(userId, options = {}) {
  const query = this.find({ initiatedBy: userId })
    .populate('contact', 'name phone')
    .sort({ createdAt: -1 });
    
  if (options.limit) query.limit(options.limit);
  if (options.status) query.where({ status: options.status });
  
  return query;
};

/**
 * Ottieni statistiche delle chiamate
 * @param {Object} filters - Filtri per le statistiche
 * @returns {Promise<Object>} - Statistiche
 */
callSchema.statics.getCallStats = async function(filters = {}) {
  const matchStage = {};
  
  if (filters.userId) matchStage.initiatedBy = new mongoose.Types.ObjectId(filters.userId);
  if (filters.contactId) matchStage.contact = new mongoose.Types.ObjectId(filters.contactId);
  if (filters.dateFrom) matchStage.createdAt = { $gte: new Date(filters.dateFrom) };
  if (filters.dateTo) {
    matchStage.createdAt = { 
      ...matchStage.createdAt,
      $lte: new Date(filters.dateTo)
    };
  }
  
  const stats = await this.aggregate([
    { $match: matchStage },
    {
      $group: {
        _id: null,
        totalCalls: { $sum: 1 },
        completedCalls: {
          $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] }
        },
        totalDuration: { $sum: '$duration' },
        avgDuration: { $avg: '$duration' },
        callsByStatus: {
          $push: '$status'
        },
        callsByOutcome: {
          $push: '$outcome'
        }
      }
    }
  ]);
  
  return stats[0] || {
    totalCalls: 0,
    completedCalls: 0,
    totalDuration: 0,
    avgDuration: 0,
    callsByStatus: [],
    callsByOutcome: []
  };
};

// Middleware pre-save
callSchema.pre('save', function(next) {
  // Calcola la durata se non impostata ma abbiamo start e end
  if (!this.duration && this.startTime && this.endTime) {
    this.duration = Math.floor((this.endTime - this.startTime) / 1000);
  }
  
  next();
});

const Call = mongoose.model('Call', callSchema);

export default Call; 