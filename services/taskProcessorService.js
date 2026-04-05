import AgentTask from '../models/agentTaskModel.js';
import Conversation from '../models/conversationModel.js';
import Contact from '../models/contactModel.js';
import { callAgentProactive, callAgentResume } from './agentServiceClient.js';
import { executeTools } from './agentToolsService.js';
import { sendAgentActivityReport, sendAgentHumanReviewEmail } from './emailNotificationService.js';
import { generateSignedActionUrl } from './signedUrlService.js';
import agentLogger from './agentLogger.js';

const TASK_PROCESS_INTERVAL_MS = 10 * 60 * 1000;
const TASK_GENERATE_INTERVAL_MS = 24 * 60 * 60 * 1000;

export function startTaskProcessor() {
  console.log('🤖 Task Processor avviato (ogni 10 min)');
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

async function processAgentTasks() {
  const romeH = parseInt(new Date().toLocaleString('en-US', { timeZone: 'Europe/Rome', hour: 'numeric', hour12: false }));
  if (romeH < 9 || romeH >= 20) return;

  const dueTasks = await AgentTask.findDueTasks(10);
  if (dueTasks.length === 0) return;

  console.log(`🤖 Task Processor: ${dueTasks.length} task da eseguire`);

  for (const task of dueTasks) {
    task.status = 'executing';
    task.attempts += 1;
    await task.save();

    try {
      if (task.type === 'human_task') {
        await handleHumanTask(task);
        task.status = 'completed';
      } else {
        let response;

        if (task.hasCheckpoint && task.threadId) {
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
        }

        await processToolIntents(response.tool_intents || [], task);
        await handleAgentResponse(response, task);

        task.status = 'completed';
        task.result = { action: response.action, hasDraft: !!response.draft };
      }
    } catch (error) {
      agentLogger.error('task_processor_error', { data: { taskId: task._id, type: task.type, error: error.message } });
      task.status = task.attempts >= task.maxAttempts ? 'failed' : 'pending';
      task.result = { error: error.message };
    }

    await task.save();
  }
}

async function processToolIntents(toolIntents, task) {
  for (const intent of toolIntents) {
    if (intent.tool === 'hibernate_workflow') {
      await AgentTask.create({
        type: intent.params.task_type || 'seasonal_reactivation',
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
        type: intent.params.task_type || 'follow_up_no_reply',
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

      await executeTools(intent.tool, intent.params, { conversation, contact });
    }
  }
}

async function handleAgentResponse(response, task) {
  if (!response.draft) return;

  const conversation = task.conversation && typeof task.conversation === 'object'
    ? task.conversation
    : (task.conversation ? await Conversation.findById(task.conversation) : null);

  if (!conversation) return;

  const channel = response.channel || 'email';
  conversation.addMessage('agent', response.draft, channel, {
    wasAutoSent: false,
    isDraft: true
  });
  conversation.status = 'awaiting_human';
  conversation.markModified('context');
  await conversation.save();

  const contact = task.contact && typeof task.contact === 'object'
    ? task.contact
    : await Contact.findById(conversation.contact).lean();

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

async function generateReactivationTasks() {
  console.log('📋 Generazione task di riattivazione...');
  let created = 0;

  const twoDaysAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
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
    (await AgentTask.distinct('contact', { status: 'pending', type: 'rank_checker_outreach' })).map(id => id.toString())
  );

  for (const lead of rcLeads) {
    if (!existingConvContacts.has(lead._id.toString()) && !existingTaskContacts.has(lead._id.toString())) {
      await AgentTask.create({
        type: 'rank_checker_outreach',
        contact: lead._id,
        scheduledAt: nextBusinessHour(),
        context: { source: 'rank_checker' },
        createdBy: 'system'
      });
      created++;
    }
  }

  const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
  const staleActive = await Conversation.find({
    status: 'active',
    updatedAt: { $lte: threeDaysAgo }
  }).select('_id contact');

  for (const conv of staleActive) {
    const hasTask = await AgentTask.findOne({
      conversation: conv._id,
      type: { $in: ['follow_up_no_reply', 'break_up_email'] },
      status: 'pending'
    });
    if (!hasTask) {
      await AgentTask.create({
        type: 'follow_up_no_reply',
        contact: conv.contact,
        conversation: conv._id,
        scheduledAt: nextBusinessHour(),
        context: { reason: 'No reply for 3+ days', attempt: 1 },
        createdBy: 'system'
      });
      created++;
    }
  }

  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const dormant = await Conversation.find({
    status: { $in: ['paused'] },
    updatedAt: { $lte: thirtyDaysAgo }
  }).select('_id contact');

  for (const conv of dormant) {
    const hasTask = await AgentTask.findOne({
      conversation: conv._id,
      type: 'reactivation',
      status: 'pending'
    });
    if (!hasTask) {
      await AgentTask.create({
        type: 'reactivation',
        contact: conv.contact,
        conversation: conv._id,
        scheduledAt: nextBusinessHour(),
        context: { reason: 'Dormant 30+ days' },
        createdBy: 'system'
      });
      created++;
    }
  }

  const sevenDayStale = await Conversation.find({
    status: { $in: ['active'] },
    updatedAt: { $lte: sevenDaysAgo }
  }).select('_id contact');

  for (const conv of sevenDayStale) {
    const hasTask = await AgentTask.findOne({
      conversation: conv._id,
      type: 'break_up_email',
      status: 'pending'
    });
    if (!hasTask) {
      await AgentTask.create({
        type: 'break_up_email',
        contact: conv.contact,
        conversation: conv._id,
        scheduledAt: nextBusinessHour(),
        context: { reason: 'Stale 7+ days' },
        createdBy: 'system'
      });
      created++;
    }
  }

  if (created > 0) {
    console.log(`📋 Task Generator: ${created} task creati`);
  }
}

function nextBusinessHour() {
  const now = new Date();
  const romeH = parseInt(now.toLocaleString('en-US', { timeZone: 'Europe/Rome', hour: 'numeric', hour12: false }));
  if (romeH >= 9 && romeH < 19) return now;
  const tomorrow9 = new Date(now);
  tomorrow9.setDate(tomorrow9.getDate() + (romeH >= 19 ? 1 : 0));
  tomorrow9.setHours(9, 0, 0, 0);
  return tomorrow9;
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
