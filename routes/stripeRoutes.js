import express from 'express';
import { protect, restrictTo } from '../controllers/authController.js';
import { syncSingleContact, syncAllWon, getInvoices, searchCustomers, linkCustomer } from '../controllers/stripeController.js';

const router = express.Router();

router.use(protect);

router.post('/sync/:id', restrictTo('agent', 'manager', 'admin'), syncSingleContact);
router.post('/sync-all-won', restrictTo('manager', 'admin'), syncAllWon);
router.get('/invoices/:id', getInvoices);
router.get('/search-customers', searchCustomers);
router.post('/link/:id', restrictTo('agent', 'manager', 'admin'), linkCustomer);

export default router;
