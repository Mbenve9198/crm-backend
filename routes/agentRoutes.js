import express from 'express';
import Conversation from '../models/conversationModel.js';
import ConversationOutcome from '../models/conversationOutcomeModel.js';
import AgentMetric from '../models/agentMetricModel.js';
import AgentLog from '../models/agentLogModel.js';
import AgentFeedback from '../models/agentFeedbackModel.js';
import SalesManagerDirective from '../models/salesManagerDirectiveModel.js';
import { approveAndSend, discardReply } from '../services/salesAgentService.js';
import { buildFeedbackContext, getISOWeek } from '../services/signedUrlService.js';
import { sendFeedbackToAgent } from '../services/agentServiceClient.js';
import Contact from '../models/contactModel.js';
import { protect } from '../controllers/authController.js';

const router = express.Router();

function _computeModifications(original, final) {
  if (!original || !final || original === final) return null;
  const origLines = new Set(original.split('\n').map(l => l.trim()).filter(Boolean));
  const finalLines = new Set(final.split('\n').map(l => l.trim()).filter(Boolean));

  const added = [...finalLines].filter(l => !origLines.has(l));
  const removed = [...origLines].filter(l => !finalLines.has(l));

  const origLower = original.toLowerCase();
  const finalLower = final.toLowerCase();
  const toneIndicators = ['!', '?', '...'];
  const toneChanged = toneIndicators.some(t =>
    (origLower.split(t).length - 1) !== (finalLower.split(t).length - 1)
  ) || (original.length > 0 && Math.abs(final.length - original.length) / original.length > 0.3);

  return {
    addedContent: added.length > 0 ? added.join('\n') : null,
    removedContent: removed.length > 0 ? removed.join('\n') : null,
    toneChange: toneChanged ? 'Tono modificato dall\'umano' : null,
    structureChange: added.length > 2 || removed.length > 2,
  };
}

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
    const finalEmail = result.finalEmail || agentDraft;

    const emailModifications = _computeModifications(agentDraft, finalEmail);

    const emailFb = await AgentFeedback.create({
      conversation: conversation._id,
      contact: conversation.contact,
      agentDraft,
      finalSent: finalEmail,
      action: emailAction,
      channel: 'email',
      modifications: emailAction === 'modified' ? emailModifications : undefined,
      conversationContext: buildFeedbackContext(conversation),
      reviewedBy: req.user?._id,
      weekNumber: getISOWeek(new Date())
    }).catch(() => null);

    let waFb = null;
    if (waAction && agentWaDraft) {
      const finalWa = result.finalWhatsapp || agentWaDraft;
      const waModifications = _computeModifications(agentWaDraft, finalWa);
      waFb = await AgentFeedback.create({
        conversation: conversation._id,
        contact: conversation.contact,
        agentDraft: agentWaDraft,
        finalSent: finalWa,
        action: waAction,
        channel: 'whatsapp',
        modifications: waAction === 'modified' ? waModifications : undefined,
        conversationContext: buildFeedbackContext(conversation),
        reviewedBy: req.user?._id,
        weekNumber: getISOWeek(new Date())
      }).catch(() => null);
    }

    const contactDoc = await Contact.findById(conversation.contact).lean().catch(() => null);

    sendFeedbackToAgent({
      conversation,
      contact: contactDoc,
      agentDraft,
      finalSent: finalEmail,
      action: emailAction,
      channel: 'email',
      modifications: emailAction === 'modified' ? emailModifications : null,
    }).then(() => {
      if (emailFb) AgentFeedback.findByIdAndUpdate(emailFb._id, { sentToAgent: true }).catch(() => {});
    }).catch(() => {
      if (emailFb) AgentFeedback.findByIdAndUpdate(emailFb._id, { sentToAgent: false }).catch(() => {});
    });

    if (waAction && agentWaDraft) {
      const waModifications = _computeModifications(agentWaDraft, result.finalWhatsapp || agentWaDraft);
      sendFeedbackToAgent({
        conversation,
        contact: contactDoc,
        agentDraft: agentWaDraft,
        finalSent: result.finalWhatsapp || agentWaDraft,
        action: waAction,
        channel: 'whatsapp',
        modifications: waAction === 'modified' ? waModifications : null,
      }).then(() => {
        if (waFb) AgentFeedback.findByIdAndUpdate(waFb._id, { sentToAgent: true }).catch(() => {});
      }).catch(() => {
        if (waFb) AgentFeedback.findByIdAndUpdate(waFb._id, { sentToAgent: false }).catch(() => {});
      });
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

    const fb = await AgentFeedback.create({
      conversation: conversation._id,
      contact: conversation.contact,
      agentDraft,
      action: 'discarded',
      discardReason: discardReason || 'other',
      discardNotes,
      conversationContext: buildFeedbackContext(conversation),
      reviewedBy: req.user?._id,
      weekNumber: getISOWeek(new Date())
    }).catch(() => null);

    const contactDoc = await Contact.findById(conversation.contact).lean().catch(() => null);
    sendFeedbackToAgent({
      conversation,
      contact: contactDoc,
      agentDraft,
      action: 'discarded',
      discardReason: discardReason || 'other',
      discardNotes,
    }).then(() => {
      if (fb) AgentFeedback.findByIdAndUpdate(fb._id, { sentToAgent: true }).catch(() => {});
    }).catch(() => {
      if (fb) AgentFeedback.findByIdAndUpdate(fb._id, { sentToAgent: false }).catch(() => {});
    });

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
    const validStages = ['prospecting', 'initial_reply', 'engaged', 'objection_handling', 'negotiating', 'qualification', 'scheduling', 'handoff', 'won', 'lost', 'dormant', 'terminal'];
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

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// DASHBOARD ENDPOINTS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const EVENT_TYPE_MAP = {
  agent_service_response: { type: 'reactive_draft', icon: 'pencil', desc: 'Bozza generata' },
  draft_saved: { type: 'reactive_draft', icon: 'pencil', desc: 'Bozza salvata per review' },
  proactive_outreach_sent: { type: 'proactive_outreach', icon: 'send', desc: 'Outreach proattivo inviato' },
  agent_loop_start: { type: 'processing', icon: 'loader', desc: 'Analisi in corso' },
  stage_transition: { type: 'stage_change', icon: 'arrow-right', desc: 'Cambio stage' },
  planner_processed: { type: 'planner_decision', icon: 'brain', desc: 'Planner ha deciso' },
  contact_marked_terminal: { type: 'terminal_detected', icon: 'x-circle', desc: 'Contatto terminale' },
  sales_manager_briefing: { type: 'sales_manager_briefing', icon: 'briefcase', desc: 'Briefing Sales Manager' },
  sales_manager_alert: { type: 'alert', icon: 'alert-triangle', desc: 'Alert Sales Manager' },
  callback_booked: { type: 'callback', icon: 'phone', desc: 'Callback prenotata' },
  tasks_cancelled: { type: 'tasks_cancelled', icon: 'trash', desc: 'Task cancellati' },
};

/**
 * GET /api/agent/live-feed
 * Live activity feed for the dashboard (polling every 10s).
 */
router.get('/live-feed', async (req, res) => {
  try {
    const { limit = 30, since } = req.query;
    const filter = {};
    if (since) filter.createdAt = { $gt: new Date(since) };

    const logs = await AgentLog.find(filter)
      .sort({ createdAt: -1 })
      .limit(parseInt(limit))
      .lean();

    const events = logs.map(log => {
      const mapping = EVENT_TYPE_MAP[log.event] || { type: log.event, icon: 'activity', desc: log.event };
      const data = log.data || {};
      return {
        id: log._id,
        timestamp: log.createdAt,
        type: mapping.type,
        icon: mapping.icon,
        contactName: data.contactName || data.name || data.email || log.contactEmail || '',
        contactEmail: log.contactEmail || data.email || '',
        description: mapping.desc,
        details: {
          channel: data.channel,
          stage: data.from && data.to ? `${data.from} → ${data.to}` : data.stage,
          costUsd: data.costUsd,
          action: data.action,
          actions: data.actions,
          confidence: data.confidence,
        },
        conversationId: log.conversationId || data.conversationId || null,
      };
    });

    res.json({ success: true, events });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/agent/dashboard-stats
 * Aggregated dashboard statistics.
 */
router.get('/dashboard-stats', async (req, res) => {
  try {
    const { period = 'today' } = req.query;
    const periodMap = { today: 1, week: 7, month: 30 };
    const days = periodMap[period] || 7;
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const [
      convByStatus,
      convBySource,
      outcomes,
      feedbacks,
      costData,
      activeAlerts,
      latestBriefingLog,
    ] = await Promise.all([
      Conversation.aggregate([
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ]),
      Conversation.aggregate([
        { $group: { _id: '$context.leadSource', count: { $sum: 1 } } },
      ]),
      ConversationOutcome.find({ createdAt: { $gte: since } }).lean(),
      AgentFeedback.find({ createdAt: { $gte: since } }).lean(),
      AgentMetric.aggregate([
        { $match: { createdAt: { $gte: since }, event: 'llm_call' } },
        { $group: {
          _id: null,
          totalCost: { $sum: '$data.costUsd' },
          totalCalls: { $sum: 1 },
        }},
      ]),
      SalesManagerDirective.find({ isActive: true }).lean(),
      AgentLog.findOne({ event: 'sales_manager_briefing' }).sort({ createdAt: -1 }).lean(),
    ]);

    const totalOutcomes = outcomes.length;
    const converted = outcomes.filter(o => ['converted', 'call_booked'].includes(o.outcome)).length;
    const fbTotal = feedbacks.length;
    const fbApproved = feedbacks.filter(f => f.action === 'approved').length;
    const fbModified = feedbacks.filter(f => f.action === 'modified').length;
    const fbDiscarded = feedbacks.filter(f => f.action === 'discarded').length;

    const bySource = {};
    for (const o of outcomes) {
      const src = o.contact?.source || 'unknown';
      if (!bySource[src]) bySource[src] = { contacted: 0, responded: 0, converted: 0, cost: 0 };
      bySource[src].contacted++;
      if (o.humanMessages > 0) bySource[src].responded++;
      if (['converted', 'call_booked'].includes(o.outcome)) bySource[src].converted++;
    }

    res.json({
      success: true,
      data: {
        conversations: Object.fromEntries(convByStatus.map(s => [s._id, s.count])),
        convBySource: Object.fromEntries(convBySource.map(s => [s._id || 'unknown', s.count])),
        outcomes: {
          total: totalOutcomes,
          converted,
          conversionRate: totalOutcomes > 0 ? (converted / totalOutcomes * 100).toFixed(1) : '0',
        },
        feedback: {
          total: fbTotal, approved: fbApproved, modified: fbModified, discarded: fbDiscarded,
          approvalRate: fbTotal > 0 ? (fbApproved / fbTotal * 100).toFixed(1) : '0',
        },
        costs: costData[0] || { totalCost: 0, totalCalls: 0 },
        bySource,
        activeDirectives: activeAlerts.length,
        briefing: latestBriefingLog?.data || null,
        period: { days, since },
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/agent/briefing
 * Latest Sales Manager briefing.
 */
router.get('/briefing', async (req, res) => {
  try {
    const log = await AgentLog.findOne({ event: 'sales_manager_briefing' })
      .sort({ createdAt: -1 })
      .lean();

    if (!log) return res.json({ success: true, data: null });

    res.json({
      success: true,
      data: {
        ...log.data,
        createdAt: log.createdAt,
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/agent/strategy-stats
 * Performance by strategy tag.
 */
router.get('/strategy-stats', async (req, res) => {
  try {
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const convsByTag = await Conversation.aggregate([
      { $match: { 'context.strategyTag': { $exists: true, $ne: null }, updatedAt: { $gte: since } } },
      { $group: {
        _id: '$context.strategyTag',
        total: { $sum: 1 },
        converted: { $sum: { $cond: [{ $in: ['$outcome', ['sql', 'call_booked']] }, 1, 0] } },
        lost: { $sum: { $cond: [{ $eq: ['$outcome', 'lost'] }, 1, 0] } },
      }},
      { $sort: { total: -1 } },
    ]);

    const fbByTag = await AgentFeedback.aggregate([
      { $match: { createdAt: { $gte: since } } },
      { $lookup: { from: 'conversations', localField: 'conversation', foreignField: '_id', as: 'conv' } },
      { $unwind: { path: '$conv', preserveNullAndEmptyArrays: true } },
      { $match: { 'conv.context.strategyTag': { $exists: true } } },
      { $group: {
        _id: '$conv.context.strategyTag',
        approved: { $sum: { $cond: [{ $eq: ['$action', 'approved'] }, 1, 0] } },
        modified: { $sum: { $cond: [{ $eq: ['$action', 'modified'] }, 1, 0] } },
        discarded: { $sum: { $cond: [{ $eq: ['$action', 'discarded'] }, 1, 0] } },
        total: { $sum: 1 },
      }},
    ]);

    const fbMap = Object.fromEntries(fbByTag.map(f => [f._id, f]));

    const strategies = convsByTag.map(s => ({
      tag: s._id,
      used: s.total,
      converted: s.converted,
      lost: s.lost,
      conversionRate: s.total > 0 ? (s.converted / s.total * 100).toFixed(1) : '0',
      feedback: fbMap[s._id] || { approved: 0, modified: 0, discarded: 0, total: 0 },
    }));

    res.json({ success: true, data: strategies });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
