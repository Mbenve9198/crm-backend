import express from 'express';
import auth from '../middleware/auth.js';
import { 
  checkAllSessions,
  checkSession,
  getMonitorStats,
  toggleMonitor,
  syncSession
} from '../controllers/sessionMonitorController.js';

const router = express.Router();

// Tutte le routes richiedono autenticazione
router.use(auth);

// Monitor generale
router.post('/check-all', checkAllSessions);
router.get('/stats', getMonitorStats);
router.post('/toggle', toggleMonitor);

// Monitor per sessioni specifiche
router.post('/check/:sessionId', checkSession);
router.post('/sync/:sessionId', syncSession);

export default router;

/**
 * DOCUMENTAZIONE ROUTES MONITOR SESSIONI
 * 
 * === ROUTES AUTENTICATE ===
 * Tutte le routes richiedono autenticazione Bearer token
 * 
 * GET /api/session-monitor/stats
 * Ottieni statistiche del monitor e database
 * Response: { 
 *   success: true, 
 *   data: { 
 *     monitor: { isRunning, checkInterval, nextCheck },
 *     database: { totalSessions, activeSessions, connectedSessions }
 *   } 
 * }
 * 
 * POST /api/session-monitor/check-all
 * Forza controllo immediato di tutte le sessioni
 * Response: { success: true, message: string, timestamp: Date }
 * 
 * POST /api/session-monitor/check/:sessionId
 * Forza controllo immediato di una sessione specifica
 * Response: { 
 *   success: true, 
 *   message: string, 
 *   data: WhatsappSession,
 *   timestamp: Date 
 * }
 * 
 * POST /api/session-monitor/sync/:sessionId
 * Sincronizza forzatamente una sessione (include riavvio OpenWA se necessario)
 * Response: { 
 *   success: true, 
 *   message: string, 
 *   data: WhatsappSession,
 *   timestamp: Date 
 * }
 * 
 * POST /api/session-monitor/toggle
 * Avvia o ferma il monitor automatico
 * Body: { action: 'start' | 'stop' }
 * Response: { success: true, message: string, isRunning: boolean }
 * 
 * === ESEMPI D'USO ===
 * 
 * // Controlla tutte le sessioni manualmente
 * curl -X POST http://localhost:3000/api/session-monitor/check-all \
 *   -H "Authorization: Bearer YOUR_TOKEN"
 * 
 * // Sincronizza una sessione specifica
 * curl -X POST http://localhost:3000/api/session-monitor/sync/my-session \
 *   -H "Authorization: Bearer YOUR_TOKEN"
 * 
 * // Ottieni statistiche
 * curl -X GET http://localhost:3000/api/session-monitor/stats \
 *   -H "Authorization: Bearer YOUR_TOKEN"
 * 
 * === FUNZIONALITÀ ===
 * 
 * Il monitor delle sessioni:
 * - Controlla ogni 5 minuti lo stato delle sessioni attive
 * - Sincronizza stato database con stato reale OpenWA
 * - Aggiorna automaticamente informazioni di connessione
 * - Rileva disconnessioni e aggiorna stati
 * - Fornisce API per controlli manuali e sincronizzazione forzata
 * 
 * === CODICI DI ERRORE ===
 * 
 * 400: Parametri non validi
 * 401: Non autenticato
 * 404: Sessione non trovata o non autorizzata
 * 500: Errore interno del server
 */ 