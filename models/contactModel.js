import mongoose from 'mongoose';
import validator from 'validator';

/**
 * Schema del modello Contact per MenuChatCRM
 * Gestisce i contatti con proprietà dinamiche e appartenenza a liste
 */
const contactSchema = new mongoose.Schema({
  // Nome del contatto (obbligatorio)
  name: {
    type: String,
    required: [true, 'Il nome è obbligatorio'],
    trim: true,
    maxLength: [100, 'Il nome non può superare 100 caratteri']
  },
  
  // Email del contatto (opzionale)
  email: {
    type: String,
    unique: true,
    sparse: true, // Permette multiple entry con email vuota/null
    lowercase: true,
    trim: true,
    validate: {
      validator: function(email) {
        // Se email è vuota/null, passa la validazione
        return !email || validator.isEmail(email);
      },
      message: 'Formato email non valido'
    }
  },
  
  // Numero di telefono (opzionale)
  phone: {
    type: String,
    trim: true,
    validate: {
      validator: function(phone) {
        // Accetta formati internazionali di base
        return !phone || /^[\+]?[1-9][\d]{0,15}$/.test(phone.replace(/[\s\-\(\)]/g, ''));
      },
      message: 'Formato telefono non valido'
    }
  },
  
  // Array delle liste a cui appartiene il contatto
  lists: [{
    type: String,
    trim: true,
    maxLength: [50, 'Il nome della lista non può superare 50 caratteri']
  }],
  
  // Status del contatto nel pipeline
  status: {
    type: String,
    enum: ['da contattare', 'contattato', 'da richiamare', 'interessato', 'non interessato', 'qr code inviato', 'free trial iniziato', 'won', 'lost'],
    default: 'da contattare',
    index: true
  },

  // MRR (Monthly Recurring Revenue) - obbligatorio per stati pipeline
  mrr: {
    type: Number,
    min: [0, 'MRR non può essere negativo'],
    required: function() {
      return ['interessato', 'qr code inviato', 'free trial iniziato', 'won', 'lost'].includes(this.status);
    }
  },
  
  // Tipo di sorgente del contatto
  source: {
    type: String,
    enum: ['manual', 'csv_import', 'inbound_rank_checker', 'inbound_form', 'inbound_api'],
    default: 'manual',
    index: true
  },

  // Dati specifici per lead Rank Checker (solo se source = inbound_rank_checker)
  rankCheckerData: {
    placeId: String,
    keyword: String,
    ranking: mongoose.Schema.Types.Mixed, // Contiene mainRank, competitorsAhead, strategicResults, etc
    hasDigitalMenu: Boolean,
    willingToAdoptMenu: Boolean,
    dailyCovers: Number,
    estimatedMonthlyReviews: Number,
    qualifiedAt: Date,
    leadCapturedAt: Date
  },
  
  // Proprietà dinamiche (oggetto chiave/valore per dati personalizzati)
  properties: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  
  // Ownership del contatto
  owner: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'Il contatto deve avere un proprietario']
  },
  
  // Utente che ha creato il contatto
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'Il creatore del contatto è obbligatorio']
  },
  
  // Ultimo utente che ha modificato il contatto
  lastModifiedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }
}, {
  // Aggiunge automaticamente createdAt e updatedAt
  timestamps: true,
  
  // Configurazioni aggiuntive dello schema
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indici per ottimizzare le query
contactSchema.index({ email: 1 }, { unique: true, sparse: true }); // Indice unico per email (sparse permette più null)
contactSchema.index({ lists: 1 }); // Indice per ricerche per lista
contactSchema.index({ name: 1 }); // Indice per ricerche per nome
contactSchema.index({ owner: 1 }); // Indice per ownership
contactSchema.index({ owner: 1, lists: 1 }); // Indice composto per owner e lista
contactSchema.index({ 'properties.company': 1 }); // Esempio di indice su proprietà dinamica

// Metodi dello schema

/**
 * Aggiunge il contatto a una lista se non già presente
 * @param {string} listName - Nome della lista
 * @returns {boolean} - True se aggiunto, false se già presente
 */
contactSchema.methods.addToList = function(listName) {
  if (!this.lists.includes(listName)) {
    this.lists.push(listName);
    return true;
  }
  return false;
};

/**
 * Rimuove il contatto da una lista
 * @param {string} listName - Nome della lista
 * @returns {boolean} - True se rimosso, false se non era presente
 */
contactSchema.methods.removeFromList = function(listName) {
  const index = this.lists.indexOf(listName);
  if (index > -1) {
    this.lists.splice(index, 1);
    return true;
  }
  return false;
};

/**
 * Aggiorna una proprietà dinamica
 * @param {string} key - Chiave della proprietà
 * @param {any} value - Valore da assegnare
 */
contactSchema.methods.setProperty = function(key, value) {
  if (!this.properties) {
    this.properties = {};
  }
  this.properties[key] = value;
  this.markModified('properties');
};

/**
 * Ottiene una proprietà dinamica
 * @param {string} key - Chiave della proprietà
 * @returns {any} - Valore della proprietà o undefined
 */
contactSchema.methods.getProperty = function(key) {
  return this.properties ? this.properties[key] : undefined;
};

// Middleware pre-save per validazioni aggiuntive
contactSchema.pre('save', function(next) {
  // Rimuove duplicati dalle liste
  if (this.lists && this.lists.length > 0) {
    this.lists = [...new Set(this.lists)];
  }
  
  // Valida le proprietà dinamiche (esempio: evita chiavi vuote)
  if (this.properties) {
    for (const key in this.properties) {
      if (key.trim() === '') {
        delete this.properties[key];
      }
    }
  }
  
  next();
});

// Metodi statici per query comuni

/**
 * Trova contatti per lista
 * @param {string} listName - Nome della lista
 * @returns {Promise<Contact[]>} - Array di contatti
 */
contactSchema.statics.findByList = function(listName) {
  return this.find({ lists: listName });
};

/**
 * Trova contatti per proprietà dinamica
 * @param {string} key - Chiave della proprietà
 * @param {any} value - Valore della proprietà
 * @returns {Promise<Contact[]>} - Array di contatti
 */
contactSchema.statics.findByProperty = function(key, value) {
  const query = {};
  query[`properties.${key}`] = value;
  return this.find(query);
};

/**
 * Trova contatti per owner
 * @param {string} ownerId - ID del proprietario
 * @param {Object} filters - Filtri aggiuntivi
 * @returns {Promise<Contact[]>} - Array di contatti
 */
contactSchema.statics.findByOwner = function(ownerId, filters = {}) {
  return this.find({ owner: ownerId, ...filters })
    .populate('owner', 'firstName lastName email')
    .populate('createdBy', 'firstName lastName');
};

/**
 * Trasferisce la ownership di contatti da un utente a un altro
 * @param {string} fromUserId - ID utente cedente
 * @param {string} toUserId - ID utente ricevente
 * @param {string} transferredBy - ID utente che effettua il trasferimento
 * @returns {Promise<Object>} - Risultato del trasferimento
 */
contactSchema.statics.transferOwnership = async function(fromUserId, toUserId, transferredBy) {
  const result = await this.updateMany(
    { owner: fromUserId },
    { 
      owner: toUserId,
      lastModifiedBy: transferredBy,
      updatedAt: new Date()
    }
  );
  
  return {
    transferredCount: result.modifiedCount,
    fromUser: fromUserId,
    toUser: toUserId,
    transferredBy: transferredBy,
    transferredAt: new Date()
  };
};

/**
 * Conta contatti per owner
 * @param {string} ownerId - ID del proprietario
 * @returns {Promise<number>} - Numero di contatti
 */
contactSchema.statics.countByOwner = function(ownerId) {
  return this.countDocuments({ owner: ownerId });
};

// Esporta il modello
const Contact = mongoose.model('Contact', contactSchema);

export default Contact; 