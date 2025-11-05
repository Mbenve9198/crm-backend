import express from 'express';
import { protect } from '../controllers/authController.js';
import {
  getCampaigns,
  getCampaign,
  createCampaign,
  updateCampaign,
  startCampaign,
  pauseCampaign,
  resumeCampaign,
  cancelCampaign,
  deleteCampaign,
  uploadAttachments,
  previewCampaign,
  updateMessageStatus,
  uploadSequenceAudio,
  deleteSequenceAudio,
  uploadAudioDirect // 🎤 NUOVO
} from '../controllers/whatsappCampaignController.js';

const router = express.Router();

// Middleware di autenticazione per tutte le routes
router.use(protect);

/**
 * ROUTES CAMPAGNE WHATSAPP
 */

// GET /api/whatsapp-campaigns - Ottieni tutte le campagne
router.get('/', getCampaigns);

// POST /api/whatsapp-campaigns/preview - Anteprima campagna
router.post('/preview', previewCampaign);

// GET /api/whatsapp-campaigns/:id - Ottieni campagna specifica
router.get('/:id', getCampaign);

// POST /api/whatsapp-campaigns - Crea nuova campagna
router.post('/', createCampaign);

// PUT /api/whatsapp-campaigns/:id - Aggiorna campagna
router.put('/:id', updateCampaign);

// PUT /api/whatsapp-campaigns/:campaignId/messages/:messageId/status - Aggiorna status messaggio
router.put('/:campaignId/messages/:messageId/status', updateMessageStatus);

// POST /api/whatsapp-campaigns/:id/attachments - Upload allegati
router.post('/:id/attachments', uploadAttachments);

// 🎤 POST /api/whatsapp-campaigns/upload-audio - Upload audio diretto su ImageKit (no campaignId richiesto)
router.post('/upload-audio', uploadAudioDirect);

// 🎤 POST /api/whatsapp-campaigns/:id/sequences/:sequenceId/audio - Upload audio per sequenza
router.post('/:id/sequences/:sequenceId/audio', uploadSequenceAudio);

// 🗑️ DELETE /api/whatsapp-campaigns/:id/sequences/:sequenceId/audio - Rimuovi audio da sequenza
router.delete('/:id/sequences/:sequenceId/audio', deleteSequenceAudio);

// POST /api/whatsapp-campaigns/:id/start - Avvia campagna
router.post('/:id/start', startCampaign);

// POST /api/whatsapp-campaigns/:id/pause - Pausa campagna
router.post('/:id/pause', pauseCampaign);

// POST /api/whatsapp-campaigns/:id/resume - Riprendi campagna
router.post('/:id/resume', resumeCampaign);

// POST /api/whatsapp-campaigns/:id/cancel - Cancella campagna
router.post('/:id/cancel', cancelCampaign);

// DELETE /api/whatsapp-campaigns/:id - Elimina campagna
router.delete('/:id', deleteCampaign);

export default router;

/**
 * DOCUMENTAZIONE ROUTES CAMPAGNE WHATSAPP
 * 
 * === ROUTES AUTENTICATE ===
 * Tutte le routes richiedono autenticazione Bearer token
 * 
 * GET /api/whatsapp-campaigns
 * Ottieni tutte le campagne dell'utente
 * Query params: {
 *   status?: 'draft' | 'scheduled' | 'running' | 'paused' | 'completed' | 'cancelled',
 *   page?: number (default: 1),
 *   limit?: number (default: 10)
 * }
 * Response: { success: true, data: { campaigns, pagination } }
 * 
 * GET /api/whatsapp-campaigns/:id
 * Ottieni una campagna specifica
 * Response: { success: true, data: WhatsappCampaign }
 * 
 * POST /api/whatsapp-campaigns
 * Crea una nuova campagna
 * Body: {
 *   name: string (required),
 *   description?: string,
 *   whatsappSessionId: string (required),
 *   targetList: string (required), // nome lista o 'all'
 *   contactFilters?: {
 *     status?: string[],
 *     properties?: Record<string, any>
 *   },
 *   messageTemplate: string (required),
 *   timing: {
 *     intervalBetweenMessages: number (5-3600 secondi),
 *     messagesPerHour?: number (default: 60),
 *     schedule?: {
 *       startTime?: string, // HH:MM
 *       endTime?: string,   // HH:MM
 *       timezone?: string,
 *       daysOfWeek?: string[]
 *     }
 *   },
 *   scheduledStartAt?: string (ISO date)
 * }
 * Response: { success: true, data: WhatsappCampaign }
 * 
 * PUT /api/whatsapp-campaigns/:id
 * Aggiorna una campagna (solo se draft o scheduled)
 * Body: Stessi parametri del POST (parziali)
 * Response: { success: true, data: WhatsappCampaign }
 * 
 * POST /api/whatsapp-campaigns/preview
 * Anteprima di una campagna
 * Body: {
 *   targetList: string,
 *   contactFilters?: object,
 *   messageTemplate: string,
 *   limit?: number (default: 5)
 * }
 * Response: { 
 *   success: true, 
 *   data: { 
 *     totalContacts: number,
 *     templateVariables: string[],
 *     preview: Array<{ contact, compiledMessage }> 
 *   } 
 * }
 * 
 * POST /api/whatsapp-campaigns/:id/attachments
 * Upload allegati per campagna
 * Content-Type: multipart/form-data
 * Files: files[] (max 5 files, 10MB each)
 * Body: { caption?: string }
 * Response: { success: true, data: { attachments, totalAttachments } }
 * 
 * POST /api/whatsapp-campaigns/:id/start
 * Avvia una campagna
 * Response: { success: true, data: WhatsappCampaign }
 * 
 * POST /api/whatsapp-campaigns/:id/pause
 * Pausa una campagna in esecuzione
 * Response: { success: true, data: WhatsappCampaign }
 * 
 * POST /api/whatsapp-campaigns/:id/resume
 * Riprendi una campagna pausata
 * Response: { success: true, data: WhatsappCampaign }
 * 
 * POST /api/whatsapp-campaigns/:id/cancel
 * Cancella una campagna
 * Response: { success: true, data: WhatsappCampaign }
 * 
 * DELETE /api/whatsapp-campaigns/:id
 * Elimina una campagna (solo se non in esecuzione)
 * Response: { success: true, message: string }
 * 
 * === ESEMPI D'USO ===
 * 
 * // Crea campagna
 * curl -X POST http://localhost:3000/api/whatsapp-campaigns \
 *   -H "Authorization: Bearer YOUR_TOKEN" \
 *   -H "Content-Type: application/json" \
 *   -d '{
 *     "name": "Campagna Prova",
 *     "whatsappSessionId": "mia-sessione",
 *     "targetList": "prospect",
 *     "messageTemplate": "Ciao {nome}, sono {utente} di MenuChatCRM!",
 *     "timing": {
 *       "intervalBetweenMessages": 30
 *     }
 *   }'
 * 
 * // Avvia campagna
 * curl -X POST http://localhost:3000/api/whatsapp-campaigns/CAMPAIGN_ID/start \
 *   -H "Authorization: Bearer YOUR_TOKEN"
 * 
 * === TEMPLATE VARIABILI ===
 * 
 * Variabili disponibili nei template:
 * - {nome} - Nome del contatto
 * - {email} - Email del contatto
 * - {telefono} - Telefono del contatto
 * - {proprietà_personalizzata} - Qualsiasi proprietà del contatto
 * 
 * === STATI CAMPAGNE ===
 * 
 * - draft: Bozza, modificabile
 * - scheduled: Programmata per il futuro
 * - running: In esecuzione
 * - paused: Pausata
 * - completed: Completata
 * - cancelled: Cancellata
 * 
 * === CODICI DI ERRORE ===
 * 
 * 400: Dati mancanti o non validi
 * 401: Non autenticato
 * 403: Non autorizzato
 * 404: Campagna non trovata
 * 500: Errore interno del server
 */ 