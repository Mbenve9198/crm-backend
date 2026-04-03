import mongoose from 'mongoose';

const agentLogSchema = new mongoose.Schema({
  level: {
    type: String,
    enum: ['info', 'warn', 'error'],
    required: true,
    index: true
  },
  conversationId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Conversation',
    index: true
  },
  contactEmail: String,
  event: {
    type: String,
    required: true,
    index: true
  },
  data: mongoose.Schema.Types.Mixed,
  createdAt: { type: Date, default: Date.now, index: true }
});

agentLogSchema.index({ createdAt: -1 });
agentLogSchema.index({ level: 1, createdAt: -1 });

const AgentLog = mongoose.model('AgentLog', agentLogSchema);

export default AgentLog;
