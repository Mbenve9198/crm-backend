import express from 'express';
import {
  getTwilioSettings,
  configureTwilio,
  verifyTwilio,
  disableTwilio,
  testCall
} from '../controllers/twilioSettingsController.js';
import { protect } from '../controllers/authController.js';

const router = express.Router();

/**
 * ROUTES PER LE IMPOSTAZIONI TWILIO
 * Tutte le routes richiedono autenticazione
 */

// Ottieni configurazione Twilio dell'utente corrente
router.get('/', protect, getTwilioSettings);

// Configura credenziali Twilio
router.post('/configure', protect, configureTwilio);

// Verifica configurazione Twilio
router.post('/verify', protect, verifyTwilio);

// Disabilita Twilio per l'utente
router.post('/disable', protect, disableTwilio);

// Test chiamata
router.post('/test-call', protect, testCall);

export default router;

/**
 * DOCUMENTAZIONE ROUTES IMPOSTAZIONI TWILIO
 * 
 * === ROUTES AUTENTICATE ===
 * 
 * GET /settings/twilio
 * Ottieni configurazione Twilio dell'utente corrente
 * Response: {
 *   success: true,
 *   data: {
 *     accountSid: string,
 *     phoneNumber: string,
 *     isVerified: boolean,
 *     isEnabled: boolean,
 *     lastVerified: date
 *   }
 * }
 * 
 * POST /settings/twilio/configure
 * Configura credenziali Twilio per l'utente
 * Body: {
 *   accountSid: string (required),
 *   authToken: string (required),
 *   phoneNumber: string (required, formato E.164)
 * }
 * Response: { success: true, message: string, data: config }
 * 
 * POST /settings/twilio/verify
 * Verifica configurazione Twilio testando connessione
 * Response: {
 *   success: true,
 *   message: string,
 *   data: {
 *     accountName: string,
 *     accountSid: string,
 *     phoneNumber: string,
 *     isVerified: true,
 *     isEnabled: true
 *   }
 * }
 * 
 * POST /settings/twilio/disable
 * Disabilita Twilio per l'utente
 * Response: { success: true, message: string, data: config }
 * 
 * POST /settings/twilio/test-call
 * Effettua una chiamata di test
 * Body: {
 *   testNumber: string (required, formato E.164)
 * }
 * Response: {
 *   success: true,
 *   message: string,
 *   data: {
 *     callSid: string,
 *     status: string,
 *     to: string,
 *     from: string
 *   }
 * }
 * 
 * === ESEMPI D'USO ===
 * 
 * // Configura Twilio
 * curl -X POST http://localhost:3000/api/settings/twilio/configure \
 *   -H "Authorization: Bearer YOUR_JWT_TOKEN" \
 *   -H "Content-Type: application/json" \
 *   -d '{
 *     "accountSid": "ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
 *     "authToken": "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
 *     "phoneNumber": "+393331234567"
 *   }'
 * 
 * // Verifica configurazione
 * curl -X POST http://localhost:3000/api/settings/twilio/verify \
 *   -H "Authorization: Bearer YOUR_JWT_TOKEN"
 * 
 * // Test chiamata
 * curl -X POST http://localhost:3000/api/settings/twilio/test-call \
 *   -H "Authorization: Bearer YOUR_JWT_TOKEN" \
 *   -H "Content-Type: application/json" \
 *   -d '{
 *     "testNumber": "+393331234567"
 *   }'
 * 
 * === FLUSSO CONFIGURAZIONE ===
 * 
 * 1. Utente inserisce credenziali Twilio → POST /configure
 * 2. Sistema salva configurazione (non verificata)
 * 3. Utente clicca "Verifica" → POST /verify
 * 4. Sistema testa connessione e marca come verificato
 * 5. Utente può testare con chiamata → POST /test-call
 * 6. Twilio è abilitato per le chiamate del CRM
 * 
 * === CODICI DI ERRORE ===
 * 
 * 400: Dati mancanti, formato numero errato, credenziali Twilio invalide
 * 401: Non autenticato
 * 500: Errore interno del server o errore Twilio
 */ 