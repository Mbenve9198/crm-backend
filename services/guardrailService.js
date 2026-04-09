/**
 * Guardrail Service — deterministic validation layer for agent-proposed actions.
 *
 * Every action proposed by the agent planner passes through these guardrails:
 * - Rate limiting: max messages per contact per time window
 * - Budget: daily LLM cost cap
 * - Blacklist: no actions on terminal contacts
 * - Frequency cap: max attempts without reply
 * - Content safety: post-generation content checks
 *
 * Actions are classified as: ALLOW, REVIEW (human), or BLOCK.
 */

import AgentTask from '../models/agentTaskModel.js';
import AgentMetric from '../models/agentMetricModel.js';
import Conversation from '../models/conversationModel.js';
import agentLogger from './agentLogger.js';

const TERMINAL_STATUSES = new Set([
  'bad_data', 'lost', 'dnc', 'do_not_contact', 'closed',
  'deceased', 'wrong_contact', 'business_closed', 'not_interested_final',
]);

const GUARDRAIL_CONFIG = {
  maxProactivePerContactPerWeek: 2,
  maxConsecutiveNoReply: 3,
  dailyBudgetUsd: parseFloat(process.env.AGENT_DAILY_BUDGET_USD || '50'),
  minHoursBetweenProactiveMessages: 72,
  blockedContentPatterns: [
    /password|credit.?card|ssn|social.?security/i,
    /\b(xxx|nsfw|porn)\b/i,
  ],
  highConfidenceThreshold: 0.85,
};

/**
 * A conversation is "active" if the lead has replied recently
 * (i.e. the last message is from the lead, or the lead replied within the last 48h).
 * Active conversations should flow freely — rate limits don't apply.
 */
function _isActiveConversation(conversation) {
  const messages = conversation.messages || [];
  if (messages.length === 0) return false;

  const lastMsg = messages[messages.length - 1];
  if (lastMsg.role === 'lead') return true;

  const lastLeadMsg = [...messages].reverse().find(m => m.role === 'lead');
  if (!lastLeadMsg?.createdAt) return false;

  const hoursSinceLeadReply = (Date.now() - new Date(lastLeadMsg.createdAt).getTime()) / (1000 * 60 * 60);
  return hoursSinceLeadReply < 48;
}

/**
 * Validate a single proposed action through all guardrails.
 *
 * @param {Object} action - Proposed action from the planner
 * @param {Object} contact - Contact document
 * @param {Object} conversation - Conversation document (optional)
 * @param {number} confidence - Planner's confidence score
 * @returns {{ verdict: 'allow'|'review'|'block', reasons: string[] }}
 */
export async function validateAction(action, contact, conversation, confidence = 0.5) {
  const reasons = [];
  let verdict = 'allow';

  if (!action || !contact) {
    return { verdict: 'block', reasons: ['Missing action or contact data'] };
  }

  if (action.action === 'do_nothing' || action.action === 'escalate_human') {
    return { verdict: 'allow', reasons: [] };
  }

  if (TERMINAL_STATUSES.has(contact.status)) {
    return {
      verdict: 'block',
      reasons: [`Contact in terminal status: ${contact.status}`],
    };
  }

  const isConversationActive = conversation && _isActiveConversation(conversation);

  if (!isConversationActive) {
    const recentProactiveTasks = await AgentTask.countDocuments({
      contact: contact._id,
      status: { $in: ['completed', 'executing'] },
      createdAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
    });

    if (recentProactiveTasks >= GUARDRAIL_CONFIG.maxProactivePerContactPerWeek) {
      reasons.push(`Proactive rate limit: ${recentProactiveTasks} outbound this week (max ${GUARDRAIL_CONFIG.maxProactivePerContactPerWeek})`);
      verdict = 'block';
    }

    if (conversation) {
      const lastOutbound = (conversation.messages || [])
        .filter(m => m.role === 'agent')
        .pop();
      if (lastOutbound?.createdAt) {
        const hoursSince = (Date.now() - new Date(lastOutbound.createdAt).getTime()) / (1000 * 60 * 60);
        if (hoursSince < GUARDRAIL_CONFIG.minHoursBetweenProactiveMessages) {
          reasons.push(`Too soon for proactive: ${Math.round(hoursSince)}h since last message (min ${GUARDRAIL_CONFIG.minHoursBetweenProactiveMessages}h)`);
          verdict = verdict === 'block' ? 'block' : 'review';
        }
      }
    }
  }

  if (conversation) {
    const messages = conversation.messages || [];
    let consecutiveAgent = 0;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'agent') consecutiveAgent++;
      else break;
    }
    if (consecutiveAgent >= GUARDRAIL_CONFIG.maxConsecutiveNoReply) {
      reasons.push(`Frequency cap: ${consecutiveAgent} consecutive agent messages without reply`);
      verdict = 'block';
    }
  }

  try {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const dailyCost = await AgentMetric.aggregate([
      { $match: { createdAt: { $gte: todayStart }, event: 'llm_call' } },
      { $group: { _id: null, total: { $sum: '$data.costUsd' } } },
    ]);
    const todayCost = dailyCost[0]?.total || 0;
    if (todayCost >= GUARDRAIL_CONFIG.dailyBudgetUsd) {
      reasons.push(`Budget exceeded: $${todayCost.toFixed(2)} today (max $${GUARDRAIL_CONFIG.dailyBudgetUsd})`);
      verdict = 'block';
    }
  } catch (err) {
    agentLogger.warn('guardrail_budget_check_error', { data: { error: err.message } });
  }

  if (verdict === 'allow' && confidence < GUARDRAIL_CONFIG.highConfidenceThreshold) {
    reasons.push(`Low confidence: ${(confidence * 100).toFixed(0)}% (threshold ${(GUARDRAIL_CONFIG.highConfidenceThreshold * 100).toFixed(0)}%)`);
    verdict = 'review';
  }

  agentLogger.info('guardrail_result', {
    data: {
      action: action.action,
      contact: contact.email,
      verdict,
      reasons,
      confidence,
    },
  });

  return { verdict, reasons };
}

/**
 * Validate content of a generated message for safety.
 *
 * @param {string} content - The message content to check
 * @returns {{ safe: boolean, reasons: string[] }}
 */
export function validateContent(content) {
  if (!content) return { safe: true, reasons: [] };

  const reasons = [];
  for (const pattern of GUARDRAIL_CONFIG.blockedContentPatterns) {
    if (pattern.test(content)) {
      reasons.push(`Blocked content pattern detected: ${pattern.source}`);
    }
  }

  if (content.length > 3000) {
    reasons.push(`Message too long: ${content.length} chars`);
  }

  return { safe: reasons.length === 0, reasons };
}

/**
 * Process a batch of planner-proposed actions through guardrails.
 *
 * @param {Object[]} actions - Array of proposed actions
 * @param {Object} contact - Contact document
 * @param {Object} conversation - Conversation document
 * @param {number} confidence - Planner confidence
 * @returns {{ allowed: Object[], review: Object[], blocked: Object[] }}
 */
export async function processActions(actions, contact, conversation, confidence = 0.5) {
  const allowed = [];
  const review = [];
  const blocked = [];

  for (const action of (actions || [])) {
    const result = await validateAction(action, contact, conversation, confidence);
    const entry = { ...action, guardrail: result };

    switch (result.verdict) {
      case 'allow':
        allowed.push(entry);
        break;
      case 'review':
        review.push(entry);
        break;
      case 'block':
        blocked.push(entry);
        break;
    }
  }

  agentLogger.info('guardrail_batch', {
    data: {
      contact: contact?.email,
      total: actions?.length || 0,
      allowed: allowed.length,
      review: review.length,
      blocked: blocked.length,
    },
  });

  return { allowed, review, blocked };
}

export default { validateAction, validateContent, processActions };
