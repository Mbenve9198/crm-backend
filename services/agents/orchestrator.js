import Contact from '../../models/contactModel.js';
import AgentMetric from '../../models/agentMetricModel.js';
import agentLogger from '../agentLogger.js';
import * as researcher from './researcher.js';
import * as strategist from './strategist.js';
import * as writer from './writer.js';
import * as reviewer from './reviewer.js';

import inboundRankchecker from './playbooks/inbound_rankchecker.js';
import outboundInitial from './playbooks/outbound_initial.js';
import objectionHandling from './playbooks/objection_handling.js';
import qualification from './playbooks/qualification.js';
import scheduling from './playbooks/scheduling.js';

const playbooks = {
  'inbound_rank_checker:initial_reply': inboundRankchecker,
  'smartlead_outbound:initial_reply': outboundInitial,
  'objection_handling': objectionHandling,
  'qualification': qualification,
  'scheduling': scheduling
};

function loadPlaybook(stage, source) {
  const key = `${source}:${stage}`;
  return playbooks[key] || playbooks[stage] || outboundInitial;
}

export async function runMultiAgentPipeline(conversation, leadMessage) {
  const contact = await Contact.findById(conversation.contact).lean();
  const stage = conversation.stage || 'initial_reply';
  const source = conversation.context?.leadSource;
  const pipelineStart = Date.now();

  agentLogger.info('pipeline_start', {
    conversationId: conversation._id,
    data: { stage, source, contactName: contact?.name }
  });

  // 1. RESEARCHER
  const researchStart = Date.now();
  const researchData = await researcher.gather(contact, conversation, leadMessage);
  const researchMs = Date.now() - researchStart;

  agentLogger.info('researcher_done', {
    conversationId: conversation._id,
    data: {
      hasRanking: !!researchData.ranking,
      similarClients: researchData.similarClients.length,
      hasEmailHistory: researchData.emailHistory.length > 0,
      durationMs: researchMs
    }
  });

  // 2. STRATEGIST
  const playbook = loadPlaybook(stage, source);
  const strategyStart = Date.now();
  const strategy = await strategist.plan(leadMessage, researchData, playbook, conversation);
  const strategyMs = Date.now() - strategyStart;

  agentLogger.info('strategist_done', {
    conversationId: conversation._id,
    data: {
      approach: strategy.approach,
      cta: strategy.cta,
      tone: strategy.tone,
      maxWords: strategy.maxWords,
      hasSocialProof: !!strategy.socialProof,
      durationMs: strategyMs
    }
  });

  AgentMetric.create({
    conversation: conversation._id,
    event: 'llm_call',
    data: {
      model: 'claude-sonnet-4-20250514',
      agent: 'strategist',
      inputTokens: strategy.inputTokens || 0,
      outputTokens: strategy.outputTokens || 0,
      costUsd: ((strategy.inputTokens || 0) * 3 / 1_000_000) + ((strategy.outputTokens || 0) * 15 / 1_000_000),
      durationMs: strategyMs
    }
  }).catch(() => {});

  if (strategy.approach === 'escalate_human') {
    return {
      action: 'awaiting_human',
      draft: null,
      strategy,
      reason: strategy.mainAngle || 'Strategist ha deciso di escalare'
    };
  }

  if (strategy.approach === 'schedule_followup') {
    return {
      action: 'schedule_followup',
      draft: null,
      strategy,
      days: parseInt(strategy.ctaDetails) || 14,
      note: strategy.mainAngle
    };
  }

  // 3. WRITER
  const writerStart = Date.now();
  let draft = await writer.compose(strategy, researchData, conversation);
  const writerMs = Date.now() - writerStart;

  agentLogger.info('writer_done', {
    conversationId: conversation._id,
    data: { wordCount: draft.split(/\s+/).length, durationMs: writerMs }
  });

  // 4. REVIEWER
  const reviewerStart = Date.now();
  let reviewResult = await reviewer.check(draft, strategy, researchData, source, stage);
  const reviewerMs = Date.now() - reviewerStart;

  agentLogger.info('reviewer_done', {
    conversationId: conversation._id,
    data: { pass: reviewResult.pass, violations: reviewResult.violations, durationMs: reviewerMs }
  });

  if (!reviewResult.pass) {
    agentLogger.warn('reviewer_fail_retry', {
      conversationId: conversation._id,
      data: { violations: reviewResult.violations, feedback: reviewResult.feedback }
    });

    const retryStart = Date.now();
    draft = await writer.compose(strategy, researchData, conversation, reviewResult.feedback);
    reviewResult = await reviewer.check(draft, strategy, researchData, source, stage);
    const retryMs = Date.now() - retryStart;

    agentLogger.info('reviewer_retry_result', {
      conversationId: conversation._id,
      data: { pass: reviewResult.pass, violations: reviewResult.violations, durationMs: retryMs }
    });
  }

  const totalMs = Date.now() - pipelineStart;
  agentLogger.info('pipeline_complete', {
    conversationId: conversation._id,
    data: {
      totalMs,
      researchMs,
      strategyMs,
      writerMs,
      reviewerMs,
      reviewPass: reviewResult.pass,
      wordCount: draft.split(/\s+/).length,
      approach: strategy.approach
    }
  });

  if (!reviewResult.pass) {
    return {
      action: 'awaiting_human',
      draft,
      strategy,
      reviewFeedback: reviewResult.feedback,
      reason: `Reviewer FAIL dopo retry: ${reviewResult.violations.join(', ')}`
    };
  }

  return {
    action: 'draft_ready',
    draft,
    strategy,
    channel: strategy.channelToUse || 'email',
    thinking: strategy.thinking
  };
}

export default { runMultiAgentPipeline };
