import mongoose from 'mongoose';

const messageSchema = new mongoose.Schema({
  role: {
    type: String,
    enum: ['lead', 'agent', 'human'],
    required: true
  },
  content: {
    type: String,
    required: true,
    maxLength: 4000
  },
  channel: {
    type: String,
    enum: ['email', 'whatsapp'],
    required: true
  },
  metadata: {
    aiConfidence: Number,
    wasAutoSent: Boolean,
    humanEdited: Boolean,
    smartleadMessageId: String,
    twilioMessageSid: String,
    extractedEntities: mongoose.Schema.Types.Mixed
  },
  createdAt: { type: Date, default: Date.now }
}, { _id: true });

const conversationSchema = new mongoose.Schema({
  contact: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Contact',
    required: true,
    index: true
  },
  channel: {
    type: String,
    enum: ['email', 'whatsapp'],
    required: true
  },
  status: {
    type: String,
    enum: ['active', 'paused', 'awaiting_human', 'escalated', 'converted', 'dead'],
    default: 'active',
    index: true
  },
  stage: {
    type: String,
    enum: ['initial_reply', 'objection_handling', 'qualification', 'scheduling', 'handoff'],
    default: 'initial_reply'
  },

  agentIdentity: {
    name: { type: String, default: 'Marco' },
    surname: { type: String, default: 'Benvenuti' },
    role: { type: String, default: 'co-founder' }
  },

  messages: [messageSchema],

  context: {
    leadCategory: String,
    leadSource: { type: String, enum: ['smartlead_outbound', 'inbound_rank_checker', 'manual'] },
    objections: [String],
    painPoints: [String],
    qualificationData: mongoose.Schema.Types.Mixed,
    restaurantData: {
      name: String,
      city: String,
      rank: mongoose.Schema.Types.Mixed,
      keyword: String,
      rating: Number,
      reviewsCount: Number,
      competitors: [{ name: String, reviews: Number, rank: mongoose.Schema.Types.Mixed }],
      estimatedLostCustomers: Number,
      googleMapsLink: String
    },
    smartleadData: {
      campaignId: mongoose.Schema.Types.Mixed,
      leadId: mongoose.Schema.Types.Mixed,
      lastMessageId: String
    },
    conversationSummary: String,
    nextAction: String,
    nextActionAt: Date,
    humanNotes: [{
      note: String,
      by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      at: { type: Date, default: Date.now }
    }]
  },

  metrics: {
    messagesCount: { type: Number, default: 0 },
    agentMessagesCount: { type: Number, default: 0 },
    avgResponseTimeMinutes: Number,
    objectionsSolved: { type: Number, default: 0 },
    qualificationScore: { type: Number, default: 0, min: 0, max: 100 },
    humanInterventions: { type: Number, default: 0 }
  },

  outcome: {
    type: String,
    enum: ['sql', 'call_booked', 'nurture', 'lost', 'dnc', 'stale', null],
    default: null
  },

  assignedTo: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }
}, { timestamps: true });

conversationSchema.index({ status: 1, 'context.nextActionAt': 1 });
conversationSchema.index({ contact: 1, channel: 1 });
conversationSchema.index({ 'context.smartleadData.campaignId': 1, 'context.smartleadData.leadId': 1 });

conversationSchema.methods.addMessage = function(role, content, channel, metadata = {}) {
  this.messages.push({ role, content, channel, metadata, createdAt: new Date() });
  this.metrics.messagesCount = this.messages.length;
  if (role === 'agent') this.metrics.agentMessagesCount = (this.metrics.agentMessagesCount || 0) + 1;
  if (role === 'human') this.metrics.humanInterventions = (this.metrics.humanInterventions || 0) + 1;
  return this;
};

conversationSchema.methods.getConversationThread = function(maxMessages = 20) {
  const recent = this.messages.slice(-maxMessages);
  return recent.map(m => ({
    role: m.role === 'agent' || m.role === 'human' ? 'assistant' : 'user',
    content: m.content
  }));
};

conversationSchema.statics.findActiveByContact = function(contactId) {
  return this.findOne({ contact: contactId, status: { $in: ['active', 'awaiting_human'] } })
    .sort({ updatedAt: -1 });
};

conversationSchema.statics.findBySmartleadIds = function(campaignId, leadId) {
  return this.findOne({
    'context.smartleadData.campaignId': campaignId,
    'context.smartleadData.leadId': leadId,
    status: { $in: ['active', 'awaiting_human', 'paused'] }
  }).sort({ updatedAt: -1 });
};

conversationSchema.statics.findPendingActions = function() {
  return this.find({
    status: { $in: ['active', 'paused'] },
    'context.nextActionAt': { $lte: new Date() }
  }).populate('contact', 'name email phone properties');
};

const Conversation = mongoose.model('Conversation', conversationSchema);

export default Conversation;
