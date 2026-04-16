import express from 'express';
import { protect, restrictTo } from '../controllers/authController.js';
import { getAssignmentConfig, updateAssignmentConfig } from '../controllers/assignmentConfigController.js';

const router = express.Router();

router.use(protect);
router.use(restrictTo('admin'));

router.get('/assignment', getAssignmentConfig);
router.put('/assignment', updateAssignmentConfig);

export default router;
