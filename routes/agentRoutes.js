import express from 'express';
import Conversation from '../models/conversationModel.js';
import ConversationOutcome from '../models/conversationOutcomeModel.js';
import AgentMetric from '../models/agentMetricModel.js';
import AgentLog from '../models/agentLogModel.js';
import AgentFeedback from '../models/agentFeedbackModel.js';
import { approveAndSend, discardReply } from '../services/salesAgentService.js';
import { buildFeedbackContext, getISOWeek } from '../services/signedUrlService.js';
import { sendFeedbackToAgent } from '../services/agentServiceClient.js';
import Contact from '../models/contactModel.js';
import { protect } from '../controllers/authController.js';

const router = express.Router();

router.use(protect);

/**
 * GET /api/agent/conversations
 * Lista conversazioni attive dell'agente
 */
router.get('/conversations', async (req, res) => {
  try {
    const { status = 'active', limit = 50, offset = 0, contactId, channel, search, sort = 'updatedAt' } = req.query;
    const filter = {};
    if (status !== 'all') filter.status = status;
    if (contactId) filter.contact = contactId;
    if (channel && channel !== 'all') filter.channel = channel;

    let query = Conversation.find(filter)
      .populate('contact', 'name email phone status source properties')
      .populate('assignedTo', 'firstName lastName email');

    const sortField = sort === 'createdAt' ? { createdAt: -1 } : { updatedAt: -1 };
    query = query.sort(sortField);

    if (search) {
      const contactIds = await Contact.find({
        $or: [
          { name: { $regex: search, $options: 'i' } },
          { email: { $regex: search, $options: 'i' } },
        ]
      }).distinct('_id');
      filter.contact = { $in: contactIds };
      query = Conversation.find(filter)
        .populate('contact', 'name email phone status source properties')
        .populate('assignedTo', 'firstName lastName email')
        .sort(sortField);
    }

    const conversations = await query
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
    const { modifiedContent, emailContent, whatsappContent, emailSubject } = req.body;
    const conversation = await Conversation.findById(req.params.id);
    if (!conversation) return res.status(404).json({ success: false, error: 'Non trovata' });

    const lastAgent = conversation.messages
      .filter(m => m.role === 'agent' && !m.metadata?.wasAutoSent)
      .pop();
    const agentDraft = lastAgent?.content || '';
    const agentWaDraft = lastAgent?.metadata?.whatsappDraft || conversation.context?.whatsappDraft || '';

    const result = await approveAndSend(req.params.id, { emailContent, whatsappContent, emailSubject, modifiedContent });

    const emailAction = result.emailModified ? 'modified' : 'approved';
    const waAction = result.waModified ? 'modified' : (whatsappContent ? 'approved' : null);

    await AgentFeedback.create({
      conversation: conversation._id,
      contact: conversation.contact,
      agentDraft,
      finalSent: result.finalEmail || agentDraft,
      action: emailAction,
      channel: 'email',
      conversationContext: buildFeedbackContext(conversation),
      reviewedBy: req.user?._id,
      weekNumber: getISOWeek(new Date())
    }).catch(() => {});

    if (waAction && agentWaDraft) {
      await AgentFeedback.create({
        conversation: conversation._id,
        contact: conversation.contact,
        agentDraft: agentWaDraft,
        finalSent: result.finalWhatsapp || agentWaDraft,
        action: waAction,
        channel: 'whatsapp',
        conversationContext: buildFeedbackContext(conversation),
        reviewedBy: req.user?._id,
        weekNumber: getISOWeek(new Date())
      }).catch(() => {});
    }

    const contactDoc = await Contact.findById(conversation.contact).lean().catch(() => null);
    sendFeedbackToAgent({
      conversation,
      contact: contactDoc,
      agentDraft,
      finalSent: result.finalEmail || agentDraft,
      action: emailAction,
      channel: 'email',
      modifications: result.emailModified ? { addedContent: emailContent } : null,
    }).catch(() => {});

    if (waAction && agentWaDraft) {
      sendFeedbackToAgent({
        conversation,
        contact: contactDoc,
        agentDraft: agentWaDraft,
        finalSent: result.finalWhatsapp || agentWaDraft,
        action: waAction,
        channel: 'whatsapp',
        modifications: result.waModified ? { addedContent: whatsappContent } : null,
      }).catch(() => {});
    }

    res.json({ ...result, feedbackAction: emailAction, waFeedbackAction: waAction });
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
    const { discardReason, discardNotes } = req.body;
    const conversation = await Conversation.findById(req.params.id);
    if (!conversation) return res.status(404).json({ success: false, error: 'Non trovata' });

    const agentDraft = conversation.messages
      .filter(m => m.role === 'agent')
      .pop()?.content || '';

    const result = await discardReply(req.params.id);

    await AgentFeedback.create({
      conversation: conversation._id,
      contact: conversation.contact,
      agentDraft,
      action: 'discarded',
      discardReason: discardReason || 'other',
      discardNotes,
      conversationContext: buildFeedbackContext(conversation),
      reviewedBy: req.user?._id,
      weekNumber: getISOWeek(new Date())
    }).catch(() => {});

    const contactDoc = await Contact.findById(conversation.contact).lean().catch(() => null);
    sendFeedbackToAgent({
      conversation,
      contact: contactDoc,
      agentDraft,
      action: 'discarded',
      discardReason: discardReason || 'other',
      discardNotes,
    }).catch(() => {});

    res.json({ ...result, feedbackAction: 'discarded' });
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
    const [active, awaitingHuman, converted, lost, paused, dead, totalConvs] = await Promise.all([
      Conversation.countDocuments({ status: 'active' }),
      Conversation.countDocuments({ status: 'awaiting_human' }),
      Conversation.countDocuments({ outcome: { $in: ['sql', 'call_booked'] } }),
      Conversation.countDocuments({ outcome: 'lost' }),
      Conversation.countDocuments({ status: 'paused' }),
      Conversation.countDocuments({ status: 'dead' }),
      Conversation.countDocuments({}),
    ]);

    const recentOutcomes = await ConversationOutcome.find()
      .sort({ createdAt: -1 })
      .limit(10)
      .populate('contact', 'name email')
      .lean();

    res.json({
      success: true,
      data: { active, awaitingHuman, converted, lost, paused, dead, totalConvs, recentOutcomes }
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

/**
 * GET /api/agent/feedback-stats
 * Statistiche feedback umano per monitorare il miglioramento dell'agente
 */
router.get('/feedback-stats', async (req, res) => {
  try {
    const { weeks = 4 } = req.query;
    const startDate = new Date(Date.now() - parseInt(weeks) * 7 * 24 * 60 * 60 * 1000);

    const feedbacks = await AgentFeedback.find({ createdAt: { $gte: startDate } })
      .sort({ createdAt: -1 })
      .lean();

    const total = feedbacks.length;
    const approved = feedbacks.filter(f => f.action === 'approved').length;
    const modified = feedbacks.filter(f => f.action === 'modified').length;
    const discarded = feedbacks.filter(f => f.action === 'discarded').length;

    const byWeek = {};
    for (const f of feedbacks) {
      const wk = f.weekNumber || 0;
      if (!byWeek[wk]) byWeek[wk] = { approved: 0, modified: 0, discarded: 0, total: 0 };
      byWeek[wk][f.action]++;
      byWeek[wk].total++;
    }
    for (const wk of Object.keys(byWeek)) {
      byWeek[wk].approvalRate = byWeek[wk].total > 0
        ? ((byWeek[wk].approved / byWeek[wk].total) * 100).toFixed(1)
        : '0';
    }

    const discardReasons = {};
    for (const f of feedbacks.filter(fb => fb.action === 'discarded')) {
      const reason = f.discardReason || 'other';
      discardReasons[reason] = (discardReasons[reason] || 0) + 1;
    }

    const bySource = {};
    for (const f of feedbacks) {
      const src = f.conversationContext?.source || 'unknown';
      if (!bySource[src]) bySource[src] = { approved: 0, modified: 0, discarded: 0, total: 0 };
      bySource[src][f.action]++;
      bySource[src].total++;
    }

    res.json({
      success: true,
      data: {
        total, approved, modified, discarded,
        approvalRate: total > 0 ? ((approved / total) * 100).toFixed(1) : '0',
        byWeek,
        bySource,
        discardReasons
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
