import ImageKit from 'imagekit';
import multer from 'multer';
import fs from 'fs';
import path from 'path';

// Configurazione ImageKit
const imagekit = new ImageKit({
  publicKey: process.env.IMAGEKIT_PUBLIC_KEY || 'your_public_key',
  privateKey: process.env.IMAGEKIT_PRIVATE_KEY || 'your_private_key',
  urlEndpoint: process.env.IMAGEKIT_URL_ENDPOINT || 'https://ik.imagekit.io/your_imagekit_id/'
});

// Storage locale temporaneo per processare i file
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const tempDir = 'uploads/temp';
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
    cb(null, tempDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

// Helper per determinare la cartella di destinazione
const getFolderPath = (req, file) => {
  if (file.mimetype === 'application/pdf') {
    return 'menu-pdf';
  } else if (file.mimetype.startsWith('video/')) {
    return 'campaign-media/videos';
  } else if (file.mimetype.startsWith('image/')) {
    return 'campaign-media/images';
  } else if (file.mimetype.startsWith('audio/')) {
    return 'whatsapp-campaign-audio'; // 🎤 NUOVO: Cartella per vocali WhatsApp
  }
  return 'misc';
};

// Helper per generare nome file unico
const generateFileName = (req, file) => {
  const campaignType = req.body.campaignType || 'campaign';
  const sanitizedType = campaignType.toLowerCase().replace(/[^a-z0-9]/g, '-');
  
  let prefix = '';
  let extension = '';
  
  if (file.mimetype.startsWith('image/')) {
    prefix = 'img';
    // Mappa il MIME type all'estensione appropriata
    const mimeToExt = {
      'image/jpeg': '.jpg',
      'image/jpg': '.jpg',
      'image/png': '.png',
      'image/webp': '.webp',
      'image/gif': '.gif'
    };
    extension = mimeToExt[file.mimetype.toLowerCase()] || '.jpg';
  } else if (file.mimetype.startsWith('video/')) {
    prefix = 'video';
    extension = '.mp4';
  } else if (file.mimetype === 'application/pdf') {
    prefix = 'pdf';
    extension = '.pdf';
  } else if (file.mimetype.startsWith('audio/')) {
    // 🎤 NUOVO: Supporto file audio
    prefix = 'voice';
    const mimeToExt = {
      'audio/mpeg': '.mp3',
      'audio/mp3': '.mp3',
      'audio/ogg': '.ogg',
      'audio/opus': '.ogg',
      'audio/webm': '.webm',
      'audio/wav': '.wav',
      'audio/mp4': '.m4a',
      'audio/aac': '.aac'
    };
    extension = mimeToExt[file.mimetype.toLowerCase()] || '.mp3';
  }
  
  const timestamp = Date.now();
  // 🔧 IMPORTANTE: Includi l'estensione nel nome del file per compatibilità Twilio/WhatsApp
  return `${prefix}-${sanitizedType}-${timestamp}${extension}`;
};

// Upload PDF menu
const uploadPdf = multer({
  storage: storage,
  limits: {
    fileSize: 15 * 1024 * 1024 // 15MB per PDF
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('Solo file PDF sono accettati'), false);
    }
  }
});

// Upload media campagne (immagini, video, PDF)
const uploadMedia = multer({
  storage: storage,
  limits: {
    fileSize: 50 * 1024 * 1024 // 50MB per supportare video di alta qualità
  },
  fileFilter: (req, file, cb) => {
    if (
      file.mimetype.startsWith('image/') || 
      file.mimetype.startsWith('video/') || 
      file.mimetype === 'application/pdf'
    ) {
      cb(null, true);
    } else {
      cb(new Error('Solo immagini, video e PDF sono accettati'), false);
    }
  }
});

// 🎤 NUOVO: Upload audio per vocali WhatsApp
const uploadAudio = multer({
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB per vocali
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('audio/')) {
      cb(null, true);
    } else {
      cb(new Error('Solo file audio sono accettati'), false);
    }
  }
});

// Helper per upload su ImageKit
const uploadToImageKit = async (filePath, fileName, folder, options = {}) => {
  try {
    const fileBuffer = fs.readFileSync(filePath);
    
    const uploadParams = {
      file: fileBuffer,
      fileName: fileName,
      folder: folder,
      ...options
    };

    console.log(`📤 Upload su ImageKit: ${fileName} nella cartella ${folder}`);
    
    const result = await imagekit.upload(uploadParams);
    
    // Pulisci il file temporaneo
    fs.unlinkSync(filePath);
    
    console.log(`✅ Upload completato: ${result.url}`);
    return result;
    
  } catch (error) {
    // Pulisci il file anche in caso di errore
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
    throw error;
  }
};

// Helper per eliminare file da ImageKit
const deleteFromImageKit = async (fileId) => {
  try {
    const result = await imagekit.deleteFile(fileId);
    console.log(`🗑️ File eliminato da ImageKit: ${fileId}`);
    return result;
  } catch (error) {
    console.error(`❌ Errore eliminazione file da ImageKit: ${error.message}`);
    throw error;
  }
};

// Helper per ottimizzazione automatica video per WhatsApp
const getVideoTransformations = (optimizeForWhatsApp = false) => {
  if (optimizeForWhatsApp) {
    return [
      { quality: 80 },
      { format: 'mp4' },
      { videoCodec: 'h264' },
      { audioCodec: 'aac' }
    ];
  }
  return [];
};

/**
 * Genera un URL ImageKit compatibile con Twilio/WhatsApp
 * NOTA: Con il nuovo sistema, l'estensione è già inclusa nel fileName durante l'upload,
 * quindi questa funzione ora verifica solo che l'URL sia corretto
 * @param {string} originalUrl - URL originale di ImageKit
 * @param {string} mimeType - MIME type del file
 * @returns {string} - URL compatibile con Twilio/WhatsApp
 */
const generateTwilioCompatibleImageKitUrl = (originalUrl, mimeType) => {
  if (!originalUrl) {
    return originalUrl;
  }
  
  // Verifica se è un URL ImageKit
  const isImageKitUrl = originalUrl.includes('ik.imagekit.io') || originalUrl.includes('imagekit.io');
  
  if (isImageKitUrl) {
    // Per gli URL di ImageKit, NON aggiungere estensioni extra
    // L'estensione è già nel nome del file caricato
    console.log(`✅ URL ImageKit già compatibile con Twilio (estensione nel filename): ${originalUrl}`);
    return originalUrl;
  }
  
  // Per URL non-ImageKit (legacy), aggiungi l'estensione se necessario
  const mimeToExtension = {
    'image/jpeg': '.jpg',
    'image/jpg': '.jpg',
    'image/png': '.png',
    'image/webp': '.webp',
    'video/mp4': '.mp4',
    'application/pdf': '.pdf'
  };
  
  const extension = mimeToExtension[mimeType?.toLowerCase()];
  
  if (extension && !originalUrl.toLowerCase().endsWith(extension)) {
    const compatibleUrl = `${originalUrl}${extension}`;
    console.log(`🔧 URL aggiornato per compatibilità Twilio: ${originalUrl} -> ${compatibleUrl}`);
    return compatibleUrl;
  }
  
  return originalUrl;
};

// 🎤 NUOVO: Helper per upload vocali da buffer (Base64 o Blob)
const uploadAudioToImageKit = async (buffer, fileName, options = {}) => {
  try {
    // Assicura che fileName abbia estensione
    if (!path.extname(fileName)) {
      fileName = fileName + '.mp3';
    }

    const uploadParams = {
      file: buffer,
      fileName: fileName,
      folder: 'whatsapp-campaign-audio',
      ...options
    };

    console.log(`🎤 Upload vocale su ImageKit: ${fileName}`);
    
    const result = await imagekit.upload(uploadParams);
    
    console.log(`✅ Vocale caricato su ImageKit: ${result.url}`);
    return result;
    
  } catch (error) {
    console.error('❌ Errore upload vocale su ImageKit:', error);
    throw error;
  }
};

export {
  imagekit,
  uploadPdf,
  uploadMedia,
  uploadAudio, // 🎤 NUOVO
  uploadToImageKit,
  uploadAudioToImageKit, // 🎤 NUOVO
  deleteFromImageKit,
  getFolderPath,
  generateFileName,
  getVideoTransformations,
  generateTwilioCompatibleImageKitUrl
}; 