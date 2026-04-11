import AgentTask from '../models/agentTaskModel.js';
import AgentMetric from '../models/agentMetricModel.js';
import Conversation from '../models/conversationModel.js';
import Contact from '../models/contactModel.js';
import { callAgentProactive, callAgentResume, callAgentPlan } from './agentServiceClient.js';
import { executeTools } from './agentToolsService.js';
import { sendProactiveWhatsApp } from './agentWhatsAppService.js';
import { sendAgentActivityReport, sendAgentHumanReviewEmail } from './emailNotificationService.js';
import { generateSignedActionUrl } from './signedUrlService.js';
import { runDailyReactivationScan } from './contactScannerService.js';
import agentLogger from './agentLogger.js';
import { applyChannelPolicyToAgentResponse } from './channelPolicyService.js';

const TASK_PROCESS_INTERVAL_MS = 5 * 60 * 1000;
const BATCH_CONCURRENCY = parseInt(process.env.TASK_BATCH_CONCURRENCY || '3');
let _processingLock = false;

/** Riattivazione: non affidarsi al solo canale corrente — email + WhatsApp (se c’è telefono), senza dipendere da PROACTIVE_DUAL_CHANNEL_WHATSAPP. */
const REACTIVATION_DUAL_CHANNEL_TASK_TYPES = new Set([
  'reactivation',
  'reactivation_warm',
  'reactivation_cold',
  'seasonal_reactivation',
]);

function shouldSendDualWhatsappForTask(task) {
  if (process.env.PROACTIVE_DUAL_CHANNEL_WHATSAPP === 'true') return true;
  return REACTIVATION_DUAL_CHANNEL_TASK_TYPES.has(task.type);
}

export function startTaskProcessor() {
  console.log(`🤖 Task Processor avviato (ogni ${TASK_PROCESS_INTERVAL_MS / 1000}s, concurrency=${BATCH_CONCURRENCY})`);
  processAgentTasks().catch(err => console.error('❌ Primo ciclo task processor:', err.message));
  setInterval(() => {
    processAgentTasks().catch(err => console.error('❌ Task processor error:', err.message));
  }, TASK_PROCESS_INTERVAL_MS);
}

export function startTaskGenerator() {
  console.log('📋 Task Generator avviato (giornaliero ore 8:00 Rome)');
  scheduleDaily8AM(() => {
    generateReactivationTasks().catch(err => console.error('❌ Task generator error:', err.message));
  });
}

/**
 * Autonomy levels:
 *   A = full approval (current default)
 *   B = auto-approve proactive tasks with high confidence + guardrail pass
 *   C = auto-approve reactive responses to positive/neutral leads
 *   D = approval only for complex situations (escalation, first contact, objections)
 */
function _getAutonomyLevel() {
  const mode = process.env.AGENT_APPROVAL_MODE;
  if (mode === 'true' || mode === 'A') return 'A';
  if (mode === 'B') return 'B';
  if (mode === 'C') return 'C';
  if (mode === 'D') return 'D';
  if (mode === 'false') return 'D';
  return 'A';
}

function _canAutoSend(level, flowType, response, contact) {
  if (level === 'A') return false;

  if (level === 'B') {
    if (flowType === 'proactive') {
      const confidence = response.strategy?.raw?.confidence || 0;
      return confidence >= 0.9;
    }
    return false;
  }

  if (level === 'C') {
    if (flowType === 'proactive') return true;
    if (flowType === 'reactive') {
      const sentiment = response.strategy?.raw?.lead_sentiment;
      return sentiment === 'positive' || sentiment === 'neutral';
    }
    return false;
  }

  if (level === 'D') {
    if (flowType === 'proactive') return true;
    if (flowType === 'reactive') {
      const stage = response.new_stage;
      const complexStages = ['objection_handling', 'negotiating', 'terminal'];
      return !complexStages.includes(stage);
    }
    return true;
  }

  return false;
}

const STUCK_TASK_TIMEOUT_MS = 30 * 60 * 1000;

async function _recoverStuckTasks() {
  const cutoff = new Date(Date.now() - STUCK_TASK_TIMEOUT_MS);
  const result = await AgentTask.updateMany(
    { status: 'executing', updatedAt: { $lte: cutoff } },
    { status: 'pending', $inc: { attempts: 0 } }
  );
  if (result.modifiedCount > 0) {
    agentLogger.info('stuck_tasks_recovered', { data: { count: result.modifiedCount } });
  }
}

async function processAgentTasks() {
  const romeH = parseInt(new Date().toLocaleString('en-US', { timeZone: 'Europe/Rome', hour: 'numeric', hour12: false }));
  if (romeH < 9 || romeH >= 20) return;

  if (_processingLock) {
    console.log('🔒 Task Processor: ciclo precedente ancora in corso, skip');
    return;
  }
  _processingLock = true;

  try {
    await _recoverStuckTasks();

    const dueTasks = await AgentTask.findDueTasks(BATCH_CONCURRENCY * 3);
    if (dueTasks.length === 0) return;

    console.log(`🤖 Task Processor: ${dueTasks.length} task da eseguire (batch=${BATCH_CONCURRENCY})`);

    for (let i = 0; i < dueTasks.length; i += BATCH_CONCURRENCY) {
      const batch = dueTasks.slice(i, i + BATCH_CONCURRENCY);

      for (const task of batch) {
        task.status = 'executing';
        task.attempts += 1;
        await task.save();
      }

      const results = await Promise.allSettled(batch.map(task => _executeSingleTask(task)));

      for (let j = 0; j < batch.length; j++) {
        const task = batch[j];
        const result = results[j];

        if (result.status === 'fulfilled') {
          task.status = 'completed';
          task.result = result.value;
        } else {
          agentLogger.error('task_processor_error', { data: { taskId: task._id, type: task.type, error: result.reason?.message } });
          task.status = task.attempts >= task.maxAttempts ? 'failed' : 'pending';
          task.result = { error: result.reason?.message };
        }
        await task.save();
      }
    }
  } finally {
    _processingLock = false;
  }
}

const TERMINAL_CONTACT_STATUSES = new Set([
  'bad_data', 'lost', 'dnc', 'do_not_contact', 'closed', 'deceased',
  'wrong_contact', 'business_closed', 'not_interested_final',
]);

async function _executeSingleTask(task) {
  if (task.type === 'human_task') {
    await handleHumanTask(task);
    return { action: 'human_task' };
  }

  const contact = task.contact && typeof task.contact === 'object'
    ? task.contact
    : await Contact.findById(task.contact).lean();

  if (contact && TERMINAL_CONTACT_STATUSES.has(contact.status)) {
    agentLogger.info('task_skipped_terminal', {
      data: { taskId: task._id, type: task.type, contactStatus: contact.status, email: contact.email }
    });
    return { action: 'skipped', reason: `Contact in terminal status: ${contact.status}` };
  }

  let response;
  const isResume = !!(task.hasCheckpoint && task.threadId);

  if (isResume) {
    response = await callAgentResume({
      threadId: task.threadId,
      updatedContext: {
        current_date: new Date().toISOString(),
        days_since_hibernate: Math.floor((Date.now() - task.createdAt.getTime()) / (24 * 60 * 60 * 1000))
      }
    });
  } else {
    const contact = task.contact || await Contact.findById(task.contact).lean();
    const conversation = task.conversation || (task.conversation ? await Conversation.findById(task.conversation) : null);

    response = await callAgentProactive({ task, contact, conversation });
    if (conversation) {
      response = applyChannelPolicyToAgentResponse(response, conversation, { flow: 'proactive' });
    }
  }

  AgentMetric.create({
    conversation: task.conversation?._id || task.conversation || null,
    event: 'llm_call',
    data: {
      model: response.model_used || 'multi-node',
      inputTokens: response.total_input_tokens || 0,
      outputTokens: response.total_output_tokens || 0,
      costUsd: response.estimated_cost_usd || 0,
      durationMs: response.processing_time_ms || 0,
      channel: response.channel,
    }
  }).catch(() => {});

  await processToolIntents(response.tool_intents || [], task);

  if (response.action === 'terminal') {
    const terminalIntent = (response.tool_intents || []).find(i => i.tool === 'mark_contact_terminal');
    if (terminalIntent && contact) {
      const terminalReason = terminalIntent.params?.terminal_reason || 'business_closed';
      await Contact.findByIdAndUpdate(contact._id, { status: terminalReason });
      await AgentTask.updateMany(
        { contact: contact._id, status: 'pending' },
        { status: 'cancelled', cancelledReason: `Terminal: ${terminalReason}` }
      );
      agentLogger.info('contact_marked_terminal', {
        data: { email: contact.email, reason: terminalReason }
      });
    }
    if (response.draft) {
      await handleAgentResponse(response, task);
    }
    return { action: 'terminal', reason: terminalIntent?.params?.terminal_reason };
  }

  const autonomyLevel = _getAutonomyLevel();
  const shouldAutoSendProactive =
    !isResume &&
    response.action === 'draft_ready' &&
    response.draft &&
    _canAutoSend(autonomyLevel, 'proactive', response, contact);

  if (shouldAutoSendProactive) {
    await deliverProactiveOutreach(response, task);
  } else {
    await handleAgentResponse(response, task);
  }

  return { action: response.action, hasDraft: !!response.draft };
}

const VALID_TASK_TYPES = new Set([
  'rank_checker_outreach', 'follow_up_no_reply', 'follow_up_scheduled',
  'break_up_email', 'seasonal_reactivation', 'reactivation',
  'reactivation_warm', 'reactivation_cold', 'human_task',
]);

const TASK_TYPE_ALIASES = {
  'business_closed': 'human_task',
  'find_alternative_contact': 'human_task',
  'closure_response': 'human_task',
  'schedule_call': 'human_task',
  'follow_up': 'follow_up_no_reply',
  'followup': 'follow_up_no_reply',
  'reactivation_seasonal': 'seasonal_reactivation',
};

function _normalizeTaskType(type) {
  if (VALID_TASK_TYPES.has(type)) return type;
  if (TASK_TYPE_ALIASES[type]) return TASK_TYPE_ALIASES[type];
  agentLogger.warn('unknown_task_type_mapped', { data: { original: type, mappedTo: 'human_task' } });
  return 'human_task';
}

async function processToolIntents(toolIntents, task) {
  for (const intent of toolIntents) {
    if (intent.tool === 'mark_contact_terminal') continue;

    if (intent.tool === 'hibernate_workflow') {
      await AgentTask.create({
        type: _normalizeTaskType(intent.params.task_type || 'seasonal_reactivation'),
        contact: task.contact._id || task.contact,
        conversation: task.conversation?._id || task.conversation,
        threadId: intent.params.thread_id,
        hasCheckpoint: true,
        scheduledAt: new Date(intent.params.wake_at),
        context: intent.params.context || {},
        priority: intent.params.priority || 'high',
        createdBy: 'agent'
      });
    } else if (intent.tool === 'schedule_task') {
      await AgentTask.create({
        type: _normalizeTaskType(intent.params.task_type || 'follow_up_no_reply'),
        contact: task.contact._id || task.contact,
        conversation: task.conversation?._id || task.conversation,
        hasCheckpoint: false,
        scheduledAt: new Date(intent.params.scheduled_at),
        context: intent.params.context || {},
        priority: intent.params.priority || 'medium',
        createdBy: 'agent'
      });
    } else {
      const conversation = task.conversation && typeof task.conversation === 'object'
        ? task.conversation
        : (task.conversation ? await Conversation.findById(task.conversation) : null);
      const contact = task.contact && typeof task.contact === 'object'
        ? task.contact
        : await Contact.findById(task.contact).lean();

      await executeTools(intent.tool, intent.params, {
        conversation,
        contact,
        channelGuardrail: 'outreach'
      });
    }
  }
}

/** Invio reale dopo task proattivo (email + opzionale WhatsApp in coda template), senza bozza in approvazione umana. */
async function deliverProactiveOutreach(response, task) {
  const contact = task.contact && typeof task.contact === 'object'
    ? task.contact
    : await Contact.findById(task.contact).lean();
  if (!contact) return;

  let conversation = task.conversation && typeof task.conversation === 'object'
    ? task.conversation
    : (task.conversation ? await Conversation.findById(task.conversation) : null);

  if (!conversation) {
    conversation = new Conversation({
      contact: contact._id || task.contact,
      channel: response.channel || 'email',
      status: 'active',
      stage: 'initial_reply',
      agentIdentity: { name: 'Marco', surname: 'Benvenuti', role: 'co-founder' },
      context: {
        leadCategory: 'PROACTIVE_OUTREACH',
        leadSource: contact?.source || 'inbound_rank_checker',
        restaurantData: {
          name: contact?.name,
          city: contact?.properties?.city || contact?.properties?.location,
        },
      },
      assignedTo: contact?.owner,
    });
    await conversation.save();
    task.conversation = conversation._id;
    await task.save();
  }

  const subject = response.email_subject || response.strategy?.raw?.email_subject || undefined;

  await executeTools('send_email_reply', {
    message: response.draft,
    subject
  }, { conversation, contact, channelGuardrail: 'outreach' });

  const phone = contact.phone;
  if (phone) {
    const waMessage = response.draft.length > 900 ? response.draft.slice(0, 897) + '...' : response.draft;
    sendProactiveWhatsApp({
      phone,
      message: waMessage,
      contactName: contact.name,
      conversationId: conversation._id?.toString(),
    }).then(result => {
      if (result.success) {
        Conversation.findById(conversation._id || conversation).then(conv => {
          if (conv) {
            conv.addMessage('agent', waMessage, 'whatsapp', {
              wasAutoSent: true,
              twilioMessageSid: result.messageSid,
            });
            conv.save().catch(() => {});
          }
        }).catch(() => {});
      }
    }).catch(err => {
      agentLogger.warn('whatsapp_dual_channel_failed', { data: { error: err.message, phone } });
    });
  }

  agentLogger.info('proactive_outreach_sent', {
    conversationId: conversation?._id,
    data: {
      taskType: task.type,
      dualWhatsapp: !!phone,
    }
  });

  try {
    const Activity = (await import('../models/activityModel.js')).default;
    const taskLabels = {
      rank_checker_outreach: '📨 AI Agent — Primo contatto rank checker',
      follow_up_no_reply: '🔄 AI Agent — Follow-up (no reply)',
      break_up_email: '👋 AI Agent — Break-up email',
      reactivation: '🔁 AI Agent — Riattivazione lead dormiente',
      seasonal_reactivation: '🌱 AI Agent — Riattivazione stagionale',
    };
    await Activity.create({
      contact: contact._id,
      type: 'ai_agent',
      title: (taskLabels[task.type] || `🤖 AI Agent — ${task.type}`).substring(0, 200),
      description: `Azione proattiva dell'agente.\n\nDraft: "${response.draft?.substring(0, 500)}"`,
      data: {
        kind: 'ai_agent',
        origin: 'system',
        meta: { action: task.type, conversationId: conversation?._id, channel: response.channel, dualWhatsapp: !!phone }
      },
      createdBy: contact.owner,
    });
  } catch (err) {
    console.error('⚠️ Activity create failed in deliverProactiveOutreach:', err.message);
  }
}

async function handleAgentResponse(response, task) {
  if (!response.draft) return;

  const contact = task.contact && typeof task.contact === 'object'
    ? task.contact
    : await Contact.findById(task.contact).lean();

  let conversation = task.conversation && typeof task.conversation === 'object'
    ? task.conversation
    : (task.conversation ? await Conversation.findById(task.conversation) : null);

  if (!conversation) {
    conversation = new Conversation({
      contact: contact._id || task.contact,
      channel: response.channel || 'email',
      status: 'active',
      stage: 'initial_reply',
      agentIdentity: { name: 'Marco', surname: 'Benvenuti', role: 'co-founder' },
      context: {
        leadCategory: 'PROACTIVE_OUTREACH',
        leadSource: contact?.source || 'inbound_rank_checker',
        restaurantData: {
          name: contact?.name,
          city: contact?.properties?.city || contact?.properties?.location,
        },
      },
      assignedTo: contact?.owner,
    });
    task.conversation = conversation._id;
    await task.save();
  }

  const channel = response.channel || 'email';
  conversation.addMessage('agent', response.draft, channel, {
    wasAutoSent: false,
    isDraft: true,
    draftSubject: response.email_subject || null,
    whatsappDraft: response.whatsapp_draft || null
  });
  if (response.email_subject) {
    conversation.context.emailSubject = response.email_subject;
  }
  if (response.whatsapp_draft) {
    conversation.context.whatsappDraft = response.whatsapp_draft;
  }
  conversation.context.aiProcess = {
    researchSummary: response.research_summary || '',
    strategy: response.strategy?.approach || response.strategy?.raw?.strategy || '',
    reasoning: (response.thinking || response.strategy?.reasoning || '').substring(0, 500),
    generatedAt: new Date(),
  };
  const stratTag = response.strategy?.raw?.strategy_tag || response.strategy?.strategy_tag;
  if (stratTag) conversation.context.strategyTag = stratTag;
  conversation.status = 'awaiting_human';
  conversation.markModified('context');
  await conversation.save();

  const frontendUrl = process.env.FRONTEND_URL || 'https://crm-frontend-pied-sigma.vercel.app';
  await sendAgentHumanReviewEmail({
    restaurantName: contact?.name || 'Lead',
    city: '',
    leadMessage: `[${task.type}] Azione proattiva dell'agente`,
    draftReply: response.draft,
    reason: `Task proattivo: ${task.type}`,
    conversationId: conversation._id,
    contactEmail: contact?.email,
    approveLink: generateSignedActionUrl(conversation._id, 'approve'),
    modifyLink: `${frontendUrl}/agent/review?id=${conversation._id}`,
    discardLink: generateSignedActionUrl(conversation._id, 'discard')
  }).catch(() => {});
}

async function handleHumanTask(task) {
  const contact = task.contact && typeof task.contact === 'object'
    ? task.contact
    : await Contact.findById(task.contact).lean();

  sendAgentActivityReport({
    action: 'human_task',
    contactName: contact?.name,
    contactEmail: contact?.email,
    contactPhone: contact?.phone,
    agentName: 'Sistema',
    agentReply: task.context?.reason || 'Task per operatore',
    conversationId: task.conversation,
    source: contact?.source
  }).catch(() => {});
}

const PLANNER_BATCH_LIMIT = 25;

async function generateReactivationTasks() {
  console.log('🧠 Task Generator (Planner-driven): avvio scansione...');
  let created = 0;
  const situations = [];

  // ── 1. Rank Checker leads (new_lead) ──
  const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const rcLeads = await Contact.find({
    source: 'inbound_rank_checker',
    status: 'da contattare',
    createdAt: { $lte: twoDaysAgo, $gte: sevenDaysAgo }
  }).lean();

  const existingConvContacts = new Set(
    (await Conversation.distinct('contact')).map(id => id.toString())
  );
  const existingTaskContacts = new Set(
    (await AgentTask.distinct('contact', { status: 'pending' })).map(id => id.toString())
  );

  for (const lead of rcLeads) {
    if (!existingConvContacts.has(lead._id.toString()) && !existingTaskContacts.has(lead._id.toString())) {
      situations.push({
        type: 'new_lead',
        contact: _contactToPlanner(lead),
        contactDoc: lead,
        conversation: { stage: 'none', messages_count: 0 },
        context: {
          source: 'rank_checker',
          call_requested: lead.properties?.callRequested === true,
          call_preference: lead.properties?.callPreference || null,
          days_since_signup: Math.floor((Date.now() - new Date(lead.createdAt).getTime()) / 86400000),
        },
      });
    }
  }

  // ── 2. Stale conversations (no_reply_timeout) ──
  const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
  const staleActive = await Conversation.find({
    status: 'active',
    updatedAt: { $lte: threeDaysAgo }
  }).populate('contact').lean();

  for (const conv of staleActive) {
    if (!conv.contact || existingTaskContacts.has((conv.contact._id || conv.contact).toString())) continue;
    if (TERMINAL_CONTACT_STATUSES.has(conv.contact?.status)) continue;
    const daysSince = Math.floor((Date.now() - new Date(conv.updatedAt).getTime()) / 86400000);
    situations.push({
      type: 'no_reply_timeout',
      contact: _contactToPlanner(conv.contact),
      contactDoc: conv.contact,
      conversationDoc: conv,
      conversation: {
        stage: conv.stage || 'initial_reply',
        messages_count: conv.messages?.length || 0,
        conversation_id: conv._id.toString(),
      },
      context: { days_since_last_contact: daysSince },
    });
  }

  // ── 3. Dormant conversations (timer_expired) ──
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const dormant = await Conversation.find({
    status: { $in: ['paused'] },
    updatedAt: { $lte: thirtyDaysAgo }
  }).populate('contact').lean();

  for (const conv of dormant) {
    if (!conv.contact || existingTaskContacts.has((conv.contact._id || conv.contact).toString())) continue;
    if (TERMINAL_CONTACT_STATUSES.has(conv.contact?.status)) continue;
    const daysSince = Math.floor((Date.now() - new Date(conv.updatedAt).getTime()) / 86400000);
    situations.push({
      type: 'timer_expired',
      contact: _contactToPlanner(conv.contact),
      contactDoc: conv.contact,
      conversationDoc: conv,
      conversation: {
        stage: conv.stage || 'dormant',
        messages_count: conv.messages?.length || 0,
        conversation_id: conv._id.toString(),
      },
      context: { days_dormant: daysSince, original_status: conv.status },
    });
  }

  // ── Batch-call the Planner ──
  const batch = situations.slice(0, PLANNER_BATCH_LIMIT);
  console.log(`🧠 Planner: ${situations.length} situazioni trovate, processo batch di ${batch.length}`);

  for (const situation of batch) {
    try {
      const plan = await callAgentPlan({
        type: situation.type,
        contact: situation.contact,
        conversation: situation.conversation,
        context: situation.context,
      });

      AgentMetric.create({
        event: 'planner_call',
        data: {
          model: 'opus-thinking',
          costUsd: plan.estimated_cost_usd || 0,
          channel: situation.type,
          toolName: situation.contact.email,
        }
      }).catch(() => {});

      if (!plan.actions || plan.actions.length === 0) continue;

      for (const action of plan.actions) {
        if (action.action === 'do_nothing') continue;

        if (action.action === 'escalate_human' || situation.context.call_requested) {
          await AgentTask.create({
            type: 'human_task',
            contact: situation.contactDoc._id,
            conversation: situation.conversationDoc?._id || null,
            scheduledAt: nextBusinessHour(),
            context: {
              reason: action.context?.reason || plan.reasoning,
              source: situation.context.source || situation.type,
              planner_confidence: plan.confidence,
            },
            priority: action.priority || 'medium',
            createdBy: 'planner',
          });
          created++;
          continue;
        }

        if (action.action === 'mark_terminal') {
          await Contact.findByIdAndUpdate(situation.contactDoc._id, { status: 'not_interested_final' });
          await AgentTask.updateMany(
            { contact: situation.contactDoc._id, status: 'pending' },
            { status: 'cancelled', cancelledReason: `Planner: ${action.context?.reason || 'terminal'}` }
          );
          agentLogger.info('planner_marked_terminal', {
            data: { email: situation.contact.email, reason: action.context?.reason }
          });
          continue;
        }

        const taskTypeMap = {
          'send_outreach': 'rank_checker_outreach',
          'send_follow_up': 'follow_up_no_reply',
          'send_break_up': 'break_up_email',
          'send_reactivation': 'reactivation',
          'schedule_task': action.task_type || 'follow_up_no_reply',
        };
        const taskType = _normalizeTaskType(taskTypeMap[action.action] || action.task_type || 'follow_up_no_reply');

        const delayMs = (action.delay_hours || 0) * 3600000;
        const scheduledAt = delayMs > 0
          ? new Date(Date.now() + delayMs)
          : nextBusinessHour();

        await AgentTask.create({
          type: taskType,
          contact: situation.contactDoc._id,
          conversation: situation.conversationDoc?._id || null,
          scheduledAt,
          context: {
            reason: action.context?.reason || plan.reasoning,
            planner_confidence: plan.confidence,
            planner_action: action.action,
          },
          priority: action.priority || 'medium',
          createdBy: 'planner',
        });
        created++;
      }

      agentLogger.info('planner_processed', {
        data: {
          type: situation.type,
          email: situation.contact.email,
          actions: plan.actions.map(a => a.action),
          confidence: plan.confidence,
        },
      });
    } catch (err) {
      agentLogger.error('planner_call_failed', {
        data: { type: situation.type, email: situation.contact.email, error: err.message }
      });
    }
  }

  // ── Contact scanner (legacy, still useful for edge cases) ──
  try {
    const reactivated = await runDailyReactivationScan();
    created += reactivated;
  } catch (err) {
    console.error('❌ Contact scanner error:', err.message);
  }

  if (created > 0) {
    console.log(`🧠 Task Generator (Planner): ${created} task creati`);
  }
}

function _contactToPlanner(contact) {
  return {
    email: contact.email,
    name: contact.name,
    phone: contact.phone || null,
    city: contact.properties?.city || contact.properties?.location || null,
    rating: contact.properties?.rating ? parseFloat(contact.properties.rating) : null,
    reviews: contact.properties?.reviews ? parseInt(contact.properties.reviews) : null,
    source: contact.source || null,
    status: contact.status || null,
    category: contact.properties?.category || null,
  };
}

function nextBusinessHour() {
  const now = new Date();
  const romeH = parseInt(now.toLocaleString('en-US', { timeZone: 'Europe/Rome', hour: 'numeric', hour12: false }));
  if (romeH >= 9 && romeH < 19) return now;

  const romeOffset = _getRomeUtcOffsetHours();
  const target = new Date(now);
  target.setDate(target.getDate() + (romeH >= 19 ? 1 : 0));
  target.setUTCHours(9 - romeOffset, 0, 0, 0);
  return target;
}

function _getRomeUtcOffsetHours() {
  const jan = new Date(2026, 0, 1).toLocaleString('en-US', { timeZone: 'Europe/Rome', hour: 'numeric', hour12: false, hourCycle: 'h23' });
  const jul = new Date(2026, 6, 1).toLocaleString('en-US', { timeZone: 'Europe/Rome', hour: 'numeric', hour12: false, hourCycle: 'h23' });
  const now = new Date();
  const month = now.getMonth();
  return (month >= 2 && month <= 9) ? 2 : 1;
}

function scheduleDaily8AM(fn) {
  const run = () => {
    const now = new Date();
    const romeNow = new Date(now.toLocaleString('en-US', { timeZone: 'Europe/Rome' }));
    if (romeNow.getHours() === 8 && romeNow.getMinutes() < 15) {
      fn();
    }
  };
  run();
  setInterval(run, 15 * 60 * 1000);
}

export default { startTaskProcessor, startTaskGenerator, processAgentTasks, generateReactivationTasks };
