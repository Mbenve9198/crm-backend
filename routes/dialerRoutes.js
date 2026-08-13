import express from 'express';
import {
  getDialerQueue,
  getColdCallScript,
  upsertVisibilityCard,
  wrapUpDialer,
} from '../controllers/dialerController.js';
import { protect, restrictTo } from '../controllers/authController.js';

const router = express.Router();

router.use(protect);
router.use(restrictTo('agent', 'manager', 'admin'));

router.get('/queue', getDialerQueue);
router.post('/wrap-up', wrapUpDialer);
router.get('/contacts/:id/script', getColdCallScript);
router.put('/contacts/:id/visibility-card', upsertVisibilityCard);

export default router;
