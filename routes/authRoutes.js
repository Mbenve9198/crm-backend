import express from 'express';
import {
  register,
  login,
  logout,
  protect,
  getMe,
  updateMe,
  changePassword
} from '../controllers/authController.js';

const router = express.Router();

/**
 * ROUTES DI AUTENTICAZIONE PUBBLICHE
 * Non richiedono autenticazione
 */

// Registrazione nuovo utente
router.post('/register', register);

// Login utente
router.post('/login', login);

// Logout utente
router.post('/logout', logout);

/**
 * ROUTES PROTETTE - RICHIEDONO AUTENTICAZIONE
 * Middleware protect applicato a tutte le routes successive
 */
router.use(protect);

// Profilo utente corrente
router.get('/me', getMe);

// Aggiorna profilo utente corrente
router.put('/me', updateMe);

// Cambia password
router.put('/change-password', changePassword);

export default router;

/**
 * DOCUMENTAZIONE ROUTES AUTENTICAZIONE
 * 
 * === ROUTES PUBBLICHE ===
 * 
 * POST /auth/register
 * Registra un nuovo utente nel sistema
 * Body: {
 *   firstName: string (required),
 *   lastName: string (required), 
 *   email: string (required, unique),
 *   password: string (required, min 6 chars),
 *   role?: 'admin' | 'manager' | 'agent' | 'viewer' (default: 'agent'),
 *   department?: string,
 *   phone?: string
 * }
 * Response: { success: true, token: string, data: { user } }
 * 
 * POST /auth/login
 * Effettua il login dell'utente
 * Body: {
 *   email: string (required),
 *   password: string (required)
 * }
 * Response: { success: true, token: string, data: { user } }
 * 
 * POST /auth/logout
 * Effettua il logout dell'utente (invalida il cookie)
 * Response: { success: true, message: string }
 * 
 * === ROUTES PROTETTE ===
 * 
 * GET /auth/me
 * Ottieni informazioni dell'utente corrente
 * Headers: Authorization: Bearer <token>
 * Response: { success: true, data: { user } }
 * 
 * PUT /auth/me
 * Aggiorna il profilo dell'utente corrente
 * Body: {
 *   firstName?: string,
 *   lastName?: string,
 *   phone?: string,
 *   department?: string,
 *   avatar?: string (URL),
 *   settings?: {
 *     language?: 'it' | 'en' | 'es' | 'fr',
 *     timezone?: string,
 *     notifications?: {
 *       email?: boolean,
 *       push?: boolean,
 *       newContacts?: boolean,
 *       assignedContacts?: boolean
 *     }
 *   }
 * }
 * Response: { success: true, data: { user } }
 * 
 * PUT /auth/change-password
 * Cambia la password dell'utente corrente
 * Body: {
 *   currentPassword: string (required),
 *   newPassword: string (required, min 6 chars)
 * }
 * Response: { success: true, token: string, data: { user } }
 * 
 * === ESEMPI D'USO ===
 * 
 * // Registrazione
 * curl -X POST http://localhost:3000/api/auth/register \
 *   -H "Content-Type: application/json" \
 *   -d '{
 *     "firstName": "Mario",
 *     "lastName": "Rossi",
 *     "email": "mario.rossi@email.com",
 *     "password": "password123",
 *     "role": "agent",
 *     "department": "Vendite"
 *   }'
 * 
 * // Login
 * curl -X POST http://localhost:3000/api/auth/login \
 *   -H "Content-Type: application/json" \
 *   -d '{
 *     "email": "mario.rossi@email.com",
 *     "password": "password123"
 *   }'
 * 
 * // Ottieni profilo (con token)
 * curl -X GET http://localhost:3000/api/auth/me \
 *   -H "Authorization: Bearer YOUR_JWT_TOKEN"
 * 
 * // Aggiorna profilo
 * curl -X PUT http://localhost:3000/api/auth/me \
 *   -H "Authorization: Bearer YOUR_JWT_TOKEN" \
 *   -H "Content-Type: application/json" \
 *   -d '{
 *     "phone": "+39 123 456 7890",
 *     "department": "Marketing"
 *   }'
 * 
 * === GESTIONE TOKEN ===
 * 
 * Il token JWT viene inviato in due modi:
 * 1. Nel body della risposta come "token"
 * 2. Come cookie httpOnly "jwt" per sicurezza
 * 
 * Per le richieste successive puoi usare:
 * - Header: Authorization: Bearer <token>
 * - Cookie: jwt=<token> (automatico nel browser)
 * 
 * === RUOLI E PERMESSI ===
 * 
 * - viewer: Solo lettura contatti
 * - agent: CRUD sui propri contatti
 * - manager: CRUD su tutti i contatti, gestione utenti base
 * - admin: Accesso completo sistema, gestione utenti avanzata
 * 
 * === CODICI DI ERRORE ===
 * 
 * 400: Dati mancanti o non validi
 * 401: Non autenticato o credenziali errate
 * 403: Non autorizzato per questa operazione
 * 409: Email già esistente (registrazione)
 * 500: Errore interno del server
 */ 