import express from 'express';
import {
  getAllUsers,
  getUserById,
  updateUser,
  toggleUserStatus,
  deleteUser,
  transferUserContacts,
  getUsersStats,
  getUsersForAssignment,
  resetUserPassword,
  getTablePreferences,
  updateTablePreferences
} from '../controllers/userController.js';
import { protect, restrictTo } from '../controllers/authController.js';

const router = express.Router();

/**
 * MIDDLEWARE DI AUTENTICAZIONE
 * Tutte le routes utenti richiedono autenticazione
 */
router.use(protect);

/**
 * ROUTES PER GESTIONE UTENTI
 */

// Statistiche utenti (solo manager/admin)
router.get('/stats', restrictTo('manager', 'admin'), getUsersStats);

// Lista utenti per assegnazione contatti (agent e superiori)
router.get('/for-assignment', restrictTo('agent', 'manager', 'admin'), getUsersForAssignment);

// Preferenze tabella utente corrente (tutti gli utenti autenticati)
router.get('/me/table-preferences', getTablePreferences);
router.put('/me/table-preferences', updateTablePreferences);

// CRUD Operations per utenti (solo manager/admin)
router.get('/', restrictTo('manager', 'admin'), getAllUsers);
router.get('/:id', restrictTo('manager', 'admin'), getUserById);
router.put('/:id', restrictTo('manager', 'admin'), updateUser);

// Operazioni admin specifiche
router.put('/:id/toggle-status', restrictTo('admin'), toggleUserStatus);
router.delete('/:id', restrictTo('admin'), deleteUser);
router.post('/:id/reset-password', restrictTo('admin'), resetUserPassword);

// Trasferimento ownership contatti (manager/admin)
router.post('/:fromUserId/transfer-contacts/:toUserId', 
  restrictTo('manager', 'admin'), 
  transferUserContacts
);

export default router;

/**
 * DOCUMENTAZIONE ROUTES GESTIONE UTENTI
 * 
 * === ROUTES STATISTICHE ===
 * 
 * GET /users/stats
 * Ottieni statistiche generali degli utenti (solo manager/admin)
 * Response: {
 *   success: true,
 *   data: {
 *     overview: { totalUsers, activeUsers, recentUsers, totalContacts },
 *     roleStats: [{ _id: role, count, active }],
 *     departmentStats: [{ _id: department, count, totalContacts }],
 *     topUsersByContacts: [{ firstName, lastName, email, role, totalContacts }]
 *   }
 * }
 * 
 * GET /users/for-assignment
 * Lista utenti per assegnazione contatti (esclude viewer di default)
 * Query: excludeRole=false (per includere anche viewer)
 * Response: {
 *   success: true,
 *   data: {
 *     users: [{ _id, firstName, lastName, email, role, currentContactsCount }]
 *   }
 * }
 * 
 * === ROUTES CRUD UTENTI ===
 * 
 * GET /users
 * Lista di tutti gli utenti con filtri (solo manager/admin)
 * Query params:
 *   - page: number (default: 1)
 *   - limit: number (default: 10)
 *   - role: 'admin' | 'manager' | 'agent' | 'viewer'
 *   - department: string
 *   - isActive: boolean
 *   - search: string (cerca in nome, cognome, email)
 * Response: {
 *   success: true,
 *   data: {
 *     users: [{ user data + contactsCount }],
 *     pagination: { currentPage, totalPages, totalUsers, hasNext, hasPrev }
 *   }
 * }
 * 
 * GET /users/:id
 * Dettagli utente specifico (solo manager/admin)
 * Response: {
 *   success: true,
 *   data: {
 *     user: { user data + contactsCount + recentContacts }
 *   }
 * }
 * 
 * PUT /users/:id
 * Aggiorna utente (solo manager/admin)
 * Body: {
 *   firstName?: string,
 *   lastName?: string,
 *   email?: string,
 *   role?: string (solo admin),
 *   department?: string,
 *   phone?: string,
 *   isActive?: boolean (solo admin)
 * }
 * 
 * === ROUTES OPERAZIONI ADMIN ===
 * 
 * PUT /users/:id/toggle-status
 * Attiva/disattiva utente (solo admin)
 * Response: { success: true, message: string, data: { user } }
 * 
 * DELETE /users/:id
 * Elimina utente (solo admin)
 * Nota: Fallisce se l'utente ha contatti assegnati
 * 
 * POST /users/:id/reset-password
 * Reset password utente (solo admin)
 * Body: { newPassword: string (min 6 chars) }
 * 
 * POST /users/:fromUserId/transfer-contacts/:toUserId
 * Trasferisce tutti i contatti da un utente a un altro (manager/admin)
 * Response: {
 *   success: true,
 *   data: {
 *     transferredCount: number,
 *     fromUser: string,
 *     toUser: string,
 *     transferredBy: string,
 *     transferredAt: Date
 *   }
 * }
 * 
 * === ESEMPI D'USO ===
 * 
 * // Lista utenti con filtri
 * curl -X GET "http://localhost:3000/api/users?role=agent&department=Vendite&page=1" \
 *   -H "Authorization: Bearer YOUR_JWT_TOKEN"
 * 
 * // Aggiorna utente
 * curl -X PUT http://localhost:3000/api/users/USER_ID \
 *   -H "Authorization: Bearer YOUR_JWT_TOKEN" \
 *   -H "Content-Type: application/json" \
 *   -d '{
 *     "role": "manager",
 *     "department": "Marketing"
 *   }'
 * 
 * // Trasferisce contatti
 * curl -X POST http://localhost:3000/api/users/FROM_USER_ID/transfer-contacts/TO_USER_ID \
 *   -H "Authorization: Bearer YOUR_JWT_TOKEN"
 * 
 * // Reset password
 * curl -X POST http://localhost:3000/api/users/USER_ID/reset-password \
 *   -H "Authorization: Bearer YOUR_JWT_TOKEN" \
 *   -H "Content-Type: application/json" \
 *   -d '{ "newPassword": "newpassword123" }'
 * 
 * // Lista per assegnazione contatti
 * curl -X GET http://localhost:3000/api/users/for-assignment \
 *   -H "Authorization: Bearer YOUR_JWT_TOKEN"
 * 
 * // Statistiche utenti
 * curl -X GET http://localhost:3000/api/users/stats \
 *   -H "Authorization: Bearer YOUR_JWT_TOKEN"
 * 
 * === AUTORIZZAZIONI PER RUOLO ===
 * 
 * Agent:
 * - GET /users/for-assignment (per vedere a chi assegnare contatti)
 * 
 * Manager:
 * - Tutti i permessi di Agent +
 * - GET /users (lista e dettagli utenti)
 * - PUT /users/:id (aggiorna utenti, eccetto ruolo e isActive)
 * - POST /users/:fromUserId/transfer-contacts/:toUserId
 * - GET /users/stats
 * 
 * Admin:
 * - Tutti i permessi di Manager +
 * - PUT /users/:id (può modificare ruolo e isActive)
 * - PUT /users/:id/toggle-status
 * - DELETE /users/:id
 * - POST /users/:id/reset-password
 * 
 * === CODICI DI ERRORE ===
 * 
 * 400: Dati non validi o operazione non permessa
 * 401: Non autenticato
 * 403: Non autorizzato per questa operazione
 * 404: Utente non trovato
 * 409: Conflitto (es. email già esistente)
 * 500: Errore interno del server
 */ 