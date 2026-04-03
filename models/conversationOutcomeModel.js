import mongoose from 'mongoose';

const conversationOutcomeSchema = new mongoose.Schema({
  conversation: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Conversation',
    required: true,
    index: true
  },
  contact: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Contact',
    required: true,
    index: true
  },

  outcome: {
    type: String,
    enum: ['converted', 'call_booked', 'lost', 'dnc', 'stale'],
    required: true
  },
  convertedToStatus: String,

  totalMessages: Number,
  agentMessages: Number,
  humanMessages: Number,
  daysToOutcome: Number,
  channelsUsed: [String],

  analysis: {
    effectiveStrategies: [String],
    failedStrategies: [String],
    keyTurningPoint: String,
    leadProfile: String,
    objectionTypes: [String],
    recommendedImprovements: [String]
  },

  humanFeedback: {
    rating: { type: Number, min: 1, max: 5 },
    notes: String,
    wrongActions: [{
      messageIndex: Number,
      expectedAction: String,
      actualAction: String
    }],
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    reviewedAt: Date
  }
}, { timestamps: true });

conversationOutcomeSchema.index({ outcome: 1, createdAt: -1 });

const ConversationOutcome = mongoose.model('ConversationOutcome', conversationOutcomeSchema);

export default ConversationOutcome;
