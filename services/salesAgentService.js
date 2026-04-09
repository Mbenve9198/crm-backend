import Anthropic from '@anthropic-ai/sdk';
import Conversation from '../models/conversationModel.js';
import Contact from '../models/contactModel.js';
import AgentTask from '../models/agentTaskModel.js';
import AgentMetric from '../models/agentMetricModel.js';
import Activity from '../models/activityModel.js';
import agentLogger from './agentLogger.js';
import { executeTools } from './agentToolsService.js';
import { callAgentProcess } from './agentServiceClient.js';
import { sendAgentActivityReport } from './emailNotificationService.js';
import { sendProactiveWhatsApp } from './agentWhatsAppService.js';
import redisManager from '../config/redis.js';
import { applyChannelPolicyToAgentResponse } from './channelPolicyService.js';

async function logAgentActivity(contactId, { type, title, description, data, createdBy }) {
  try {
    await Activity.create({
      contact: contactId,
      type: type || 'ai_agent',
      title: (title || '').substring(0, 200),
      description: (description || '').substring(0, 2000),
      data: {
        kind: 'ai_agent',
        origin: 'system',
        meta: data || {}
      },
      createdBy
    });
  } catch (err) {
    console.error('⚠️ logAgentActivity failed:', err.message, { contactId, type, title });
  }
}

const LOCK_TIMEOUT_MS = 5 * 60 * 1000;
const conversationLocksInMemory = new Map();

const acquireLock = async (contactId) => {
  const key = `agent_lock:${contactId.toString()}`;

  if (redisManager.isAvailable()) {
    try {
      const result = await redisManager.getClient().set(key, Date.now(), 'PX', LOCK_TIMEOUT_MS, 'NX');
      return result === 'OK';
    } catch {
      // fallback in-memory
    }
  }

  const now = Date.now();
  const existing = conversationLocksInMemory.get(key);
  if (existing && now - existing < LOCK_TIMEOUT_MS) {
    return false;
  }
  conversationLocksInMemory.set(key, now);
  return true;
};

const releaseLock = async (contactId) => {
  const key = `agent_lock:${contactId.toString()}`;

  if (redisManager.isAvailable()) {
    try {
      await redisManager.getClient().del(key);
      return;
    } catch {
      // fallback in-memory
    }
  }

  conversationLocksInMemory.delete(key);
};

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// IDENTITY
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const IDENTITIES = {
  marco: { name: 'Marco', surname: 'Benvenuti', role: 'co-founder' },
  federico: { name: 'Federico', surname: 'Desantis', role: 'partner' }
};

export const resolveIdentity = (fromEmail) => {
  if (!fromEmail) return IDENTITIES.marco;
  return fromEmail.toLowerCase().includes('federico') ? IDENTITIES.federico : IDENTITIES.marco;
};

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// POST-LOOP: estrazione insight e progressione stage
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const updateConversationInsights = async (conversation, leadMessage, agentResponse) => {
  const agentInsights = agentResponse?.extracted_insights || {};

  const allObjections = agentInsights.objections || [];
  const allPainPoints = agentInsights.pain_points || [];

  let changed = false;

  if (allObjections.length > 0) {
    if (!conversation.context.objections) conversation.context.objections = [];
    for (const obj of allObjections) {
      if (!conversation.context.objections.includes(obj)) {
        conversation.context.objections.push(obj);
        changed = true;
      }
    }
  }

  if (allPainPoints.length > 0) {
    if (!conversation.context.painPoints) conversation.context.painPoints = [];
    for (const pp of allPainPoints) {
      if (!conversation.context.painPoints.includes(pp)) {
        conversation.context.painPoints.push(pp);
        changed = true;
      }
    }
  }

  if (agentResponse?.new_stage && agentResponse.new_stage !== conversation.stage) {
    if (_isValidStageTransition(conversation.stage, agentResponse.new_stage)) {
      const oldStage = conversation.stage;
      conversation.stage = agentResponse.new_stage;
      changed = true;
      agentLogger.info('stage_transition', {
        conversationId: conversation._id,
        data: { from: oldStage, to: agentResponse.new_stage }
      });
    } else {
      agentLogger.warn('invalid_stage_transition', {
        conversationId: conversation._id,
        data: { from: conversation.stage, to: agentResponse.new_stage }
      });
    }
  }

  const msgCount = conversation.messages?.length || 0;
  if (msgCount > 8 && (!conversation.context.conversationSummary || msgCount % 4 === 0)) {
    try {
      const summaryClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
      const allMsgs = conversation.messages.map(m =>
        `[${m.role.toUpperCase()}]: ${m.content?.substring(0, 300)}`
      ).join('\n');

      const summaryResponse = await summaryClient.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 400,
        messages: [{ role: 'user', content: `Riassumi in max 200 parole questa conversazione di vendita tra un agente MenuChat e un ristoratore. Includi: chi è il lead, cosa ha detto, quali obiezioni ha fatto, quali pain point ha espresso, a che punto siamo. Rispondi in italiano.\n\n${allMsgs}` }]
      });

      conversation.context.conversationSummary = summaryResponse.content[0].text;
      changed = true;
    } catch {
      // non bloccante
    }
  }

  if (changed) {
    conversation.markModified('context');
    await conversation.save();
  }
};

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ROUTING
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export const routeLeadReply = (category, confidence, extracted, replyText) => {
  if (category === 'DO_NOT_CONTACT') return { action: 'stop', reason: 'DNC' };
  if (category === 'OUT_OF_OFFICE') return { action: 'resume_sequence', reason: 'OOO' };

  const hasPhoneInBody = extracted?.phone && extracted?.preferredChannel !== 'email';
  const wantsCall = /chiama|call|sentir|telefon|videochiamata/i.test(replyText || '');

  if (category === 'INTERESTED' && confidence >= 0.9 && (hasPhoneInBody || wantsCall)) {
    return { action: 'direct_handoff', reason: 'Lead caldo con telefono/richiesta chiamata' };
  }

  if (category === 'INTERESTED') return { action: 'agent' };
  if (category === 'NEUTRAL') return { action: 'agent' };
  if (category === 'NOT_INTERESTED' && confidence < 0.85) return { action: 'agent' };
  if (category === 'NOT_INTERESTED') return { action: 'track_lost', reason: 'Rifiuto esplicito' };

  return { action: 'agent' };
};

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// PYTHON AGENT SERVICE CALL
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const VALID_TASK_TYPES = new Set([
  'rank_checker_outreach', 'follow_up_no_reply', 'follow_up_scheduled',
  'break_up_email', 'seasonal_reactivation', 'reactivation',
  'reactivation_warm', 'reactivation_cold', 'human_task',
]);
const TASK_TYPE_ALIASES = {
  'business_closed': 'human_task', 'find_alternative_contact': 'human_task',
  'closure_response': 'human_task', 'schedule_call': 'human_task',
  'follow_up': 'follow_up_no_reply', 'followup': 'follow_up_no_reply',
  'reactivation_seasonal': 'seasonal_reactivation',
  'break_up': 'break_up_email', 'breakup': 'break_up_email', 'breakup_email': 'break_up_email',
};
function _normalizeTaskType(type) {
  if (VALID_TASK_TYPES.has(type)) return type;
  return TASK_TYPE_ALIASES[type] || 'human_task';
}

const MAX_PENDING_TASKS_PER_CONTACT = 3;

function _safeScheduledAt(dateStr) {
  const date = new Date(dateStr);
  if (isNaN(date.getTime()) || date <= new Date()) {
    const now = new Date();
    const romeH = parseInt(now.toLocaleString('en-US', { timeZone: 'Europe/Rome', hour: 'numeric', hour12: false }));
    if (romeH >= 9 && romeH < 19) return now;
    const romeOffset = (now.getMonth() >= 2 && now.getMonth() <= 9) ? 2 : 1;
    const target = new Date(now);
    target.setDate(target.getDate() + (romeH >= 19 ? 1 : 0));
    target.setUTCHours(9 - romeOffset, 0, 0, 0);
    return target;
  }
  return date;
}

async function _canCreateTaskForContact(contactId, taskType) {
  const pendingCount = await AgentTask.countDocuments({
    contact: contactId,
    status: { $in: ['pending', 'executing'] },
  });
  if (pendingCount >= MAX_PENDING_TASKS_PER_CONTACT) return false;
  const dup = await AgentTask.findOne({ contact: contactId, type: taskType, status: { $in: ['pending', 'executing'] } });
  return !dup;
}

const processToolIntents = async (toolIntents, conversation, contact) => {
  const toolsUsed = [];

  for (const intent of (toolIntents || [])) {
    if (intent.tool === 'mark_contact_terminal') continue;

    if (intent.tool === 'hibernate_workflow') {
      const taskType = _normalizeTaskType(intent.params.task_type || 'seasonal_reactivation');
      if (!(await _canCreateTaskForContact(contact._id, taskType))) {
        toolsUsed.push({ name: 'hibernate_workflow', input: intent.params, result: { scheduled: false, reason: 'duplicate_or_cap' } });
        continue;
      }
      await AgentTask.create({
        type: taskType,
        contact: contact._id,
        conversation: conversation._id,
        threadId: intent.params.thread_id,
        hasCheckpoint: true,
        scheduledAt: _safeScheduledAt(intent.params.wake_at),
        context: intent.params.context || {},
        priority: intent.params.priority || 'high',
        createdBy: 'agent'
      });
      toolsUsed.push({ name: 'hibernate_workflow', input: intent.params, result: { scheduled: true } });

    } else if (intent.tool === 'schedule_task') {
      const taskType = _normalizeTaskType(intent.params.task_type || 'follow_up_no_reply');
      if (!(await _canCreateTaskForContact(contact._id, taskType))) {
        toolsUsed.push({ name: 'schedule_task', input: intent.params, result: { scheduled: false, reason: 'duplicate_or_cap' } });
        continue;
      }
      await AgentTask.create({
        type: taskType,
        contact: contact._id,
        conversation: conversation._id,
        hasCheckpoint: false,
        scheduledAt: _safeScheduledAt(intent.params.scheduled_at),
        context: intent.params.context || {},
        priority: intent.params.priority || 'medium',
        createdBy: 'agent'
      });
      toolsUsed.push({ name: 'schedule_task', input: intent.params, result: { scheduled: true } });

    } else if (intent.tool === 'send_email_reply' || intent.tool === 'send_email') {
      const result = await executeTools('send_email_reply', intent.params, { conversation, contact });
      toolsUsed.push({ name: 'send_email_reply', input: intent.params, result });

    } else if (intent.tool === 'send_whatsapp') {
      const result = await executeTools('send_whatsapp', intent.params, { conversation, contact });
      toolsUsed.push({ name: 'send_whatsapp', input: intent.params, result });

    } else {
      const result = await executeTools(intent.tool, intent.params, { conversation, contact });
      toolsUsed.push({ name: intent.tool, input: intent.params, result });
    }
  }

  return toolsUsed;
};

const STAGE_TRANSITIONS = {
  prospecting:       ['initial_reply', 'engaged', 'lost', 'terminal', 'dormant'],
  initial_reply:     ['engaged', 'objection_handling', 'qualification', 'lost', 'terminal', 'dormant'],
  engaged:           ['objection_handling', 'negotiating', 'qualification', 'scheduling', 'lost', 'terminal', 'dormant'],
  objection_handling:['engaged', 'negotiating', 'qualification', 'lost', 'terminal', 'dormant'],
  negotiating:       ['qualification', 'scheduling', 'handoff', 'lost', 'terminal', 'dormant'],
  qualification:     ['scheduling', 'handoff', 'won', 'lost', 'terminal', 'dormant'],
  scheduling:        ['handoff', 'won', 'lost', 'terminal', 'dormant'],
  handoff:           ['won', 'lost'],
  dormant:           ['initial_reply', 'engaged', 'lost', 'terminal'],
  won:               [],
  lost:              ['dormant', 'engaged'],
  terminal:          [],
};

function _isValidStageTransition(from, to) {
  const allowed = STAGE_TRANSITIONS[from];
  if (!allowed) return true;
  return allowed.includes(to);
}

const MAX_CONSECUTIVE_AGENT_MSGS = 3;

function _countConsecutiveAgentMessages(messages) {
  let count = 0;
  for (let i = (messages || []).length - 1; i >= 0; i--) {
    if (messages[i].role === 'agent') count++;
    else break;
  }
  return count;
}

export const runAgentLoop = async (conversation, leadMessage) => {
  const contact = await Contact.findById(conversation.contact).lean();
  const identity = conversation.agentIdentity || IDENTITIES.marco;

  const consecutiveAgentMsgs = _countConsecutiveAgentMessages(conversation.messages);
  if (consecutiveAgentMsgs >= MAX_CONSECUTIVE_AGENT_MSGS) {
    agentLogger.warn('agent_loop_circuit_breaker', {
      conversationId: conversation._id,
      data: { consecutiveAgentMsgs, threshold: MAX_CONSECUTIVE_AGENT_MSGS, contactEmail: contact?.email }
    });
    return { response: null, toolsUsed: [], identity, rounds: 0, circuitBreaker: true };
  }

  try {
    let agentResponse = await callAgentProcess({
      contact,
      conversation,
      leadMessage,
      category: conversation.context?.leadCategory || 'NEUTRAL',
      confidence: 0.5,
      extracted: {},
      fromEmail: null
    });

    agentResponse = applyChannelPolicyToAgentResponse(agentResponse, conversation, { flow: 'reactive' });

    agentLogger.info('agent_service_response', {
      conversationId: conversation._id,
      data: {
        action: agentResponse.action,
        hasDraft: !!agentResponse.draft,
        channel: agentResponse.channel,
        toolIntents: (agentResponse.tool_intents || []).length,
        tokens: agentResponse.total_tokens,
        costUsd: agentResponse.estimated_cost_usd,
        timeMs: agentResponse.processing_time_ms
      }
    });

    AgentMetric.create({
      conversation: conversation._id,
      event: 'llm_call',
      data: {
        model: agentResponse.model_used || 'multi-node',
        inputTokens: agentResponse.total_input_tokens || 0,
        outputTokens: agentResponse.total_output_tokens || 0,
        costUsd: agentResponse.estimated_cost_usd || 0,
        durationMs: agentResponse.processing_time_ms || 0,
        channel: agentResponse.channel,
      }
    }).catch(() => {});

    const toolsUsed = await processToolIntents(agentResponse.tool_intents, conversation, contact);

    if (agentResponse.action === 'terminal') {
      const terminalIntent = (agentResponse.tool_intents || []).find(i => i.tool === 'mark_contact_terminal');
      const terminalReason = terminalIntent?.params?.terminal_reason || 'business_closed';
      await Contact.findByIdAndUpdate(contact._id, { status: terminalReason });
      await AgentTask.updateMany(
        { contact: contact._id, status: 'pending' },
        { status: 'cancelled', cancelledReason: `Terminal: ${terminalReason}` }
      );
      agentLogger.info('contact_marked_terminal', {
        conversationId: conversation._id,
        data: { email: contact.email, reason: terminalReason }
      });
      if (agentResponse.draft) {
        conversation.addMessage('agent', agentResponse.draft, agentResponse.channel || 'email', {
          wasAutoSent: false, isDraft: true,
        });
        conversation.status = 'awaiting_human';
        await conversation.save();
        return { response: agentResponse.draft, toolsUsed: [], identity, rounds: 1, terminal: true };
      }
      conversation.status = 'dead';
      conversation.outcome = terminalReason;
      await conversation.save();
      return { response: null, toolsUsed: [], identity, rounds: 1, terminal: true };
    }

    if (agentResponse.action === 'escalate_human') {
      await executeTools('request_human_help', {
        reason: agentResponse.strategy?.main_angle || 'Agent Service ha deciso di escalare',
        urgency: 'medium'
      }, { conversation });
      return {
        response: null,
        toolsUsed: [{ name: 'request_human_help', input: {}, result: {} }, ...toolsUsed],
        identity,
        rounds: 1
      };
    }

    if (agentResponse.action === 'hibernated') {
      return {
        response: null,
        toolsUsed,
        identity,
        rounds: 1
      };
    }

    if (agentResponse.draft) {
      const channel = agentResponse.channel || 'email';
      conversation.addMessage('agent', agentResponse.draft, channel, {
        wasAutoSent: false,
        isDraft: true,
        draftSubject: agentResponse.email_subject || null,
        whatsappDraft: agentResponse.whatsapp_draft || null
      });
      if (agentResponse.email_subject) {
        conversation.context.emailSubject = agentResponse.email_subject;
      }
      if (agentResponse.whatsapp_draft) {
        conversation.context.whatsappDraft = agentResponse.whatsapp_draft;
      }
      conversation.status = 'awaiting_human';
      conversation.markModified('context');
      await conversation.save();

      const toolName = channel === 'whatsapp' ? 'send_whatsapp' : 'send_email_reply';
      return {
        response: agentResponse.draft,
        toolsUsed: [{ name: toolName, input: { message: agentResponse.draft }, result: { sent: false, draft: true } }, ...toolsUsed],
        identity,
        rounds: 1,
        strategy: agentResponse.strategy,
        thinking: agentResponse.thinking
      };
    }

    return { response: null, toolsUsed, identity, rounds: 0 };

  } catch (error) {
    agentLogger.error('agent_service_error', {
      conversationId: conversation._id,
      data: { error: error.message }
    });
    throw error;
  }
};

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ORCHESTRATOR
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export const handleAgentConversation = async ({
  contact,
  replyText,
  category,
  confidence,
  extracted,
  fromEmail,
  webhookBasic,
  inboundChannel = 'email'
}) => {
  if (!(await acquireLock(contact._id))) {
    agentLogger.warn('conversation_locked', { contactEmail: contact.email, data: 'Agente già in esecuzione per questo contatto, skip' });
    return { action: 'locked', conversation: null };
  }

  const identity = resolveIdentity(fromEmail);

  let conversation = await Conversation.findActiveByContact(contact._id);

  if (!conversation) {
    conversation = new Conversation({
      contact: contact._id,
      channel: 'email',
      status: 'active',
      stage: 'initial_reply',
      agentIdentity: identity,
      context: {
        leadCategory: category,
        leadSource: contact.source || 'smartlead_outbound',
        smartleadData: {
          campaignId: webhookBasic?.campaignId,
          leadId: webhookBasic?.leadId
        },
        restaurantData: {
          name: contact.name,
          city: contact.properties?.city || contact.properties?.['Città'] || contact.properties?.location,
          googleMapsLink: contact.properties?.google_maps_link
        },
        smartleadLeadId: webhookBasic?.leadId
      },
      assignedTo: contact.owner
    });
  }

  conversation.addMessage('lead', replyText, inboundChannel, { extractedEntities: extracted });

  const routing = routeLeadReply(category, confidence, extracted, replyText);

  try {
    if (routing.action === 'direct_handoff') {
      conversation.status = 'escalated';
      conversation.outcome = 'sql';
      conversation.stage = 'handoff';
      await conversation.save();
      agentLogger.info('direct_handoff', { conversationId: conversation._id, contactEmail: contact.email, data: 'Lead caldo → team vendite' });
      sendAgentActivityReport({ action: 'direct_handoff', contactName: contact.name, contactEmail: contact.email, contactPhone: contact.phone || extracted?.phone, agentName: identity.name, leadMessage: replyText, category, confidence, conversationId: conversation._id, source: contact.source }).catch(() => {});
      logAgentActivity(contact._id, {
        type: 'ai_agent',
        title: '🎯 Direct Handoff — Lead caldo',
        description: `Lead ha fornito il telefono o chiesto una chiamata. Passato direttamente al team vendite.\n\nMessaggio: "${replyText?.substring(0, 300)}"`,
        data: { action: 'direct_handoff', phone: extracted?.phone, category, confidence },
        createdBy: contact.owner,
      });
      return { action: 'direct_handoff', conversation };
    }

    if (routing.action === 'stop' || routing.action === 'track_lost') {
      conversation.status = 'dead';
      conversation.outcome = routing.action === 'stop' ? 'dnc' : 'lost';
      await conversation.save();
      return { action: routing.action, conversation };
    }

    if (routing.action === 'resume_sequence') {
      await conversation.save();
      return { action: 'resume_sequence', conversation };
    }

    await conversation.save();

    // Cancel pending proactive tasks — lead responded, reactive flow takes over
    const cancelledCount = await AgentTask.cancelPendingForConversation(conversation._id);
    if (cancelledCount > 0) {
      agentLogger.info('tasks_cancelled', { conversationId: conversation._id, data: { count: cancelledCount, reason: 'Lead responded' } });
    }

    agentLogger.info('agent_loop_start', { conversationId: conversation._id, contactEmail: contact.email, data: { name: contact.name } });
    const agentResult = await runAgentLoop(conversation, replyText);

    await updateConversationInsights(conversation, replyText, agentResult.strategy).catch(() => {});

    if (agentResult.toolsUsed.length > 0) {
      agentLogger.info('tools_used', { conversationId: conversation._id, contactEmail: contact.email, data: agentResult.toolsUsed.map(t => t.name) });
    }

    const hasDraftedMessage = agentResult.toolsUsed.some(t =>
      (t.name === 'send_email_reply' || t.name === 'send_whatsapp') && t.result?.draft === true
    );
    const hasRequestedHelp = agentResult.toolsUsed.some(t => t.name === 'request_human_help');

    if (hasDraftedMessage) {
      agentLogger.info('draft_saved', { conversationId: conversation._id, contactEmail: contact.email });
      const agentMsg = conversation.messages.filter(m => m.role === 'agent').pop();

      const { generateSignedActionUrl } = await import('./signedUrlService.js');
      const { sendAgentHumanReviewEmail } = await import('./emailNotificationService.js');
      const frontendUrl = process.env.FRONTEND_URL || 'https://crm-frontend-pied-sigma.vercel.app';
      await sendAgentHumanReviewEmail({
        restaurantName: conversation.context?.restaurantData?.name || contact.name,
        city: conversation.context?.restaurantData?.city || '',
        rank: conversation.context?.restaurantData?.rank,
        keyword: conversation.context?.restaurantData?.keyword,
        rating: conversation.context?.restaurantData?.rating,
        reviewsCount: conversation.context?.restaurantData?.reviewsCount,
        leadMessage: replyText,
        draftReply: agentMsg?.content,
        reason: 'Bozza generata dall\'agente — in attesa di approvazione',
        conversationId: conversation._id,
        contactEmail: contact.email,
        msgCount: conversation.metrics?.messagesCount || 0,
        objections: conversation.context?.objections || [],
        approveLink: generateSignedActionUrl(conversation._id, 'approve'),
        modifyLink: `${frontendUrl}/agent/review?id=${conversation._id}`,
        discardLink: generateSignedActionUrl(conversation._id, 'discard')
      }).catch(() => {});

      const researchSummary = agentResult.research_summary || agentResult.strategy?.main_angle || '';
      logAgentActivity(contact._id, {
        type: 'ai_agent',
        title: '🤖 AI Agent — Bozza generata',
        description: `L'agente ha analizzato il messaggio del lead e generato una bozza di risposta.\n\nMessaggio lead: "${replyText?.substring(0, 200)}"\n\nBozza: "${agentMsg?.content?.substring(0, 500)}"\n\n📊 Ricerca:\n${researchSummary?.substring(0, 1000)}`,
        data: { action: 'draft_ready', conversationId: conversation._id, channel: agentResult.strategy?.channel, researchSummary },
        createdBy: contact.owner,
      });

      if (conversation.context) {
        conversation.context.lastResearchSummary = researchSummary || '';
        conversation.context.aiProcess = {
          researchSummary: researchSummary || '',
          strategy: agentResult.strategy?.approach || agentResult.strategy?.raw?.strategy || '',
          reasoning: (agentResult.thinking || agentResult.strategy?.reasoning || '').substring(0, 500),
          generatedAt: new Date(),
        };
        const stratTag = agentResult.strategy?.raw?.strategy_tag || agentResult.strategy?.strategy_tag;
        if (stratTag) conversation.context.strategyTag = stratTag;
        conversation.markModified('context');
        await conversation.save();
      }

      return { action: 'awaiting_human', conversation, draftReply: agentMsg?.content };
    }

    if (hasRequestedHelp) {
      const agentMsg = conversation.messages.filter(m => m.role === 'agent').pop();
      sendAgentActivityReport({ action: 'awaiting_human', contactName: contact.name, contactEmail: contact.email, contactPhone: contact.phone, agentName: identity.name, leadMessage: replyText, agentReply: agentMsg?.content, toolsUsed: agentResult.toolsUsed.map(t => t.name), category, confidence, conversationId: conversation._id, source: contact.source }).catch(() => {});
      return { action: 'awaiting_human', conversation };
    }

    return { action: 'no_action', conversation };
  } catch (error) {
    agentLogger.error('agent_loop_error', { conversationId: conversation._id, contactEmail: contact?.email, data: error.message });
    conversation.status = 'awaiting_human';
    await conversation.save();

    await executeTools('request_human_help', {
      reason: `Errore tecnico nell'agente: ${error.message}`,
      urgency: 'high'
    }, { conversation });

    return { action: 'error', conversation, error: error.message };
  } finally {
    await releaseLock(contact._id);
  }
};

export const approveAndSend = async (conversationId, options = {}) => {
  const conversation = await Conversation.findById(conversationId);
  if (!conversation || conversation.status !== 'awaiting_human') {
    return { success: false, reason: 'Conversazione non in attesa di review' };
  }

  const contact = await Contact.findById(conversation.contact).lean();
  if (!contact) return { success: false, reason: 'Contatto non trovato' };

  const draftIdx = conversation.messages.map((m, i) => ({ m, i }))
    .filter(({ m }) => m.role === 'agent' && m.metadata?.isDraft)
    .pop()?.i;
  const lastAgentIdx = conversation.messages.map((m, i) => ({ m, i }))
    .filter(({ m }) => m.role === 'agent')
    .pop()?.i;
  const targetIdx = draftIdx ?? lastAgentIdx;
  const lastAgentMsg = targetIdx != null ? conversation.messages[targetIdx] : null;
  const originalDraft = lastAgentMsg?.content;
  const originalWaDraft = lastAgentMsg?.metadata?.whatsappDraft || conversation.context?.whatsappDraft;

  const {
    emailContent,
    whatsappContent,
    emailSubject,
    modifiedContent,
  } = typeof options === 'string'
    ? { modifiedContent: options, emailContent: null, whatsappContent: null, emailSubject: null }
    : (options || {});

  const emailToSend = emailContent ?? modifiedContent ?? originalDraft;
  if (!emailToSend) return { success: false, reason: 'Nessun contenuto da inviare' };

  const subject = emailSubject || lastAgentMsg?.metadata?.draftSubject || conversation.context?.emailSubject || undefined;
  const sendResult = await executeTools('send_email_reply', { message: emailToSend, subject }, { conversation, contact, approvedByHuman: true });

  const emailModified = !!(emailContent && emailContent !== originalDraft) || !!(modifiedContent && modifiedContent !== originalDraft);
  const waModified = !!(whatsappContent && whatsappContent !== originalWaDraft);

  if (targetIdx != null) {
    if (emailModified) {
      const sentMsg = conversation.messages[targetIdx];
      sentMsg.metadata.supersededBy = 'modified';
      sentMsg.metadata.isDraft = true;
      conversation.addMessage('agent', emailToSend, 'email', {
        wasAutoSent: true,
        humanEdited: true,
      });
    } else {
      conversation.messages[targetIdx].metadata.wasAutoSent = true;
      conversation.messages[targetIdx].metadata.isDraft = false;
    }
    conversation.markModified('messages');
  }

  const currentChannel = conversation.channelState?.currentChannel || conversation.channel || 'email';
  const phone = contact.phone;
  const waToSend = whatsappContent ?? originalWaDraft;
  if (phone && waToSend && currentChannel !== 'whatsapp') {
    const waMessage = waToSend.length > 900 ? waToSend.slice(0, 897) + '...' : waToSend;
    sendProactiveWhatsApp({
      phone,
      message: waMessage,
      contactName: contact.name,
      conversationId: conversation._id?.toString(),
    }).then(result => {
      if (result.success) {
        Conversation.findById(conversationId).then(conv => {
          if (conv) {
            conv.addMessage('agent', waMessage, 'whatsapp', {
              wasAutoSent: true,
              twilioMessageSid: result.messageSid,
            });
            conv.save().catch(() => {});
          }
        }).catch(() => {});
      }
      agentLogger.info('approve_whatsapp_sent', { conversationId, data: { success: result.success, method: result.channel, error: result.error } });
    }).catch(err => {
      agentLogger.warn('approve_whatsapp_failed', { conversationId, data: { error: err.message, phone } });
    });
  }

  conversation.status = 'active';
  await conversation.save();

  return {
    success: true,
    sendResult,
    emailModified,
    waModified,
    originalDraft,
    originalWaDraft,
    finalEmail: emailToSend,
    finalWhatsapp: waToSend,
  };
};

export const discardReply = async (conversationId) => {
  const conversation = await Conversation.findById(conversationId);
  if (!conversation) return { success: false, reason: 'Conversazione non trovata' };
  conversation.status = 'paused';
  await conversation.save();
  return { success: true };
};

export default { resolveIdentity, routeLeadReply, runAgentLoop, handleAgentConversation, approveAndSend, discardReply };
