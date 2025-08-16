import express from 'express';
import { protect } from '../controllers/authController.js';
import {
  getSessions,
  getSession,
  createSession,
  updateSession,
  disconnectSession,
  reconnectSession,
  deleteSession,
  getQrCode,
  sendTestMessage,
  getSessionStats
} from '../controllers/whatsappSessionController.js';

const router = express.Router();

// Middleware di autenticazione per tutte le routes
router.use(protect);

/**
 * ROUTES SESSIONI WHATSAPP
 */

// GET /api/whatsapp-sessions - Ottieni tutte le sessioni
router.get('/', getSessions);

// GET /api/whatsapp-sessions/:sessionId - Ottieni sessione specifica
router.get('/:sessionId', getSession);

// POST /api/whatsapp-sessions - Crea nuova sessione
router.post('/', createSession);

// PUT /api/whatsapp-sessions/:sessionId - Aggiorna sessione
router.put('/:sessionId', updateSession);

// GET /api/whatsapp-sessions/:sessionId/qr - Ottieni QR code
router.get('/:sessionId/qr', getQrCode);

// GET /api/whatsapp-sessions/:sessionId/stats - Ottieni statistiche
router.get('/:sessionId/stats', getSessionStats);

// POST /api/whatsapp-sessions/:sessionId/test-message - Invia messaggio test
router.post('/:sessionId/test-message', sendTestMessage);

// POST /api/whatsapp-sessions/:sessionId/disconnect - Disconnetti sessione
router.post('/:sessionId/disconnect', disconnectSession);

// POST /api/whatsapp-sessions/:sessionId/reconnect - Riconnetti sessione
router.post('/:sessionId/reconnect', reconnectSession);

// DELETE /api/whatsapp-sessions/:sessionId - Elimina sessione
router.delete('/:sessionId', deleteSession);

export default router;

/**
 * DOCUMENTAZIONE ROUTES SESSIONI WHATSAPP
 * 
 * === ROUTES AUTENTICATE ===
 * Tutte le routes richiedono autenticazione Bearer token
 * 
 * GET /api/whatsapp-sessions
 * Ottieni tutte le sessioni dell'utente
 * Response: { 
 *   success: true, 
 *   data: { 
 *     sessions: Array<WhatsappSession & { clientConnected: boolean, isExpired: boolean }> 
 *   } 
 * }
 * 
 * GET /api/whatsapp-sessions/:sessionId
 * Ottieni una sessione specifica
 * Response: { 
 *   success: true, 
 *   data: WhatsappSession & { clientConnected: boolean, isExpired: boolean } 
 * }
 * 
 * POST /api/whatsapp-sessions
 * Crea una nuova sessione WhatsApp
 * Body: {
 *   name: string (required), // Nome descrittivo della sessione
 *   sessionId: string (required) // ID univoco della sessione
 * }
 * Response: { success: true, data: WhatsappSession }
 * Note: Dopo la creazione, utilizzare /qr per ottenere il QR code da scannerizzare
 * 
 * PUT /api/whatsapp-sessions/:sessionId
 * Aggiorna una sessione (solo se non attiva)
 * Body: {
 *   name?: string,
 *   config?: {
 *     useChrome?: boolean,
 *     headless?: boolean,
 *     autoRefresh?: boolean,
 *     qrTimeout?: number,
 *     authTimeout?: number
 *   }
 * }
 * Response: { success: true, data: WhatsappSession }
 * 
 * GET /api/whatsapp-sessions/:sessionId/qr
 * Ottieni il QR code per connettere la sessione
 * Response: { 
 *   success: true, 
 *   data: { 
 *     qrCode: string, // Base64 del QR code
 *     generatedAt: Date,
 *     expiresAt: Date 
 *   } 
 * }
 * Note: Il QR code scade dopo 5 minuti
 * 
 * GET /api/whatsapp-sessions/:sessionId/stats
 * Ottieni statistiche della sessione
 * Response: { 
 *   success: true, 
 *   data: { 
 *     session: { messagesSent, messagesReceived, ... },
 *     campaigns: { total, running, completed, ... },
 *     connection: { status, connectedAt, isActive, ... } 
 *   } 
 * }
 * 
 * POST /api/whatsapp-sessions/:sessionId/test-message
 * Invia un messaggio di test
 * Body: {
 *   phoneNumber: string (required), // Numero destinatario
 *   message: string (required) // Testo del messaggio
 * }
 * Response: { 
 *   success: true, 
 *   data: { messageId: string, sentAt: Date } 
 * }
 * 
 * POST /api/whatsapp-sessions/:sessionId/disconnect
 * Disconnetti la sessione WhatsApp
 * Response: { success: true, message: string }
 * 
 * POST /api/whatsapp-sessions/:sessionId/reconnect
 * Riconnetti la sessione WhatsApp
 * Response: { success: true, message: string }
 * Note: Potrebbe generare un nuovo QR code se necessario
 * 
 * DELETE /api/whatsapp-sessions/:sessionId
 * Elimina definitivamente la sessione
 * Response: { success: true, message: string }
 * Note: Non è possibile eliminare sessioni con campagne attive
 * 
 * === FLUSSO DI CONNESSIONE ===
 * 
 * 1. POST /api/whatsapp-sessions - Crea sessione
 * 2. GET /api/whatsapp-sessions/:sessionId/qr - Ottieni QR code
 * 3. Scansiona QR code con WhatsApp
 * 4. Verifica connessione con GET /api/whatsapp-sessions/:sessionId
 * 5. Status diventa 'connected' quando pronto per l'uso
 * 
 * === STATI SESSIONE ===
 * 
 * - disconnected: Non connessa
 * - connecting: Connessione in corso
 * - qr_ready: QR code disponibile per scansione
 * - authenticated: Autenticata ma non ancora pronta
 * - connected: Connessa e pronta per l'uso
 * - error: Errore di connessione
 * 
 * === ESEMPI D'USO ===
 * 
 * // Crea sessione
 * curl -X POST http://localhost:3000/api/whatsapp-sessions \
 *   -H "Authorization: Bearer YOUR_TOKEN" \
 *   -H "Content-Type: application/json" \
 *   -d '{
 *     "name": "Marketing WhatsApp",
 *     "sessionId": "marketing-wa"
 *   }'
 * 
 * // Ottieni QR code
 * curl -X GET http://localhost:3000/api/whatsapp-sessions/marketing-wa/qr \
 *   -H "Authorization: Bearer YOUR_TOKEN"
 * 
 * // Invia messaggio di test
 * curl -X POST http://localhost:3000/api/whatsapp-sessions/marketing-wa/test-message \
 *   -H "Authorization: Bearer YOUR_TOKEN" \
 *   -H "Content-Type: application/json" \
 *   -d '{
 *     "phoneNumber": "+393331234567",
 *     "message": "Test di connessione!"
 *   }'
 * 
 * === CONFIGURAZIONE OPZIONALE ===
 * 
 * Le sessioni supportano configurazioni personalizzate:
 * - useChrome: true (raccomandato per video/GIF)
 * - headless: true (modalità senza interfaccia)
 * - autoRefresh: true (auto-refresh QR code)
 * - qrTimeout: 30 (timeout QR in secondi)
 * - authTimeout: 30 (timeout autenticazione in secondi)
 * 
 * === LIMITI ===
 * 
 * - Massimo 3 sessioni per utente
 * - QR code scade dopo 5 minuti
 * - Sessioni inattive per più di 5 minuti vengono marcate come scadute
 * 
 * === CODICI DI ERRORE ===
 * 
 * 400: Dati mancanti, sessionId già in uso, o limite sessioni raggiunto
 * 401: Non autenticato
 * 404: Sessione non trovata
 * 410: QR code scaduto
 * 500: Errore interno del server
 */ 