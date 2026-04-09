import AgentMetric from '../models/agentMetricModel.js';
import AgentLog from '../models/agentLogModel.js';
import AgentFeedback from '../models/agentFeedbackModel.js';
import AgentTask from '../models/agentTaskModel.js';
import Conversation from '../models/conversationModel.js';
import ConversationOutcome from '../models/conversationOutcomeModel.js';
import SalesManagerDirective from '../models/salesManagerDirectiveModel.js';
import { callAgentSalesManager } from './agentServiceClient.js';
import agentLogger from './agentLogger.js';

const LOOKBACK_HOURS = 6;

function hoursAgo(h) {
  return new Date(Date.now() - h * 60 * 60 * 1000);
}

async function _collectMetrics() {
  const since = hoursAgo(LOOKBACK_HOURS);
  const [summary, dailyCosts] = await Promise.all([
    AgentMetric.getMetricsSummary(since, new Date()),
    AgentMetric.aggregate([
      { $match: { createdAt: { $gte: since }, event: 'llm_call' } },
      { $group: {
        _id: null,
        totalCost: { $sum: '$data.costUsd' },
        totalCalls: { $sum: 1 },
        avgDurationMs: { $avg: '$data.durationMs' },
      }},
    ]),
  ]);
  return { summary, recentCosts: dailyCosts[0] || { totalCost: 0, totalCalls: 0 } };
}

async function _collectConversations() {
  const [byStatus, byStage, stale] = await Promise.all([
    Conversation.aggregate([
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]),
    Conversation.aggregate([
      { $match: { status: { $in: ['active', 'awaiting_human'] } } },
      { $group: { _id: '$stage', count: { $sum: 1 } } },
    ]),
    Conversation.countDocuments({
      status: 'active',
      updatedAt: { $lte: hoursAgo(72) },
    }),
  ]);
  return {
    byStatus: Object.fromEntries(byStatus.map(s => [s._id, s.count])),
    byStage: Object.fromEntries(byStage.map(s => [s._id, s.count])),
    staleCount: stale,
  };
}

async function _collectOutcomes() {
  const since = hoursAgo(LOOKBACK_HOURS * 4);
  const outcomes = await ConversationOutcome.find({ createdAt: { $gte: since } })
    .populate('contact', 'name email source')
    .lean();

  const summary = {
    total: outcomes.length,
    converted: outcomes.filter(o => ['converted', 'call_booked'].includes(o.outcome)).length,
    lost: outcomes.filter(o => o.outcome === 'lost').length,
    dnc: outcomes.filter(o => o.outcome === 'dnc').length,
  };
  const recent = outcomes.slice(0, 5).map(o => ({
    outcome: o.outcome,
    contact: o.contact?.name,
    source: o.contact?.source,
    messages: o.totalMessages,
    days: o.daysToOutcome,
  }));
  return { summary, recent };
}

async function _collectFeedback() {
  const since = hoursAgo(LOOKBACK_HOURS * 4);
  const feedbacks = await AgentFeedback.find({ createdAt: { $gte: since } }).lean();

  const total = feedbacks.length;
  const approved = feedbacks.filter(f => f.action === 'approved').length;
  const modified = feedbacks.filter(f => f.action === 'modified').length;
  const discarded = feedbacks.filter(f => f.action === 'discarded').length;

  const discardReasons = {};
  for (const f of feedbacks.filter(fb => fb.action === 'discarded')) {
    const r = f.discardReason || 'other';
    discardReasons[r] = (discardReasons[r] || 0) + 1;
  }

  const modifications = feedbacks
    .filter(f => f.action === 'modified' && f.modifications)
    .slice(0, 5)
    .map(f => ({
      toneChange: f.modifications.toneChange,
      added: f.modifications.addedContent?.substring(0, 100),
      removed: f.modifications.removedContent?.substring(0, 100),
    }));

  return { total, approved, modified, discarded, discardReasons, recentModifications: modifications };
}

async function _collectTasks() {
  const since = hoursAgo(LOOKBACK_HOURS);
  const stats = await AgentTask.aggregate([
    { $match: { updatedAt: { $gte: since } } },
    { $group: { _id: { status: '$status', type: '$type' }, count: { $sum: 1 } } },
  ]);
  const pending = await AgentTask.countDocuments({ status: 'pending' });
  return { recentByStatusType: stats, pendingTotal: pending };
}

async function _collectErrors() {
  const since = hoursAgo(LOOKBACK_HOURS);
  const errors = await AgentLog.find({
    level: { $in: ['error', 'warn'] },
    createdAt: { $gte: since },
  }).sort({ createdAt: -1 }).limit(20).lean();

  return errors.map(e => ({
    event: e.event,
    level: e.level,
    data: typeof e.data === 'string' ? e.data.substring(0, 200) : JSON.stringify(e.data || '').substring(0, 200),
    at: e.createdAt,
  }));
}

async function _collectSignificantConversations() {
  const since = hoursAgo(LOOKBACK_HOURS);
  const recent = await Conversation.find({
    updatedAt: { $gte: since },
    status: { $in: ['awaiting_human', 'active'] },
  })
    .populate('contact', 'name email source')
    .sort({ updatedAt: -1 })
    .limit(10)
    .lean();

  return recent.map(c => ({
    contact: c.contact?.name,
    email: c.contact?.email,
    source: c.context?.leadSource,
    stage: c.stage,
    status: c.status,
    messages: c.messages?.length || 0,
    lastMessage: c.messages?.slice(-1)[0]?.content?.substring(0, 200),
    strategyTag: c.context?.strategyTag,
    objections: c.context?.objections,
  }));
}


export async function runSalesManagerCycle() {
  const startMs = Date.now();
  agentLogger.info('sales_manager_cycle_start', { data: {} });

  try {
    const [metrics, conversations, outcomes, feedback, tasks, errors, significantConvs] =
      await Promise.all([
        _collectMetrics(),
        _collectConversations(),
        _collectOutcomes(),
        _collectFeedback(),
        _collectTasks(),
        _collectErrors(),
        _collectSignificantConversations(),
      ]);

    const reportData = {
      metrics,
      conversations,
      outcomes,
      feedback,
      tasks,
      errors,
      significant_conversations: significantConvs,
    };

    const result = await callAgentSalesManager(reportData);

    if (result.directives?.length > 0) {
      await SalesManagerDirective.updateMany({ isActive: true }, { isActive: false });

      for (const d of result.directives) {
        await SalesManagerDirective.create({
          scope: d.scope || 'all',
          directive: d.directive,
          reason: d.reason || '',
          priority: d.priority || 'medium',
          expiresAt: d.expires_hours
            ? new Date(Date.now() + d.expires_hours * 60 * 60 * 1000)
            : new Date(Date.now() + 24 * 60 * 60 * 1000),
        });
      }
      agentLogger.info('sales_manager_directives_saved', {
        data: { count: result.directives.length }
      });
    }

    if (result.briefing) {
      agentLogger.info('sales_manager_briefing', {
        data: {
          headline: result.briefing.headline,
          summary: result.briefing.summary?.substring(0, 500),
          highlights: result.briefing.highlights,
          concerns: result.briefing.concerns,
        }
      });

      try {
        const { sendSalesManagerBriefing } = await import('./emailNotificationService.js');
        if (typeof sendSalesManagerBriefing === 'function') {
          await sendSalesManagerBriefing(result.briefing, result.performance);
        }
      } catch {
        // email function may not exist yet
      }
    }

    if (result.alerts?.length > 0) {
      for (const alert of result.alerts) {
        agentLogger.info('sales_manager_alert', {
          data: { severity: alert.severity, message: alert.message }
        });

        if (alert.severity === 'critical') {
          try {
            const { sendSalesManagerBriefing } = await import('./emailNotificationService.js');
            if (typeof sendSalesManagerBriefing === 'function') {
              await sendSalesManagerBriefing(
                { headline: `ALERT: ${alert.message}`, summary: alert.suggested_action || '' },
                {}
              );
            }
          } catch { /* non-blocking */ }
        }
      }
    }

    const durationMs = Date.now() - startMs;
    agentLogger.info('sales_manager_cycle_complete', {
      data: {
        durationMs,
        directives: result.directives?.length || 0,
        alerts: result.alerts?.length || 0,
        tokensUsed: result.tokens_used,
        costUsd: result.estimated_cost_usd,
      }
    });

    return result;
  } catch (err) {
    agentLogger.error('sales_manager_cycle_error', { data: { error: err.message } });
    return null;
  }
}

export default { runSalesManagerCycle };
