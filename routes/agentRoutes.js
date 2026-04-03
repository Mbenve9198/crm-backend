import express from 'express';
import Conversation from '../models/conversationModel.js';
import ConversationOutcome from '../models/conversationOutcomeModel.js';
import AgentMetric from '../models/agentMetricModel.js';
import AgentLog from '../models/agentLogModel.js';
import { approveAndSend, discardReply } from '../services/salesAgentService.js';
import { protect } from '../controllers/authController.js';

const router = express.Router();

router.use(protect);

/**
 * GET /api/agent/conversations
 * Lista conversazioni attive dell'agente
 */
router.get('/conversations', async (req, res) => {
  try {
    const { status = 'active', limit = 50, offset = 0, contactId } = req.query;
    const filter = {};
    if (status !== 'all') filter.status = status;
    if (contactId) filter.contact = contactId;

    const conversations = await Conversation.find(filter)
      .populate('contact', 'name email phone status source properties')
      .populate('assignedTo', 'firstName lastName email')
      .sort({ updatedAt: -1 })
      .skip(parseInt(offset))
      .limit(parseInt(limit))
      .lean();

    const total = await Conversation.countDocuments(filter);

    res.json({ success: true, data: conversations, total });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/agent/conversations/:id
 * Dettaglio conversazione con tutti i messaggi
 */
router.get('/conversations/:id', async (req, res) => {
  try {
    const conversation = await Conversation.findById(req.params.id)
      .populate('contact', 'name email phone status source properties rankCheckerData')
      .populate('assignedTo', 'firstName lastName email');

    if (!conversation) return res.status(404).json({ success: false, error: 'Conversazione non trovata' });
    res.json({ success: true, data: conversation });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/agent/conversations/:id/approve
 * Approva e invia la bozza dell'agente (o contenuto modificato)
 */
router.post('/conversations/:id/approve', async (req, res) => {
  try {
    const { modifiedContent } = req.body;
    const result = await approveAndSend(req.params.id, modifiedContent || null);
    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/agent/conversations/:id/discard
 * Scarta la risposta e mette in pausa
 */
router.post('/conversations/:id/discard', async (req, res) => {
  try {
    const result = await discardReply(req.params.id);
    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/agent/conversations/:id/reply
 * Invia una risposta manuale (umana) nella conversazione
 */
router.post('/conversations/:id/reply', async (req, res) => {
  try {
    const { content } = req.body;
    if (!content) return res.status(400).json({ success: false, error: 'Contenuto obbligatorio' });

    const result = await approveAndSend(req.params.id, content);
    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * PATCH /api/agent/conversations/:id/stage
 * Aggiorna lo stage manualmente
 */
router.patch('/conversations/:id/stage', async (req, res) => {
  try {
    const { stage } = req.body;
    const validStages = ['initial_reply', 'objection_handling', 'qualification', 'scheduling', 'handoff'];
    if (!validStages.includes(stage)) return res.status(400).json({ success: false, error: 'Stage non valido' });

    const conversation = await Conversation.findByIdAndUpdate(
      req.params.id,
      { stage },
      { new: true }
    );
    res.json({ success: true, data: conversation });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/agent/conversations/:id/note
 * Aggiunge una nota umana alla conversazione
 */
router.post('/conversations/:id/note', async (req, res) => {
  try {
    const { note } = req.body;
    if (!note) return res.status(400).json({ success: false, error: 'Nota obbligatoria' });

    const conversation = await Conversation.findById(req.params.id);
    if (!conversation) return res.status(404).json({ success: false, error: 'Non trovata' });

    if (!conversation.context.humanNotes) conversation.context.humanNotes = [];
    conversation.context.humanNotes.push({ note, at: new Date() });
    conversation.markModified('context');
    await conversation.save();

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/agent/stats
 * Statistiche aggregate dell'agente
 */
router.get('/stats', async (req, res) => {
  try {
    const [active, awaitingHuman, converted, lost] = await Promise.all([
      Conversation.countDocuments({ status: 'active' }),
      Conversation.countDocuments({ status: 'awaiting_human' }),
      Conversation.countDocuments({ outcome: { $in: ['sql', 'call_booked'] } }),
      Conversation.countDocuments({ outcome: 'lost' })
    ]);

    const recentOutcomes = await ConversationOutcome.find()
      .sort({ createdAt: -1 })
      .limit(10)
      .populate('contact', 'name email')
      .lean();

    res.json({
      success: true,
      data: { active, awaitingHuman, converted, lost, recentOutcomes }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/agent/metrics
 * Metriche di osservabilita: costi token, durata turni, tool usage
 */
router.get('/metrics', async (req, res) => {
  try {
    const { days = 7 } = req.query;
    const startDate = new Date(Date.now() - parseInt(days) * 24 * 60 * 60 * 1000);

    const summary = await AgentMetric.getMetricsSummary(startDate, new Date());

    const dailyCosts = await AgentMetric.aggregate([
      { $match: { createdAt: { $gte: startDate }, event: 'llm_call' } },
      { $group: {
        _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
        cost: { $sum: '$data.costUsd' },
        calls: { $sum: 1 },
        tokens: { $sum: { $add: ['$data.inputTokens', '$data.outputTokens'] } }
      }},
      { $sort: { _id: 1 } }
    ]);

    res.json({ success: true, data: { ...summary, dailyCosts, period: { from: startDate, to: new Date(), days: parseInt(days) } } });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/agent/logs
 * Log strutturati dell'agente (persistiti su MongoDB)
 */
router.get('/logs', async (req, res) => {
  try {
    const { level, conversationId, event, limit = 100, offset = 0 } = req.query;
    const filter = {};
    if (level) filter.level = level;
    if (conversationId) filter.conversationId = conversationId;
    if (event) filter.event = { $regex: event, $options: 'i' };

    const logs = await AgentLog.find(filter)
      .sort({ createdAt: -1 })
      .skip(parseInt(offset))
      .limit(parseInt(limit))
      .lean();

    const total = await AgentLog.countDocuments(filter);
    res.json({ success: true, data: logs, total });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
