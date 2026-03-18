import express from 'express';
import { protect } from '../controllers/authController.js';
import { getDashboard } from '../controllers/dashboardController.js';

const router = express.Router();

// Tutti i ruoli autenticati possono accedere al cruscotto
router.use(protect);

router.get('/', getDashboard);

export default router;

