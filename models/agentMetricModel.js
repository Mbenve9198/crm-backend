import mongoose from 'mongoose';

const agentMetricSchema = new mongoose.Schema({
  conversation: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Conversation',
    index: true
  },
  event: {
    type: String,
    enum: ['llm_call', 'tool_call', 'message_sent', 'human_review', 'outreach', 'error', 'planner_call', 'sales_manager_call'],
    required: true,
    index: true
  },
  data: {
    model: String,
    inputTokens: Number,
    outputTokens: Number,
    costUsd: Number,
    durationMs: Number,
    toolName: String,
    toolSuccess: Boolean,
    channel: String,
    errorMessage: String
  },
  createdAt: { type: Date, default: Date.now, index: true }
});

agentMetricSchema.index({ createdAt: -1 });

agentMetricSchema.statics.getMetricsSummary = async function(startDate, endDate) {
  const match = {};
  if (startDate || endDate) {
    match.createdAt = {};
    if (startDate) match.createdAt.$gte = startDate;
    if (endDate) match.createdAt.$lte = endDate;
  }

  const [totals, byTool, byEvent] = await Promise.all([
    this.aggregate([
      { $match: match },
      { $group: {
        _id: null,
        totalCostUsd: { $sum: '$data.costUsd' },
        totalInputTokens: { $sum: '$data.inputTokens' },
        totalOutputTokens: { $sum: '$data.outputTokens' },
        avgDurationMs: { $avg: '$data.durationMs' },
        totalEvents: { $sum: 1 },
        llmCalls: { $sum: { $cond: [{ $eq: ['$event', 'llm_call'] }, 1, 0] } }
      }}
    ]),
    this.aggregate([
      { $match: { ...match, event: 'tool_call' } },
      { $group: {
        _id: '$data.toolName',
        count: { $sum: 1 },
        avgDurationMs: { $avg: '$data.durationMs' },
        successRate: { $avg: { $cond: ['$data.toolSuccess', 1, 0] } }
      }},
      { $sort: { count: -1 } }
    ]),
    this.aggregate([
      { $match: match },
      { $group: { _id: '$event', count: { $sum: 1 } } },
      { $sort: { count: -1 } }
    ])
  ]);

  return {
    totals: totals[0] || { totalCostUsd: 0, totalInputTokens: 0, totalOutputTokens: 0, avgDurationMs: 0, totalEvents: 0, llmCalls: 0 },
    byTool,
    byEvent
  };
};

const AgentMetric = mongoose.model('AgentMetric', agentMetricSchema);

export default AgentMetric;
