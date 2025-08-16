import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import validator from 'validator';

/**
 * Schema del modello User per MenuChatCRM
 * Gestisce utenti, autenticazione, ruoli e ownership dei contatti
 */
const userSchema = new mongoose.Schema({
  // Informazioni personali
  firstName: {
    type: String,
    required: [true, 'Il nome è obbligatorio'],
    trim: true,
    maxLength: [50, 'Il nome non può superare 50 caratteri']
  },
  
  lastName: {
    type: String,
    required: [true, 'Il cognome è obbligatorio'],
    trim: true,
    maxLength: [50, 'Il cognome non può superare 50 caratteri']
  },
  
  email: {
    type: String,
    required: [true, 'L\'email è obbligatoria'],
    unique: true,
    lowercase: true,
    trim: true,
    validate: {
      validator: function(email) {
        return validator.isEmail(email);
      },
      message: 'Formato email non valido'
    }
  },
  
  // Password hashata
  password: {
    type: String,
    required: [true, 'La password è obbligatoria'],
    minLength: [6, 'La password deve essere di almeno 6 caratteri'],
    select: false // Non viene inclusa di default nelle query
  },
  
  // Ruolo dell'utente nel CRM
  role: {
    type: String,
    enum: {
      values: ['admin', 'manager', 'agent', 'viewer'],
      message: 'Ruolo non valido. Scegli tra: admin, manager, agent, viewer'
    },
    default: 'agent'
  },
  
  // Stato dell'account
  isActive: {
    type: Boolean,
    default: true
  },
  
  isEmailVerified: {
    type: Boolean,
    default: false
  },
  
  // Informazioni aggiuntive
  phone: {
    type: String,
    trim: true,
    validate: {
      validator: function(phone) {
        return !phone || /^[\+]?[1-9][\d]{0,15}$/.test(phone.replace(/[\s\-\(\)]/g, ''));
      },
      message: 'Formato telefono non valido'
    }
  },
  
  department: {
    type: String,
    trim: true,
    maxLength: [100, 'Il dipartimento non può superare 100 caratteri']
  },
  
  // Avatar/Immagine profilo (URL)
  avatar: {
    type: String,
    validate: {
      validator: function(url) {
        return !url || validator.isURL(url);
      },
      message: 'URL avatar non valido'
    }
  },
  
  // Impostazioni dell'utente
  settings: {
    language: {
      type: String,
      enum: ['it', 'en', 'es', 'fr'],
      default: 'it'
    },
    timezone: {
      type: String,
      default: 'Europe/Rome'
    },
    notifications: {
      email: { type: Boolean, default: true },
      push: { type: Boolean, default: true },
      newContacts: { type: Boolean, default: true },
      assignedContacts: { type: Boolean, default: true }
    },
    tablePreferences: {
      contacts: {
        visibleColumns: {
          type: [String],
          default: ['Contact', 'Email', 'Phone', 'Owner', 'Lists', 'Created', 'Actions']
        },
        pageSize: {
          type: Number,
          default: 10,
          min: [5, 'Il numero minimo di contatti per pagina è 5'],
          max: [100, 'Il numero massimo di contatti per pagina è 100']
        }
      }
    },
    twilio: {
      accountSid: {
        type: String,
        trim: true
      },
      authToken: {
        type: String,
        trim: true,
        select: false // Non inclusa nelle query per sicurezza
      },
      phoneNumber: {
        type: String,
        trim: true,
        validate: {
          validator: function(phone) {
            // Valida formato E.164 se presente
            return !phone || /^\+[1-9]\d{1,14}$/.test(phone);
          },
          message: 'Il numero deve essere in formato internazionale (+393331234567)'
        }
      },
      isVerified: {
        type: Boolean,
        default: false
      },
      lastVerified: {
        type: Date
      },
      isEnabled: {
        type: Boolean,
        default: false
      }
    },
    whatsappTemplate: {
      message: {
        type: String,
        trim: true,
        maxLength: [1000, 'Il template WhatsApp non può superare 1000 caratteri'],
        default: 'Ciao {nome}, sono {utente} di MenuChatCRM. Come posso aiutarti?'
      },
      variables: {
        type: [String],
        default: ['nome', 'utente']
      },
      updatedAt: {
        type: Date,
        default: Date.now
      }
    }
  },
  
  // Statistiche dell'utente
  stats: {
    totalContacts: { type: Number, default: 0 },
    contactsThisMonth: { type: Number, default: 0 },
    lastLogin: { type: Date },
    loginCount: { type: Number, default: 0 }
  },
  
  // Tracciamento creazione/aggiornamento
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  
  // Token per reset password
  passwordResetToken: String,
  passwordResetExpires: Date,
  
  // Token per verifica email
  emailVerificationToken: String
}, {
  timestamps: true,
  toJSON: { 
    virtuals: true,
    transform: function(doc, ret) {
      // Rimuove campi sensibili dalla risposta JSON
      delete ret.password;
      delete ret.passwordResetToken;
      delete ret.passwordResetExpires;
      delete ret.emailVerificationToken;
      return ret;
    }
  },
  toObject: { virtuals: true }
});

// Virtual per nome completo
userSchema.virtual('fullName').get(function() {
  return `${this.firstName} ${this.lastName}`;
});

// Indici per ottimizzare le query
userSchema.index({ email: 1 }, { unique: true });
userSchema.index({ role: 1 });
userSchema.index({ isActive: 1 });
userSchema.index({ department: 1 });

// Middleware pre-save per hash della password
userSchema.pre('save', async function(next) {
  // Hash password solo se è stata modificata
  if (!this.isModified('password')) return next();
  
  try {
    // Hash della password con salt 12
    const salt = await bcrypt.genSalt(12);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (error) {
    next(error);
  }
});

// Middleware pre-save per aggiornare statistiche
userSchema.pre('save', function(next) {
  // Normalizza email
  if (this.isModified('email')) {
    this.email = this.email.toLowerCase();
  }
  
  next();
});

// Metodi dell'istanza

/**
 * Confronta la password fornita con quella hashata
 * @param {string} candidatePassword - Password da verificare
 * @returns {Promise<boolean>} - True se la password è corretta
 */
userSchema.methods.comparePassword = async function(candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

/**
 * Verifica se l'utente ha un determinato ruolo o superiore
 * @param {string} requiredRole - Ruolo richiesto
 * @returns {boolean} - True se l'utente ha il ruolo o superiore
 */
userSchema.methods.hasRole = function(requiredRole) {
  const roleHierarchy = {
    viewer: 1,
    agent: 2,
    manager: 3,
    admin: 4
  };
  
  return roleHierarchy[this.role] >= roleHierarchy[requiredRole];
};

/**
 * Verifica se l'utente può accedere a un contatto
 * @param {Object} contact - Contatto da verificare
 * @returns {boolean} - True se può accedere
 */
userSchema.methods.canAccessContact = function(contact) {
  // Admin e manager possono accedere a tutti i contatti
  if (this.hasRole('manager')) return true;
  
  // Agent può accedere solo ai suoi contatti
  if (this.role === 'agent') {
    return contact.owner && contact.owner.toString() === this._id.toString();
  }
  
  // Viewer può solo visualizzare (gestito nel controller)
  return this.role === 'viewer';
};

/**
 * Verifica se l'utente può modificare un contatto
 * @param {Object} contact - Contatto da verificare
 * @returns {boolean} - True se può modificare
 */
userSchema.methods.canModifyContact = function(contact) {
  // Viewer non può modificare
  if (this.role === 'viewer') return false;
  
  // Admin e manager possono modificare tutto
  if (this.hasRole('manager')) return true;
  
  // Agent può modificare solo i suoi contatti
  return contact.owner && contact.owner.toString() === this._id.toString();
};

/**
 * Aggiorna le statistiche dell'utente
 */
userSchema.methods.updateStats = function(updates = {}) {
  if (updates.newContact) {
    this.stats.totalContacts += 1;
    this.stats.contactsThisMonth += 1;
  }
  
  if (updates.login) {
    this.stats.lastLogin = new Date();
    this.stats.loginCount += 1;
  }
  
  this.markModified('stats');
};

/**
 * Genera token per reset password
 * @returns {string} - Token generato
 */
userSchema.methods.createPasswordResetToken = function() {
  const resetToken = Math.random().toString(36).substring(2, 15) + 
                    Math.random().toString(36).substring(2, 15);
  
  this.passwordResetToken = resetToken;
  this.passwordResetExpires = Date.now() + 10 * 60 * 1000; // 10 minuti
  
  return resetToken;
};

/**
 * Genera token per verifica email
 * @returns {string} - Token generato
 */
userSchema.methods.createEmailVerificationToken = function() {
  const verificationToken = Math.random().toString(36).substring(2, 15) + 
                           Math.random().toString(36).substring(2, 15);
  
  this.emailVerificationToken = verificationToken;
  
  return verificationToken;
};

/**
 * Configura le impostazioni Twilio dell'utente
 * @param {Object} twilioConfig - Configurazione Twilio
 * @returns {Promise<User>} - Utente aggiornato
 */
userSchema.methods.configureTwilio = function(twilioConfig) {
  const { accountSid, authToken, phoneNumber } = twilioConfig;
  
  if (!this.settings) this.settings = {};
  if (!this.settings.twilio) this.settings.twilio = {};
  
  this.settings.twilio.accountSid = accountSid;
  this.settings.twilio.authToken = authToken;
  this.settings.twilio.phoneNumber = phoneNumber;
  this.settings.twilio.isVerified = false;
  this.settings.twilio.isEnabled = false;
  
  return this.save();
};

/**
 * Verifica la configurazione Twilio dell'utente
 * @returns {Promise<User>} - Utente aggiornato
 */
userSchema.methods.verifyTwilio = function() {
  if (!this.settings?.twilio) {
    throw new Error('Configurazione Twilio non presente');
  }
  
  this.settings.twilio.isVerified = true;
  this.settings.twilio.lastVerified = new Date();
  this.settings.twilio.isEnabled = true;
  
  return this.save();
};

/**
 * Disabilita Twilio per l'utente
 * @returns {Promise<User>} - Utente aggiornato
 */
userSchema.methods.disableTwilio = function() {
  if (this.settings?.twilio) {
    this.settings.twilio.isEnabled = false;
  }
  
  return this.save();
};

/**
 * Controlla se l'utente ha Twilio configurato e abilitato
 * @returns {boolean} - True se Twilio è configurato e abilitato
 */
userSchema.methods.hasTwilioEnabled = function() {
  return this.settings?.twilio?.isEnabled && 
         this.settings?.twilio?.isVerified &&
         this.settings?.twilio?.accountSid &&
         this.settings?.twilio?.authToken &&
         this.settings?.twilio?.phoneNumber;
};

/**
 * Ottieni configurazione Twilio sicura (senza authToken)
 * @returns {Object} - Configurazione Twilio senza dati sensibili
 */
userSchema.methods.getTwilioConfig = function() {
  if (!this.settings?.twilio) return null;
  
  return {
    accountSid: this.settings.twilio.accountSid,
    phoneNumber: this.settings.twilio.phoneNumber,
    isVerified: this.settings.twilio.isVerified,
    isEnabled: this.settings.twilio.isEnabled,
    lastVerified: this.settings.twilio.lastVerified
  };
};

// Metodi statici

/**
 * Trova utenti attivi per ruolo
 * @param {string} role - Ruolo da filtrare
 * @returns {Promise<User[]>} - Array di utenti
 */
userSchema.statics.findActiveByRole = function(role) {
  return this.find({ role, isActive: true });
};

/**
 * Trova utenti per dipartimento
 * @param {string} department - Dipartimento
 * @returns {Promise<User[]>} - Array di utenti
 */
userSchema.statics.findByDepartment = function(department) {
  return this.find({ department, isActive: true });
};

/**
 * Statistiche utenti
 * @returns {Promise<Object>} - Statistiche aggregate
 */
userSchema.statics.getStats = function() {
  return this.aggregate([
    {
      $group: {
        _id: '$role',
        count: { $sum: 1 },
        active: { $sum: { $cond: ['$isActive', 1, 0] } }
      }
    }
  ]);
};

// Esporta il modello
const User = mongoose.model('User', userSchema);

export default User; 