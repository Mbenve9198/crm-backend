import express from 'express';
import {
  getContactActivities,
  createActivity,
  updateActivity,
  deleteActivity,
  getContactActivityStats
} from '../controllers/activityController.js';
import { protect, restrictTo } from '../controllers/authController.js';

const router = express.Router();

/**
 * MIDDLEWARE DI AUTENTICAZIONE
 * Tutte le routes delle activities richiedono autenticazione
 */
router.use(protect);

/**
 * ROUTES PER LE ACTIVITIES DEI CONTATTI
 */

// Activities di un contatto specifico
router.get('/contacts/:contactId/activities', getContactActivities);
router.post('/contacts/:contactId/activities', restrictTo('agent', 'manager', 'admin'), createActivity);
router.get('/contacts/:contactId/activities/stats', getContactActivityStats);

// Gestione singole activities
router.put('/activities/:id', restrictTo('agent', 'manager', 'admin'), updateActivity);
router.delete('/activities/:id', restrictTo('agent', 'manager', 'admin'), deleteActivity);

export default router; 