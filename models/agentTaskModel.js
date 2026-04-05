import mongoose from 'mongoose';

const agentTaskSchema = new mongoose.Schema({
  type: {
    type: String,
    enum: [
      'rank_checker_outreach',
      'follow_up_no_reply',
      'follow_up_scheduled',
      'break_up_email',
      'seasonal_reactivation',
      'reactivation',
      'human_task'
    ],
    required: true
  },
  conversation: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Conversation'
  },
  contact: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Contact',
    required: true,
    index: true
  },

  threadId: { type: String, default: null },
  hasCheckpoint: { type: Boolean, default: false },

  scheduledAt: { type: Date, required: true, index: true },
  status: {
    type: String,
    enum: ['pending', 'executing', 'completed', 'failed', 'cancelled'],
    default: 'pending',
    index: true
  },
  priority: {
    type: String,
    enum: ['low', 'medium', 'high'],
    default: 'medium'
  },
  context: mongoose.Schema.Types.Mixed,
  result: mongoose.Schema.Types.Mixed,
  attempts: { type: Number, default: 0 },
  maxAttempts: { type: Number, default: 3 },
  createdBy: {
    type: String,
    enum: ['agent', 'human', 'system'],
    default: 'agent'
  },
  cancelledReason: String
}, { timestamps: true });

agentTaskSchema.index({ status: 1, scheduledAt: 1 });
agentTaskSchema.index({ contact: 1, type: 1 });
agentTaskSchema.index({ conversation: 1, status: 1 });

agentTaskSchema.statics.findDueTasks = function(limit = 10) {
  return this.find({
    status: 'pending',
    scheduledAt: { $lte: new Date() }
  })
    .populate('contact', 'name email phone properties source rankCheckerData')
    .populate('conversation')
    .sort({ priority: -1, scheduledAt: 1 })
    .limit(limit);
};

agentTaskSchema.statics.cancelPendingForConversation = async function(conversationId) {
  const result = await this.updateMany(
    { conversation: conversationId, status: 'pending' },
    { status: 'cancelled', cancelledReason: 'Lead responded — reactive flow activated' }
  );
  return result.modifiedCount;
};

const AgentTask = mongoose.model('AgentTask', agentTaskSchema);
export default AgentTask;
