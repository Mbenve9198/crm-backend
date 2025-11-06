import mongoose from 'mongoose';

/**
 * Modello VoiceFile - Collezione separata per file vocali
 * Evita duplicazione DataURL e documenti > 16MB
 */
const voiceFileSchema = new mongoose.Schema({
  // DataURL Base64 del file audio
  dataUrl: {
    type: String,
    required: true
  },
  
  // Nome file originale
  filename: {
    type: String,
    required: true
  },
  
  // Dimensione in bytes
  size: {
    type: Number,
    required: true
  },
  
  // Durata in secondi
  duration: {
    type: Number
  },
  
  // Mime type
  mimeType: {
    type: String,
    default: 'audio/ogg'
  },
  
  // Owner (per permessi)
  owner: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  
  // Metadata
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  }
}, {
  timestamps: true
});

// Indici per performance
voiceFileSchema.index({ owner: 1, createdAt: -1 });

const VoiceFile = mongoose.model('VoiceFile', voiceFileSchema);

export default VoiceFile;
