import express from 'express';
import mongoose from 'mongoose';
import ResearchCache from '../models/researchCacheModel.js';
import SalesManagerDirective from '../models/salesManagerDirectiveModel.js';
import Conversation from '../models/conversationModel.js';
import Contact from '../models/contactModel.js';
import AgentMetric from '../models/agentMetricModel.js';
import AgentLog from '../models/agentLogModel.js';
import AgentFeedback from '../models/agentFeedbackModel.js';
import AgentTask from '../models/agentTaskModel.js';
import ConversationOutcome from '../models/conversationOutcomeModel.js';
import Call from '../models/callModel.js';
import Activity from '../models/activityModel.js';
import { sendOutboundReplyNotification, sendOutboundAgentReplyNotification } from '../services/emailNotificationService.js';
import { resolveOwnerForSource } from '../services/assignmentService.js';

const router = express.Router();

function periodToDate(period) {
  const map = { '1d': 1, '7d': 7, '30d': 30 };
  const days = map[period] || 1;
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

/**
 * GET /api/internal/research-cache/:email
 * Returns valid (non-expired) cache for a contact, or 404.
 */
router.get('/research-cache/:email', async (req, res) => {
  try {
    const cache = await ResearchCache.findOne({
      contactEmail: req.params.email,
      expiresAt: { $gt: new Date() },
    }).lean();

    if (!cache) return res.status(404).json({ found: false });
    res.json({ found: true, data: cache });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/internal/research-cache
 * Upsert research cache for a contact.
 */
router.post('/research-cache', async (req, res) => {
  try {
    const { contactEmail, contactId, businessData, rankingData, reviewsData, similarClients, ttlHours } = req.body;
    if (!contactEmail) return res.status(400).json({ error: 'contactEmail required' });

    const now = new Date();
    const expiresAt = new Date(now.getTime() + (ttlHours || 24) * 60 * 60 * 1000);

    const cache = await ResearchCache.findOneAndUpdate(
      { contactEmail },
      {
        contactEmail,
        contactId: contactId || undefined,
        businessData: businessData || undefined,
        rankingData: rankingData || undefined,
        reviewsData: reviewsData || undefined,
        similarClients: similarClients || undefined,
        fetchedAt: now,
        expiresAt,
      },
      { upsert: true, new: true }
    );

    res.json({ success: true, id: cache._id });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/internal/directives
 * Returns active (non-expired) Sales Manager directives.
 */
router.get('/directives', async (req, res) => {
  try {
    const scope = req.query.scope;
    const filter = {
      isActive: true,
      $or: [{ expiresAt: { $gt: new Date() } }, { expiresAt: null }],
    };
    if (scope) filter.scope = { $in: [scope, 'all'] };

    const directives = await SalesManagerDirective.find(filter)
      .sort({ priority: 1, createdAt: -1 })
      .limit(10)
      .lean();

    res.json({ directives });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ─── Sales Manager Tool Endpoints ───

router.get('/sm/overview', async (req, res) => {
  try {
    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const [
      convByStatus, convByStage, convBySource,
      costAgg, errorCount, taskStats,
      feedbackAgg, callCount,
    ] = await Promise.all([
      Conversation.aggregate([
        { $match: { status: { $in: ['active', 'awaiting_human', 'paused', 'escalated'] } } },
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ]),
      Conversation.aggregate([
        { $match: { status: { $in: ['active', 'awaiting_human'] } } },
        { $group: { _id: '$stage', count: { $sum: 1 } } },
      ]),
      Conversation.aggregate([
        { $match: { status: { $in: ['active', 'awaiting_human', 'paused'] } } },
        { $group: { _id: '$context.leadSource', count: { $sum: 1 } } },
      ]),
      AgentMetric.aggregate([
        { $match: { createdAt: { $gte: since24h }, event: 'llm_call' } },
        { $group: { _id: null, totalCost: { $sum: '$data.costUsd' }, totalCalls: { $sum: 1 } } },
      ]),
      AgentLog.countDocuments({ level: 'error', createdAt: { $gte: since24h } }),
      AgentTask.aggregate([
        { $match: { updatedAt: { $gte: since24h } } },
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ]),
      AgentFeedback.aggregate([
        { $match: { createdAt: { $gte: since24h } } },
        { $group: { _id: '$action', count: { $sum: 1 } } },
      ]),
      Call.countDocuments({ status: 'completed', createdAt: { $gte: since24h } }),
    ]);

    const feedbackMap = Object.fromEntries(feedbackAgg.map(f => [f._id, f.count]));
    const totalFb = (feedbackMap.approved || 0) + (feedbackMap.modified || 0) + (feedbackMap.discarded || 0);

    res.json({
      conversations: {
        byStatus: Object.fromEntries(convByStatus.map(s => [s._id, s.count])),
        byStage: Object.fromEntries(convByStage.map(s => [s._id, s.count])),
        bySource: Object.fromEntries(convBySource.map(s => [s._id || 'unknown', s.count])),
      },
      costs: costAgg[0] || { totalCost: 0, totalCalls: 0 },
      errors24h: errorCount,
      tasks: Object.fromEntries(taskStats.map(t => [t._id, t.count])),
      feedback: { ...feedbackMap, total: totalFb, approvalRate: totalFb > 0 ? ((feedbackMap.approved || 0) / totalFb).toFixed(2) : null },
      callsCompleted24h: callCount,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/sm/conversations', async (req, res) => {
  try {
    const { source, status, stage, period, hasLeadReply, minMessages, limit } = req.query;
    const filter = {};

    if (source) filter['context.leadSource'] = source;
    if (status) filter.status = status;
    if (stage) filter.stage = stage;
    if (period) filter.updatedAt = { $gte: periodToDate(period) };
    if (hasLeadReply === 'true') filter['messages'] = { $elemMatch: { role: 'lead' } };
    if (minMessages) filter.$expr = { $gte: [{ $size: '$messages' }, parseInt(minMessages)] };

    const convs = await Conversation.find(filter)
      .populate('contact', 'name email source')
      .sort({ updatedAt: -1 })
      .limit(parseInt(limit) || 20)
      .lean();

    res.json({
      conversations: convs.map(c => ({
        id: c._id,
        contactName: c.contact?.name,
        contactEmail: c.contact?.email,
        source: c.context?.leadSource,
        stage: c.stage,
        status: c.status,
        channel: c.channelState?.currentChannel || c.channel,
        messageCount: c.messages?.length || 0,
        leadMessages: c.messages?.filter(m => m.role === 'lead').length || 0,
        lastMessagePreview: c.messages?.slice(-1)[0]?.content?.substring(0, 250),
        lastMessageRole: c.messages?.slice(-1)[0]?.role,
        strategyTag: c.context?.strategyTag,
        objections: c.context?.objections,
        updatedAt: c.updatedAt,
      })),
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/sm/conversation/:id', async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ error: 'Invalid conversation ID' });
    }

    const conv = await Conversation.findById(req.params.id)
      .populate('contact', 'name email phone source status rankCheckerData properties')
      .lean();

    if (!conv) return res.status(404).json({ error: 'Conversation not found' });

    const feedbacks = await AgentFeedback.find({ conversation: conv._id })
      .sort({ createdAt: -1 })
      .limit(10)
      .lean();

    res.json({
      id: conv._id,
      contact: {
        name: conv.contact?.name,
        email: conv.contact?.email,
        phone: conv.contact?.phone,
        source: conv.contact?.source,
        status: conv.contact?.status,
      },
      stage: conv.stage,
      status: conv.status,
      channel: conv.channelState?.currentChannel || conv.channel,
      channelState: conv.channelState,
      context: {
        leadSource: conv.context?.leadSource,
        objections: conv.context?.objections,
        painPoints: conv.context?.painPoints,
        restaurantData: conv.context?.restaurantData,
        conversationSummary: conv.context?.conversationSummary,
        strategyTag: conv.context?.strategyTag,
      },
      messages: conv.messages?.map(m => ({
        role: m.role,
        content: m.content,
        channel: m.channel,
        isDraft: m.metadata?.isDraft,
        whatsappDraft: m.metadata?.whatsappDraft,
        createdAt: m.createdAt,
      })),
      metrics: conv.metrics,
      feedbackHistory: feedbacks.map(f => ({
        action: f.action,
        channel: f.channel,
        modifications: f.modifications,
        discardReason: f.discardReason,
        agentDraftPreview: f.agentDraft?.substring(0, 200),
        createdAt: f.createdAt,
      })),
      updatedAt: conv.updatedAt,
      createdAt: conv.createdAt,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/sm/calls', async (req, res) => {
  try {
    const { period, outcome, minDuration, hasAnalysis, limit } = req.query;
    const filter = { status: 'completed' };

    if (period) filter.createdAt = { $gte: periodToDate(period) };
    if (outcome) filter.outcome = outcome;
    if (minDuration) filter.duration = { $gte: parseInt(minDuration) };
    if (hasAnalysis === 'true') filter.callAnalysis = { $exists: true, $ne: null };

    const calls = await Call.find(filter)
      .populate('contact', 'name email source')
      .populate('initiatedBy', 'firstName lastName')
      .sort({ createdAt: -1 })
      .limit(parseInt(limit) || 10)
      .lean();

    const totalCalls = await Call.countDocuments({ status: 'completed', createdAt: filter.createdAt || {} });
    const outcomeAgg = await Call.aggregate([
      { $match: { status: 'completed', ...(period ? { createdAt: { $gte: periodToDate(period) } } : {}) } },
      { $group: { _id: '$outcome', count: { $sum: 1 } } },
    ]);

    res.json({
      calls: calls.map(c => ({
        id: c._id,
        contactName: c.contact?.name,
        contactEmail: c.contact?.email,
        contactSource: c.contact?.source,
        agentName: c.initiatedBy ? `${c.initiatedBy.firstName} ${c.initiatedBy.lastName || ''}`.trim() : null,
        duration: c.duration,
        outcome: c.outcome,
        callAnalysis: c.callAnalysis || null,
        rating: c.rating,
        flag: c.flag,
        transcript: c.transcript ? c.transcript.substring(0, 3000) : null,
        createdAt: c.createdAt,
      })),
      stats: {
        totalCalls,
        byOutcome: Object.fromEntries(outcomeAgg.map(o => [o._id || 'no_outcome', o.count])),
        avgDuration: calls.length > 0 ? Math.round(calls.reduce((s, c) => s + (c.duration || 0), 0) / calls.length) : 0,
      },
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/sm/feedback', async (req, res) => {
  try {
    const { action, period, limit } = req.query;
    const filter = {};

    if (action) filter.action = action;
    if (period) filter.createdAt = { $gte: periodToDate(period) };

    const feedbacks = await AgentFeedback.find(filter)
      .populate({ path: 'conversation', select: 'stage context.leadSource context.strategyTag' })
      .populate('contact', 'name email source')
      .sort({ createdAt: -1 })
      .limit(parseInt(limit) || 20)
      .lean();

    const actionAgg = await AgentFeedback.aggregate([
      { $match: period ? { createdAt: { $gte: periodToDate(period) } } : {} },
      { $group: { _id: '$action', count: { $sum: 1 } } },
    ]);
    const discardReasonAgg = await AgentFeedback.aggregate([
      { $match: { action: 'discarded', ...(period ? { createdAt: { $gte: periodToDate(period) } } : {}) } },
      { $group: { _id: '$discardReason', count: { $sum: 1 } } },
    ]);

    res.json({
      feedbacks: feedbacks.map(f => ({
        action: f.action,
        channel: f.channel,
        contactName: f.contact?.name,
        contactEmail: f.contact?.email,
        contactSource: f.contact?.source,
        conversationStage: f.conversation?.stage,
        leadSource: f.conversation?.context?.leadSource,
        strategyTag: f.conversation?.context?.strategyTag,
        agentDraftPreview: f.agentDraft?.substring(0, 300),
        finalSentPreview: f.finalSent?.substring(0, 300),
        modifications: f.modifications,
        discardReason: f.discardReason,
        discardNotes: f.discardNotes,
        createdAt: f.createdAt,
      })),
      stats: {
        byAction: Object.fromEntries(actionAgg.map(a => [a._id, a.count])),
        discardReasons: Object.fromEntries(discardReasonAgg.map(d => [d._id || 'unknown', d.count])),
      },
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/sm/lead-timeline/:email', async (req, res) => {
  try {
    const contact = await Contact.findOne({ email: req.params.email }).lean();
    if (!contact) return res.status(404).json({ error: 'Contact not found' });

    const [conversations, calls, feedbacks, tasks] = await Promise.all([
      Conversation.find({ contact: contact._id })
        .sort({ createdAt: -1 })
        .lean(),
      Call.find({ contact: contact._id })
        .populate('initiatedBy', 'firstName lastName')
        .sort({ createdAt: -1 })
        .lean(),
      AgentFeedback.find({ contact: contact._id })
        .sort({ createdAt: -1 })
        .lean(),
      AgentTask.find({ contact: contact._id })
        .sort({ createdAt: -1 })
        .limit(20)
        .lean(),
    ]);

    res.json({
      contact: {
        name: contact.name,
        email: contact.email,
        phone: contact.phone,
        source: contact.source,
        status: contact.status,
        rankCheckerData: contact.rankCheckerData || null,
        createdAt: contact.createdAt,
      },
      conversations: conversations.map(c => ({
        id: c._id,
        stage: c.stage,
        status: c.status,
        channel: c.channelState?.currentChannel || c.channel,
        strategyTag: c.context?.strategyTag,
        objections: c.context?.objections,
        messageCount: c.messages?.length || 0,
        messages: c.messages?.map(m => ({
          role: m.role,
          content: m.content?.substring(0, 500),
          channel: m.channel,
          isDraft: m.metadata?.isDraft,
          createdAt: m.createdAt,
        })),
        createdAt: c.createdAt,
        updatedAt: c.updatedAt,
      })),
      calls: calls.map(c => ({
        duration: c.duration,
        outcome: c.outcome,
        agentName: c.initiatedBy ? `${c.initiatedBy.firstName} ${c.initiatedBy.lastName || ''}`.trim() : null,
        callAnalysis: c.callAnalysis || null,
        rating: c.rating,
        transcriptPreview: c.transcript?.substring(0, 1000),
        createdAt: c.createdAt,
      })),
      feedbacks: feedbacks.map(f => ({
        action: f.action,
        channel: f.channel,
        modifications: f.modifications,
        discardReason: f.discardReason,
        createdAt: f.createdAt,
      })),
      tasks: tasks.map(t => ({
        type: t.type,
        status: t.status,
        scheduledAt: t.scheduledAt,
        result: t.result ? JSON.stringify(t.result).substring(0, 200) : null,
      })),
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/internal/contacts/upsert
 * Crea o aggiorna un contatto da sorgente esterna (es. outbound intelligence agent).
 * No auth richiesta — endpoint interno, non esposto pubblicamente.
 *
 * Body: { email, name, phone?, city?, status?, source?, properties? }
 * Response: { success, contact_id, is_new }
 */
router.post('/contacts/upsert', async (req, res) => {
  // Verifica shared secret
  const secret = process.env.OUTBOUND_AGENT_SECRET;
  if (secret) {
    const provided = req.headers['x-internal-secret'];
    if (provided !== secret) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }

  try {
    const { email, name, phone, city, status, source, properties } = req.body;

    if (!email || !name) {
      return res.status(400).json({ error: 'email e name sono obbligatori' });
    }

    // Trova il default owner
    const User = (await import('../models/userModel.js')).default;
    let owner = null;
    if (process.env.INBOUND_LEAD_DEFAULT_OWNER_EMAIL) {
      owner = await User.findOne({ email: process.env.INBOUND_LEAD_DEFAULT_OWNER_EMAIL.toLowerCase() }).lean();
    }
    if (!owner) {
      owner = await User.findOne({ role: { $in: ['admin', 'manager'] }, isActive: true })
        .sort({ createdAt: 1 }).lean();
    }
    if (!owner) {
      return res.status(500).json({ error: 'Nessun owner disponibile nel CRM' });
    }

    // Upsert contatto per email
    const existingContact = await Contact.findOne({ email: email.toLowerCase().trim() });

    if (existingContact) {
      // Aggiorna campi se forniti
      if (phone && !existingContact.phone) existingContact.phone = phone;
      if (city) existingContact.setProperty('city', city);
      if (status) {
        existingContact.status = status;
      }
      if (properties && typeof properties === 'object') {
        for (const [k, v] of Object.entries(properties)) {
          existingContact.setProperty(k, v);
        }
      }
      existingContact.lastModifiedBy = owner._id;
      await existingContact.save();

      return res.json({
        success: true,
        contact_id: existingContact._id,
        is_new: false,
      });
    }

    // Crea nuovo contatto — usa round robin per assegnare l'owner
    const contactSource = source || 'smartlead_outbound';
    const assignedOwner = await resolveOwnerForSource(contactSource, owner);
    const contactData = {
      email: email.toLowerCase().trim(),
      name: name.trim(),
      owner: assignedOwner?._id ?? null,
      createdBy: assignedOwner?._id ?? owner._id,
      source: contactSource,
      status: status || 'interessato',
      mrr: 0,
      properties: {},
    };
    if (phone) contactData.phone = phone;
    if (city) contactData.properties.city = city;
    if (properties && typeof properties === 'object') {
      Object.assign(contactData.properties, properties);
    }

    const newContact = await Contact.create(contactData);

    return res.status(201).json({
      success: true,
      contact_id: newContact._id,
      is_new: true,
    });

  } catch (error) {
    console.error('❌ POST /api/internal/contacts/upsert:', error.message);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/internal/contacts/:contactId/activities
 * Lista le activity di un contatto (read-only, per diagnostica agente).
 * Auth: X-Internal-Secret
 */
router.get('/contacts/:contactId/activities', async (req, res) => {
  const secret = process.env.OUTBOUND_AGENT_SECRET;
  if (secret) {
    const provided = req.headers['x-internal-secret'];
    if (provided !== secret) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }

  try {
    const { contactId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(contactId)) {
      return res.status(400).json({ error: 'Invalid contactId' });
    }
    const activities = await Activity.find({ contact: contactId })
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();
    return res.json({
      success: true,
      count: activities.length,
      activities: activities.map(a => ({
        _id: a._id,
        type: a.type,
        title: a.title,
        description: a.description,
        data: a.data,
        status: a.status,
        createdAt: a.createdAt,
      })),
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/internal/contacts/by-email/:email
 * Lookup contatto per email (read-only, per diagnostica agente).
 * Auth: X-Internal-Secret
 */
router.get('/contacts/by-email/:email', async (req, res) => {
  const secret = process.env.OUTBOUND_AGENT_SECRET;
  if (secret) {
    const provided = req.headers['x-internal-secret'];
    if (provided !== secret) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }

  try {
    const email = decodeURIComponent(req.params.email).toLowerCase().trim();
    const contact = await Contact.findOne({ email }).lean();
    if (!contact) return res.status(404).json({ found: false });
    return res.json({
      success: true,
      found: true,
      contact: {
        _id: contact._id,
        email: contact.email,
        name: contact.name,
        phone: contact.phone,
        status: contact.status,
        source: contact.source,
        createdAt: contact.createdAt,
        properties: contact.properties,
      },
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/internal/contacts/:contactId/activity
 * Aggiunge un'activity alla timeline di un contatto (es. da outbound agent).
 * Auth: X-Internal-Secret
 *
 * Body: { type, title, description, data? }
 * type: 'ai_agent' | 'email' | 'note' | ecc.
 */
router.post('/contacts/:contactId/activity', async (req, res) => {
  const secret = process.env.OUTBOUND_AGENT_SECRET;
  if (secret) {
    const provided = req.headers['x-internal-secret'];
    if (provided !== secret) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }

  try {
    const { contactId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(contactId)) {
      return res.status(400).json({ error: 'Invalid contactId' });
    }

    const contact = await Contact.findById(contactId).lean();
    if (!contact) return res.status(404).json({ error: 'Contact not found' });

    const User = (await import('../models/userModel.js')).default;
    let systemUser = await User.findOne({ email: process.env.INBOUND_LEAD_DEFAULT_OWNER_EMAIL?.toLowerCase() }).lean();
    if (!systemUser) {
      systemUser = await User.findOne({ role: { $in: ['admin', 'manager'] }, isActive: true }).sort({ createdAt: 1 }).lean();
    }

    const { type = 'ai_agent', title, description, data } = req.body;

    const activity = await Activity.create({
      contact: contactId,
      type,
      title: title || `Agente AI — ${type}`,
      description,
      data,
      createdBy: systemUser?._id,
      status: 'completed',
      priority: 'medium',
    });

    return res.status(201).json({ success: true, activity_id: activity._id });
  } catch (error) {
    console.error('❌ POST /api/internal/contacts/:id/activity:', error.message);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/internal/notify/outbound-reply
 * Notifica interna: reply outbound ricevuta. Auth: X-Internal-Secret.
 * Body: { leadEmail, replyBody, intent, score, interactionId }
 */
router.post('/notify/outbound-reply', async (req, res) => {
  const secret = process.env.OUTBOUND_AGENT_SECRET;
  if (secret && req.headers['x-internal-secret'] !== secret) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const result = await sendOutboundReplyNotification(req.body);
  res.json(result);
});

/**
 * POST /api/internal/notify/outbound-agent-replied
 * Notifica interna: agente ha risposto a un lead. Auth: X-Internal-Secret.
 * Body: { leadEmail, agentReply, intent, interactionId }
 */
router.post('/notify/outbound-agent-replied', async (req, res) => {
  const secret = process.env.OUTBOUND_AGENT_SECRET;
  if (secret && req.headers['x-internal-secret'] !== secret) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const result = await sendOutboundAgentReplyNotification(req.body);
  res.json(result);
});

export default router;
