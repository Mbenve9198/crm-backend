import express from 'express';
import {
  initiateCall,
  statusCallback,
  recordingStatusCallback,
  getCallsByContact,
  getMyCalls,
  updateCall,
  getCallStats,
  getRecording,
  testWebhook,
  cancelCall,
  cleanupStuckCalls
} from '../controllers/callController.js';
import { protect, restrictTo } from '../controllers/authController.js';

const router = express.Router();

/**
 * ROUTES PER LE CHIAMATE TWILIO
 */

// === ROUTES PROTETTE (RICHIEDONO AUTENTICAZIONE) ===

// Inizia una chiamata verso un contatto
router.post('/initiate', protect, initiateCall);

// Ottieni le mie chiamate
router.get('/my-calls', protect, getMyCalls);

// Ottieni chiamate per un contatto specifico
router.get('/contact/:contactId', protect, getCallsByContact);

// Aggiorna note e outcome di una chiamata
router.put('/:callId', protect, updateCall);

// Ottieni URL della registrazione
router.get('/:callId/recording', protect, getRecording);

// Proxy per registrazione audio ora è nel server.js come route pubblica

// Cancella una chiamata attiva
router.post('/:callId/cancel', protect, cancelCall);

// Ottieni statistiche delle chiamate
router.get('/stats', protect, getCallStats);

// Pulisce chiamate bloccate
router.post('/cleanup-stuck', protect, cleanupStuckCalls);

// === WEBHOOK ROUTES PUBBLICHE (DA TWILIO) ===

// Test per verificare che i webhook siano raggiungibili
router.get('/test-webhook', testWebhook);
router.post('/test-webhook', testWebhook);

// Webhook per aggiornamenti di stato delle chiamate
router.post('/status-callback', statusCallback);
router.get('/status-callback', (req, res) => {
  console.log('🔔 GET Webhook ricevuto (non dovrebbe succedere):', req.query);
  res.status(200).send('Webhook GET ricevuto');
});

// Webhook per stato delle registrazioni
router.post('/recording-status', recordingStatusCallback);

// Webhook per gestire la fine delle registrazioni
router.post('/recording-complete', (req, res) => {
  console.log('🎙️  Registrazione completata:', req.body);
  res.status(200).send('<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>');
});

// Webhook per gestire la fine delle chiamate
router.post('/call-complete', (req, res) => {
  console.log('📞 Chiamata completata:', req.body);
  res.status(200).send('<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>');
});

export default router;

/**
 * DOCUMENTAZIONE ROUTES CHIAMATE
 * 
 * === ROUTES PROTETTE ===
 * 
 * POST /calls/initiate
 * Inizia una chiamata verso un contatto
 * Body: {
 *   contactId: string (required),
 *   recordCall?: boolean (default: true)
 * }
 * Response: { success: true, data: { call, twilioCallSid, status } }
 * 
 * GET /calls/my-calls
 * Ottieni le chiamate dell'utente corrente
 * Query: {
 *   limit?: number (default: 20),
 *   page?: number (default: 1),
 *   status?: string (queued|ringing|in-progress|completed|busy|no-answer|failed|canceled)
 * }
 * Response: { success: true, data: [calls], pagination: {...} }
 * 
 * GET /calls/contact/:contactId
 * Ottieni chiamate per un contatto specifico
 * Query: {
 *   limit?: number (default: 10),
 *   status?: string
 * }
 * Response: { success: true, data: [calls], count: number }
 * 
 * PUT /calls/:callId
 * Aggiorna note e outcome di una chiamata
 * Body: {
 *   notes?: string,
 *   outcome?: string (interested|not-interested|callback|voicemail|wrong-number|meeting-set|sale-made)
 * }
 * Response: { success: true, data: call }
 * 
 * GET /calls/stats
 * Ottieni statistiche delle chiamate
 * Query: {
 *   period?: string (7d|30d|90d, default: 30d),
 *   userId?: string (solo per manager/admin),
 *   contactId?: string
 * }
 * Response: { success: true, data: stats }
 * 
 * GET /calls/:callId/recording
 * Ottieni URL della registrazione
 * Response: { success: true, data: { recordingUrl, recordingSid, duration } }
 * 
 * === WEBHOOK ROUTES (PUBBLICHE) ===
 * 
 * POST /calls/status-callback
 * Webhook per aggiornamenti di stato da Twilio
 * Body: { CallSid, CallStatus, CallDuration, From, To, Direction, ... }
 * 
 * POST /calls/recording-status
 * Webhook per stato delle registrazioni da Twilio
 * Body: { CallSid, RecordingSid, RecordingUrl, RecordingStatus, RecordingDuration, ... }
 * 
 * === ESEMPI D'USO ===
 * 
 * // Inizia una chiamata
 * curl -X POST http://localhost:3000/api/calls/initiate \
 *   -H "Authorization: Bearer YOUR_JWT_TOKEN" \
 *   -H "Content-Type: application/json" \
 *   -d '{
 *     "contactId": "60d5ecb54a9b2c001f647b8a",
 *     "recordCall": true
 *   }'
 * 
 * // Ottieni le mie chiamate recenti
 * curl -X GET "http://localhost:3000/api/calls/my-calls?limit=10&status=completed" \
 *   -H "Authorization: Bearer YOUR_JWT_TOKEN"
 * 
 * // Aggiorna una chiamata con note e outcome
 * curl -X PUT http://localhost:3000/api/calls/60d5ecb54a9b2c001f647b8b \
 *   -H "Authorization: Bearer YOUR_JWT_TOKEN" \
 *   -H "Content-Type: application/json" \
 *   -d '{
 *     "notes": "Cliente interessato al prodotto premium",
 *     "outcome": "interested"
 *   }'
 * 
 * === CONFIGURAZIONE TWILIO RICHIESTA ===
 * 
 * Variabili d'ambiente nel file .env:
 * TWILIO_ACCOUNT_SID=your_account_sid
 * TWILIO_AUTH_TOKEN=your_auth_token
 * TWILIO_PHONE_NUMBER=+1234567890
 * BACKEND_URL=https://your-backend.onrender.com
 * 
 * === FLUSSO CHIAMATA ===
 * 
 * 1. Frontend chiama POST /calls/initiate
 * 2. Backend crea chiamata Twilio con registrazione
 * 3. Twilio invia callback di stato a /calls/status-callback
 * 4. Se c'è registrazione, Twilio invia callback a /calls/recording-status
 * 5. Database viene aggiornato con stato e registrazione
 * 6. Frontend può recuperare aggiornamenti via GET /calls/my-calls
 * 
 * === GESTIONE ERRORI ===
 * 
 * 400: Dati mancanti o numero telefono non valido
 * 401: Non autenticato
 * 403: Non autorizzato per questo contatto
 * 404: Contatto o chiamata non trovata
 * 500: Errore Twilio o interno del server
 */ 