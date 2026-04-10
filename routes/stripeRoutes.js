import express from 'express';
import { protect, restrictTo } from '../controllers/authController.js';
import { syncSingleContact, syncAllWon, getInvoices, searchCustomers, linkCustomer, unlinkCustomer, diagnose, unmatchedCustomers } from '../controllers/stripeController.js';

const router = express.Router();

router.use(protect);

router.post('/sync/:id', restrictTo('agent', 'manager', 'admin'), syncSingleContact);
router.post('/sync-all-won', restrictTo('manager', 'admin'), syncAllWon);
router.get('/invoices/:id', getInvoices);
router.get('/search-customers', searchCustomers);
router.get('/unmatched-customers', restrictTo('admin'), unmatchedCustomers);
router.post('/link/:id', restrictTo('agent', 'manager', 'admin'), linkCustomer);
router.post('/unlink/:id', restrictTo('agent', 'manager', 'admin'), unlinkCustomer);
router.get('/diagnose/:id', restrictTo('admin'), diagnose);

export default router;
