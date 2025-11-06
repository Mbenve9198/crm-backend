import express from 'express';
import { protect } from '../controllers/authController.js';
import {
  uploadVoiceFile,
  serveVoiceFile,
  deleteVoiceFile
} from '../controllers/voiceFileController.js';

const router = express.Router();

// POST /api/voice-files/upload - Upload vocale (AUTENTICATO)
router.post('/upload', protect, uploadVoiceFile);

// GET /api/voice-files/:id/audio - Serve file audio (PUBBLICO - NO AUTH)
// Questo endpoint DEVE essere pubblico perché WhatsApp scarica il file
router.get('/:id/audio', serveVoiceFile);

// DELETE /api/voice-files/:id - Elimina file (AUTENTICATO)
router.delete('/:id', protect, deleteVoiceFile);

export default router;
