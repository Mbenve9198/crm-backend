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
  planner_marked_terminal: { type: 'terminal_detected', icon: 'x-circle', desc: 'Planner: contatto terminale' },
  contact_marked_terminal: { type: 'terminal_detected', icon: 'x-circle', desc: 'Contatto terminale' },
  sales_manager_briefing: { type: 'sales_manager_briefing', icon: 'briefcase', desc: 'Briefing Sales Manager' },
  sales_manager_alert: { type: 'alert', icon: 'alert-triangle', desc: 'Alert Sales Manager' },
  sales_manager_cycle_start: { type: 'sales_manager', icon: 'briefcase', desc: 'Sales Manager: ciclo avviato' },
  sales_manager_cycle_complete: { type: 'sales_manager', icon: 'briefcase', desc: 'Sales Manager: ciclo completato' },
  sales_manager_cycle_error: { type: 'alert', icon: 'alert-triangle', desc: 'Sales Manager: errore ciclo' },
  sales_manager_directives_saved: { type: 'sales_manager', icon: 'brain', desc: 'Sales Manager: direttive salvate' },
  callback_booked: { type: 'callback', icon: 'phone', desc: 'Callback prenotata' },
  tasks_cancelled: { type: 'tasks_cancelled', icon: 'trash', desc: 'Task cancellati' },
  tools_used: { type: 'tool_usage', icon: 'activity', desc: 'Tool utilizzati' },
  tool_call: { type: 'tool_usage', icon: 'activity', desc: 'Tool eseguito' },
  agent_service_call: { type: 'api_call', icon: 'send', desc: 'Chiamata Agent API' },
  agent_service_error: { type: 'error', icon: 'alert-triangle', desc: 'Errore Agent API' },
  agent_loop_error: { type: 'error', icon: 'alert-triangle', desc: 'Errore nel loop agente' },
  agent_loop_circuit_breaker: { type: 'warning', icon: 'alert-triangle', desc: 'Circuit breaker attivato' },
  agent_memory_feedback_sent: { type: 'feedback', icon: 'brain', desc: 'Feedback inviato alla memoria' },
  agent_memory_feedback_failed: { type: 'warning', icon: 'alert-triangle', desc: 'Feedback memoria fallito' },
  stuck_tasks_recovered: { type: 'maintenance', icon: 'activity', desc: 'Task bloccati recuperati' },
  task_processor_error: { type: 'error', icon: 'alert-triangle', desc: 'Errore processamento task' },
  task_skipped_terminal: { type: 'skip', icon: 'x-circle', desc: 'Task saltato: contatto terminale' },
  direct_handoff: { type: 'handoff', icon: 'phone', desc: 'Handoff diretto al team' },
  approve_whatsapp_sent: { type: 'whatsapp', icon: 'send', desc: 'WhatsApp inviato (approvato)' },
  approve_whatsapp_failed: { type: 'error', icon: 'alert-triangle', desc: 'WhatsApp invio fallito' },
  conversation_locked: { type: 'skip', icon: 'loader', desc: 'Conversazione in lavorazione' },
  invalid_stage_transition: { type: 'warning', icon: 'alert-triangle', desc: 'Transizione stage non valida' },
  planner_call_failed: { type: 'error', icon: 'alert-triangle', desc: 'Planner: chiamata fallita' },
  crm_enrichment_error: { type: 'warning', icon: 'alert-triangle', desc: 'Errore arricchimento CRM' },
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

    const NOISY_EVENTS = ['agent_service_call', 'tool_call', 'crm_enrichment_error', 'agent_memory_feedback_sent', 'agent_memory_feedback_failed'];
    if (!req.query.verbose) {
      filter.event = { ...(filter.event || {}), $nin: NOISY_EVENTS };
    }

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

    const bySourceAgg = await Conversation.aggregate([
      { $match: { createdAt: { $gte: since } } },
      { $group: {
        _id: '$context.leadSource',
        contacted: { $sum: 1 },
        responded: { $sum: { $cond: [{ $gt: [{ $size: { $filter: { input: '$messages', as: 'm', cond: { $eq: ['$$m.role', 'lead'] } } } }, 0] }, 1, 0] } },
        converted: { $sum: { $cond: [{ $in: ['$outcome', ['sql', 'call_booked', 'converted']] }, 1, 0] } },
      }},
      { $sort: { contacted: -1 } },
    ]);
    const bySource = {};
    for (const s of bySourceAgg) {
      bySource[s._id || 'unknown'] = { contacted: s.contacted, responded: s.responded, converted: s.converted };
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

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GROUPED ACTIVITY STREAM + DRILL-DOWN ENDPOINTS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const DRAFT_EVENTS = new Set([
  'agent_loop_start', 'tools_used', 'agent_service_response', 'draft_saved',
  'agent_service_call', 'tool_call',
]);
const SM_EVENTS = new Set([
  'sales_manager_cycle_start', 'sales_manager_cycle_complete', 'sales_manager_cycle_error',
  'sales_manager_briefing', 'sales_manager_alert', 'sales_manager_directives_saved',
]);
const ERROR_EVENTS = new Set([
  'agent_service_error', 'agent_loop_error', 'agent_loop_circuit_breaker',
  'task_processor_error', 'planner_call_failed',
]);

router.get('/activity-stream', async (req, res) => {
  try {
    const { limit = 20, since } = req.query;
    const filter = {};
    if (since) filter.createdAt = { $gt: new Date(since) };

    const logs = await AgentLog.find(filter)
      .sort({ createdAt: -1 })
      .limit(200)
      .lean();

    const cards = [];
    const used = new Set();

    for (let i = 0; i < logs.length; i++) {
      if (used.has(i)) continue;
      const log = logs[i];

      if (SM_EVENTS.has(log.event)) {
        const group = [log];
        used.add(i);
        const windowEnd = new Date(log.createdAt.getTime() + 5 * 60 * 1000);
        const windowStart = new Date(log.createdAt.getTime() - 5 * 60 * 1000);
        for (let j = i + 1; j < logs.length; j++) {
          if (used.has(j)) continue;
          if (SM_EVENTS.has(logs[j].event) && logs[j].createdAt >= windowStart && logs[j].createdAt <= windowEnd) {
            group.push(logs[j]);
            used.add(j);
          }
        }
        const complete = group.find(g => g.event === 'sales_manager_cycle_complete');
        const briefing = group.find(g => g.event === 'sales_manager_briefing');
        const alerts = group.filter(g => g.event === 'sales_manager_alert');
        const directives = group.find(g => g.event === 'sales_manager_directives_saved');
        cards.push({
          type: 'sales_manager',
          timestamp: log.createdAt,
          narrative: `Sales Manager ha completato l'analisi giornaliera${directives ? ` — ${directives.data?.count || 0} direttive` : ''}${alerts.length > 0 ? `, ${alerts.length} alert` : ''}`,
          costUsd: complete?.data?.costUsd || null,
          toolCalls: complete?.data?.toolCallsMade || null,
          briefingHeadline: briefing?.data?.headline || null,
          alerts: alerts.map(a => ({ severity: a.data?.severity, message: a.data?.message })),
          events: group.length,
        });
        continue;
      }

      if (log.conversationId && DRAFT_EVENTS.has(log.event)) {
        const group = [log];
        used.add(i);
        const windowEnd = new Date(log.createdAt.getTime() + 5 * 60 * 1000);
        const windowStart = new Date(log.createdAt.getTime() - 5 * 60 * 1000);
        for (let j = i + 1; j < logs.length; j++) {
          if (used.has(j)) continue;
          const other = logs[j];
          if (
            DRAFT_EVENTS.has(other.event) &&
            String(other.conversationId) === String(log.conversationId) &&
            other.createdAt >= windowStart && other.createdAt <= windowEnd
          ) {
            group.push(other);
            used.add(j);
          }
        }

        const draftEvt = group.find(g => g.event === 'draft_saved' || g.event === 'agent_service_response');
        const loopStart = group.find(g => g.event === 'agent_loop_start');
        const toolEvt = group.find(g => g.event === 'tools_used');
        const data = draftEvt?.data || loopStart?.data || {};
        const contactName = data.contactName || data.name || log.contactEmail || '';
        const channel = data.channel || '';
        const costUsd = group.reduce((sum, g) => sum + (g.data?.costUsd || 0), 0);

        let narrative = `Ha analizzato **${contactName || 'lead'}**`;
        if (toolEvt?.data?.tools) narrative += ` (${toolEvt.data.tools})`;
        if (channel) narrative += `, preparato bozza **${channel}**`;
        if (draftEvt?.event === 'draft_saved') narrative += ' — In attesa review';

        let draftPreview = null;
        if (log.conversationId) {
          try {
            const conv = await Conversation.findById(log.conversationId).lean();
            const lastDraft = conv?.messages?.filter(m => m.metadata?.isDraft).pop();
            if (lastDraft) draftPreview = lastDraft.content?.substring(0, 200);
          } catch { /* non-blocking */ }
        }

        cards.push({
          type: 'draft',
          timestamp: log.createdAt,
          conversationId: log.conversationId,
          contactName,
          contactEmail: log.contactEmail || data.email || '',
          channel,
          costUsd: costUsd > 0 ? parseFloat(costUsd.toFixed(4)) : null,
          narrative,
          draftPreview,
          strategyTag: data.strategyTag || null,
          toolsUsed: toolEvt?.data?.tools || null,
          events: group.length,
        });
        continue;
      }

      if (ERROR_EVENTS.has(log.event)) {
        used.add(i);
        const mapping = EVENT_TYPE_MAP[log.event] || { desc: log.event };
        cards.push({
          type: 'error',
          timestamp: log.createdAt,
          narrative: mapping.desc,
          contactEmail: log.contactEmail || '',
          conversationId: log.conversationId || null,
          error: typeof log.data === 'string' ? log.data.substring(0, 200) : (log.data?.error || log.data?.message || ''),
          events: 1,
        });
        continue;
      }

      used.add(i);
      const mapping = EVENT_TYPE_MAP[log.event] || { type: log.event, icon: 'activity', desc: log.event };
      const data = log.data || {};
      cards.push({
        type: mapping.type || 'event',
        timestamp: log.createdAt,
        conversationId: log.conversationId || null,
        contactName: data.contactName || data.name || log.contactEmail || '',
        contactEmail: log.contactEmail || data.email || '',
        narrative: mapping.desc,
        channel: data.channel || null,
        costUsd: data.costUsd || null,
        events: 1,
      });
    }

    res.json({ success: true, cards: cards.slice(0, parseInt(limit)) });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/conversations/:id/peek', async (req, res) => {
  try {
    const conv = await Conversation.findById(req.params.id)
      .populate('contact', 'name email phone source status')
      .lean();

    if (!conv) return res.status(404).json({ success: false, error: 'Not found' });

    const lastMessages = (conv.messages || []).slice(-4).map(m => ({
      role: m.role,
      content: m.content?.substring(0, 300),
      channel: m.channel,
      isDraft: m.metadata?.isDraft || false,
      createdAt: m.createdAt,
    }));

    const lastDraft = (conv.messages || []).filter(m => m.metadata?.isDraft).pop();
    const lastWaDraft = (conv.messages || []).filter(m => m.metadata?.whatsappDraft).pop();

    res.json({
      success: true,
      data: {
        id: conv._id,
        contact: conv.contact ? {
          id: conv.contact._id,
          name: conv.contact.name,
          email: conv.contact.email,
          phone: conv.contact.phone,
          source: conv.contact.source,
          status: conv.contact.status,
        } : null,
        stage: conv.stage,
        status: conv.status,
        channel: conv.channelState?.currentChannel || conv.channel,
        strategyTag: conv.context?.strategyTag,
        lastMessages,
        emailDraft: lastDraft ? lastDraft.content?.substring(0, 500) : null,
        whatsappDraft: lastWaDraft?.metadata?.whatsappDraft?.substring(0, 500) || null,
        messageCount: conv.messages?.length || 0,
        updatedAt: conv.updatedAt,
        reviewUrl: `/agent/review?id=${conv._id}`,
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/conversations-by-filter', async (req, res) => {
  try {
    const { source, status, hasLeadReply, feedbackAction, period = '30d', limit = 30 } = req.query;
    const periodDays = { '1d': 1, '7d': 7, '30d': 30, 'today': 1, 'week': 7, 'month': 30 };
    const since = new Date(Date.now() - (periodDays[period] || 7) * 24 * 60 * 60 * 1000);

    if (feedbackAction) {
      const feedbacks = await AgentFeedback.find({
        action: feedbackAction,
        createdAt: { $gte: since },
      })
        .populate({ path: 'conversation', populate: { path: 'contact', select: 'name email source' } })
        .sort({ createdAt: -1 })
        .limit(parseInt(limit))
        .lean();

      const results = feedbacks
        .filter(f => f.conversation)
        .map(f => ({
          id: f.conversation._id,
          contactName: f.conversation.contact?.name,
          contactEmail: f.conversation.contact?.email,
          stage: f.conversation.stage,
          status: f.conversation.status,
          lastMessagePreview: f.conversation.messages?.slice(-1)[0]?.content?.substring(0, 150),
          updatedAt: f.conversation.updatedAt,
        }));

      return res.json({ success: true, data: results, total: results.length });
    }

    const filter = { updatedAt: { $gte: since } };
    if (source) filter['context.leadSource'] = source;
    if (status) filter.status = status;

    let convs = await Conversation.find(filter)
      .populate('contact', 'name email source')
      .sort({ updatedAt: -1 })
      .limit(parseInt(limit))
      .lean();

    if (hasLeadReply === 'true') {
      convs = convs.filter(c => c.messages?.some(m => m.role === 'lead'));
    }

    const results = convs.map(c => ({
      id: c._id,
      contactName: c.contact?.name,
      contactEmail: c.contact?.email,
      stage: c.stage,
      status: c.status,
      source: c.context?.leadSource,
      lastMessagePreview: c.messages?.slice(-1)[0]?.content?.substring(0, 150),
      updatedAt: c.updatedAt,
    }));

    res.json({ success: true, data: results, total: results.length });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
