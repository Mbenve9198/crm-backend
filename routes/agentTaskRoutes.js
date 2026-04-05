import express from 'express';
import AgentTask from '../models/agentTaskModel.js';
import { protect } from '../middleware/authMiddleware.js';

const router = express.Router();

router.use(protect);

router.get('/tasks', async (req, res) => {
  try {
    const { status, type, limit = 50, offset = 0 } = req.query;
    const filter = {};
    if (status) filter.status = status;
    if (type) filter.type = type;

    const tasks = await AgentTask.find(filter)
      .populate('contact', 'name email phone')
      .populate('conversation', 'stage status')
      .sort({ scheduledAt: -1 })
      .skip(parseInt(offset))
      .limit(parseInt(limit));

    const total = await AgentTask.countDocuments(filter);

    res.json({ tasks, total, limit: parseInt(limit), offset: parseInt(offset) });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/tasks/stats', async (req, res) => {
  try {
    const stats = await AgentTask.aggregate([
      { $group: { _id: { status: '$status', type: '$type' }, count: { $sum: 1 } } }
    ]);
    res.json({ stats });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/tasks', async (req, res) => {
  try {
    const { type, contactId, conversationId, scheduledAt, context, priority } = req.body;
    const task = await AgentTask.create({
      type,
      contact: contactId,
      conversation: conversationId || undefined,
      scheduledAt: new Date(scheduledAt),
      context: context || {},
      priority: priority || 'medium',
      createdBy: 'human'
    });
    res.status(201).json({ task });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.patch('/tasks/:id/cancel', async (req, res) => {
  try {
    const task = await AgentTask.findById(req.params.id);
    if (!task) return res.status(404).json({ error: 'Task non trovato' });
    if (task.status !== 'pending') return res.status(400).json({ error: 'Solo task pending possono essere cancellati' });

    task.status = 'cancelled';
    task.cancelledReason = req.body.reason || 'Cancelled by user';
    await task.save();

    res.json({ task });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
