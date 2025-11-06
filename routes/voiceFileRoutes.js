import express from 'express';
import cors from 'cors';
import { protect } from '../controllers/authController.js';
import {
  uploadVoiceFile,
  serveVoiceFile,
  deleteVoiceFile
} from '../controllers/voiceFileController.js';

const router = express.Router();

// POST /api/voice-files/upload - Upload vocale (AUTENTICATO)
router.post('/upload', protect, uploadVoiceFile);

// GET /api/voice-files/:id/audio - Serve file audio (PUBBLICO - NO AUTH, NO CREDENTIALS)
// Questo endpoint DEVE essere completamente pubblico per WhatsApp/OpenWA
router.get('/:id/audio', 
  // CORS permissivo per questo endpoint specifico
  cors({
    origin: '*', // Permetti qualsiasi origin
    credentials: false, // NO credentials (pubblico)
    methods: ['GET', 'OPTIONS']
  }),
  serveVoiceFile
);

// DELETE /api/voice-files/:id - Elimina file (AUTENTICATO)
router.delete('/:id', protect, deleteVoiceFile);

export default router;
