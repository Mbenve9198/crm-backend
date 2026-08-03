import express from 'express';
import { protect, restrictTo } from '../controllers/authController.js';
import {
  overview,
  mrrOverview,
  plans,
  plansTrend,
  plansFromContacts,
  customersList,
  upcomingPayments,
  snapshotGenerate,
  snapshotBackfill,
} from '../controllers/saasMetricsController.js';

const router = express.Router();

router.use(protect);
router.use(restrictTo('admin'));

router.get('/overview', overview);
router.get('/mrr-overview', mrrOverview);
router.get('/plans', plans);
router.get('/plans/trend', plansTrend);
router.get('/plans/from-contacts', plansFromContacts);
router.get('/customers', customersList);
router.get('/upcoming-payments', upcomingPayments);
router.post('/snapshot/generate', snapshotGenerate);
router.post('/snapshot/backfill', snapshotBackfill);

export default router;
