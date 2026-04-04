import mongoose from 'mongoose';

const agentFeedbackSchema = new mongoose.Schema({
  conversation: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Conversation',
    required: true,
    index: true
  },
  contact: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Contact',
    required: true
  },

  agentDraft: { type: String, required: true },
  finalSent: String,

  action: {
    type: String,
    enum: ['approved', 'modified', 'discarded'],
    required: true,
    index: true
  },

  modifications: {
    addedContent: String,
    removedContent: String,
    toneChange: String,
    structureChange: Boolean
  },

  discardReason: {
    type: String,
    enum: [
      'wrong_tone',
      'wrong_strategy',
      'too_aggressive',
      'too_passive',
      'factual_error',
      'wrong_timing',
      'privacy_concern',
      'human_will_handle',
      'email_quick_discard',
      'other'
    ]
  },
  discardNotes: String,

  conversationContext: {
    stage: String,
    source: String,
    objections: [String],
    painPoints: [String],
    messageCount: Number,
    leadLastMessage: String,
    sequenceNumber: Number
  },

  reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  reviewTimeMs: Number,
  weekNumber: Number
}, { timestamps: true });

agentFeedbackSchema.index({ action: 1, 'conversationContext.source': 1, createdAt: -1 });
agentFeedbackSchema.index({ weekNumber: 1 });

const AgentFeedback = mongoose.model('AgentFeedback', agentFeedbackSchema);

export default AgentFeedback;
