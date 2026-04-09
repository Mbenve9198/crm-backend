import SalesManagerDirective from '../models/salesManagerDirectiveModel.js';
import { callAgentSalesManager } from './agentServiceClient.js';
import agentLogger from './agentLogger.js';

export async function runSalesManagerCycle() {
  const startMs = Date.now();
  agentLogger.info('sales_manager_cycle_start', { data: {} });

  try {
    const result = await callAgentSalesManager({});

    if (result.directives?.length > 0) {
      await SalesManagerDirective.updateMany({ isActive: true }, { isActive: false });

      for (const d of result.directives) {
        await SalesManagerDirective.create({
          scope: d.scope || 'all',
          type: d.type || 'observation',
          directive: d.directive,
          evidence: d.evidence || '',
          reason: d.reason || d.evidence || '',
          confidence: d.confidence || 'low',
          dataPoints: d.data_points || 0,
          priority: d.priority || 'medium',
          expiresAt: d.expires_hours
            ? new Date(Date.now() + d.expires_hours * 60 * 60 * 1000)
            : new Date(Date.now() + 48 * 60 * 60 * 1000),
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
          call_insights: result.briefing.call_insights,
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
        toolCallsMade: result.tool_calls_made || 0,
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
