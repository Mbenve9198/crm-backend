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

// GET /api/voice-files/:id/audio - Registrato in server.js PRIMA del CORS
// (per bypassare middleware globali)

// DELETE /api/voice-files/:id - Elimina file (AUTENTICATO)
router.delete('/:id', protect, deleteVoiceFile);

export default router;
