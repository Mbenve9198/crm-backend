import mongoose from 'mongoose';

/**
 * Schema per le Activities dei contatti
 * Traccia tutte le interazioni con i contatti
 */
const activitySchema = new mongoose.Schema({
  // Riferimento al contatto
  contact: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Contact',
    required: [true, 'Il contatto è obbligatorio']
  },
  
  // Tipo di activity
  type: {
    type: String,
    enum: ['email', 'call', 'whatsapp', 'instagram_dm', 'status_change'],
    required: [true, 'Il tipo di activity è obbligatorio']
  },
  
  // Titolo/soggetto dell'activity (generato automaticamente)
  title: {
    type: String,
    maxLength: [200, 'Il titolo non può superare 200 caratteri']
  },
  
  // Descrizione/contenuto dell'activity
  description: {
    type: String,
    maxLength: [2000, 'La descrizione non può superare 2000 caratteri']
  },
  
  // Dati specifici per tipo di activity
  data: {
    // Per le chiamate
    callOutcome: {
      type: String,
      enum: ['interested', 'not-interested', 'callback', 'voicemail', 'wrong-number', 'meeting-set', 'sale-made', 'no-answer', 'busy'],
    },
    callDuration: {
      type: Number, // in secondi
    },
    recordingUrl: {
      type: String,
    },
    recordingSid: {
      type: String,
    },
    recordingDuration: {
      type: Number, // in secondi
    },
    
    // Per WhatsApp e Instagram DM
    messageText: {
      type: String,
      maxLength: [1000, 'Il messaggio non può superare 1000 caratteri']
    },
    
    // Per le email
    emailSubject: {
      type: String,
      maxLength: [200, 'L\'oggetto email non può superare 200 caratteri']
    },
    
    // Per i cambi di stato
    statusChange: {
      oldStatus: String,
      newStatus: String,
      mrr: Number
    },
    
    // Campi comuni
    attachments: [{
      filename: String,
      url: String,
      size: Number
    }]
  },
  
  // Utente che ha creato l'activity
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'Il creatore dell\'activity è obbligatorio']
  },
  
  // Stato dell'activity
  status: {
    type: String,
    enum: ['completed', 'pending', 'failed'],
    default: 'completed'
  },
  
  // Priority level
  priority: {
    type: String,
    enum: ['low', 'medium', 'high'],
    default: 'medium'
  }
}, {
  timestamps: true, // Aggiunge createdAt e updatedAt automaticamente
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indici per performance
activitySchema.index({ contact: 1, createdAt: -1 }); // Per recuperare activities per contatto ordinate per data
activitySchema.index({ createdBy: 1, createdAt: -1 }); // Per recuperare activities per utente
activitySchema.index({ type: 1 }); // Per filtrare per tipo
activitySchema.index({ status: 1 }); // Per filtrare per stato

// Virtual per il display del tipo
activitySchema.virtual('typeDisplay').get(function() {
  const typeMap = {
    'email': 'Email',
    'call': 'Chiamata',
    'whatsapp': 'WhatsApp',
    'instagram_dm': 'DM Instagram',
    'status_change': 'Cambio Stato'
  };
  return typeMap[this.type] || this.type;
});

// Virtual per l'icona del tipo
activitySchema.virtual('typeIcon').get(function() {
  const iconMap = {
    'email': 'mail',
    'call': 'phone',
    'whatsapp': 'message-circle',
    'instagram_dm': 'instagram',
    'status_change': 'arrow-right'
  };
  return iconMap[this.type] || 'activity';
});

// Metodo per generare il titolo automaticamente
activitySchema.methods.generateTitle = function() {
  const typeMap = {
    'email': 'Email inviata',
    'call': 'Chiamata effettuata',
    'whatsapp': 'Messaggio WhatsApp',
    'instagram_dm': 'DM Instagram',
    'status_change': 'Cambio stato'
  };
  
  switch (this.type) {
    case 'call':
      if (this.data?.callOutcome) {
        const outcomeMap = {
          'success': 'Chiamata riuscita',
          'no_answer': 'Chiamata senza risposta',
          'busy': 'Numero occupato',
          'voicemail': 'Segreteria telefonica',
          'callback_requested': 'Richiesta richiamata'
        };
        return outcomeMap[this.data.callOutcome] || 'Chiamata effettuata';
      }
      return 'Chiamata effettuata';
    case 'email':
      return this.data?.emailSubject || 'Email inviata';
    case 'whatsapp':
    case 'instagram_dm':
      const preview = this.data?.messageText ? 
        (this.data.messageText.length > 30 ? 
          this.data.messageText.substring(0, 30) + '...' : 
          this.data.messageText) : '';
      return preview ? `${typeMap[this.type]}: ${preview}` : typeMap[this.type];
    case 'status_change':
      if (this.data?.statusChange) {
        const { oldStatus, newStatus } = this.data.statusChange;
        return `Stato cambiato: ${oldStatus} → ${newStatus}`;
      }
      return 'Cambio stato';
    default:
      return typeMap[this.type] || 'Activity';
  }
};

// Metodo per ottenere il contenuto principale dell'activity
activitySchema.methods.getMainContent = function() {
  switch (this.type) {
    case 'call':
      return this.data?.callOutcome ? 
        `Esito: ${this.data.callOutcome}${this.data.callDuration ? ` (${Math.floor(this.data.callDuration / 60)}:${(this.data.callDuration % 60).toString().padStart(2, '0')})` : ''}` : 
        'Chiamata effettuata';
    case 'whatsapp':
    case 'instagram_dm':
      return this.data?.messageText || 'Messaggio inviato';
    case 'email':
      return this.data?.emailSubject || this.title;
    default:
      return this.description || this.title;
  }
};

// Metodo statico per ottenere le activities di un contatto
activitySchema.statics.getContactActivities = function(contactId, options = {}) {
  const { page = 1, limit = 20, type } = options;
  
  let query = this.find({ contact: contactId })
    .populate('createdBy', 'firstName lastName email role')
    .sort({ createdAt: -1 })
    .skip((page - 1) * limit)
    .limit(limit);
    
  if (type) {
    query = query.where({ type });
  }
  
  return query;
};

// Middleware pre-save per validazioni e generazione titolo
activitySchema.pre('save', function(next) {
  // Genera il titolo automaticamente se non presente
  if (!this.title) {
    this.title = this.generateTitle();
  }
  
  // Validazione specifica per le chiamate completate
  // L'esito è obbligatorio solo per le chiamate completate, non per quelle iniziate
  if (this.type === 'call' && this.status === 'completed' && !this.data?.callOutcome) {
    return next(new Error('L\'esito della chiamata è obbligatorio per le chiamate completate'));
  }
  
  // Validazione per messaggi
  // 🎤 AGGIORNATO: Permetti messaggi senza testo se c'è un vocale/media
  if ((this.type === 'whatsapp' || this.type === 'instagram_dm')) {
    const hasText = this.data?.messageText && this.data.messageText.trim();
    const hasMedia = this.data?.hasAttachment || this.data?.attachmentType;
    
    if (!hasText && !hasMedia) {
      // Solo se non c'è né testo né media
      return next(new Error('Il messaggio deve avere testo o allegato'));
    }
  }
  
  next();
});

const Activity = mongoose.model('Activity', activitySchema);

export default Activity; 