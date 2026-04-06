import mongoose from 'mongoose';

const outboundMessageJobSchema = new mongoose.Schema({
  contact: { type: mongoose.Schema.Types.ObjectId, ref: 'Contact', required: true, index: true },
  conversation: { type: mongoose.Schema.Types.ObjectId, ref: 'Conversation', required: true, index: true },

  channel: { type: String, enum: ['whatsapp'], default: 'whatsapp' },
  attemptType: { type: String, enum: ['first_touch', 'follow_up_no_reply', 'other'], default: 'other', index: true },

  messageText: { type: String, required: true, maxLength: 2000 },

  // WhatsApp send mode: freeform (window) or template (out of window / first contact)
  sendMode: { type: String, enum: ['freeform', 'template'], required: true, index: true },

  // Twilio Content API
  twilioContentSid: { type: String, default: null, index: true },
  twilioTemplateName: { type: String, default: null },
  approvalStatus: { type: String, enum: ['not_requested', 'pending', 'approved', 'rejected', 'timeout'], default: 'not_requested', index: true },
  approvalRequestedAt: { type: Date, default: null },

  // Delivery status
  sendStatus: { type: String, enum: ['queued', 'sending', 'sent', 'failed', 'skipped', 'cancelled'], default: 'queued', index: true },
  twilioMessageSid: { type: String, default: null },
  sentAt: { type: Date, default: null },

  // Dedup / cancel conditions
  cancelIfInboundAfter: { type: Date, default: null }, // if any inbound after this, skip

  attempts: { type: Number, default: 0 },
  maxAttempts: { type: Number, default: 10 },
  nextRetryAt: { type: Date, default: () => new Date() , index: true },
  lastError: { type: String, default: null },
}, { timestamps: true });

outboundMessageJobSchema.index({ sendStatus: 1, nextRetryAt: 1 });
outboundMessageJobSchema.index({ conversation: 1, sendStatus: 1 });

outboundMessageJobSchema.statics.findDueJobs = function(limit = 20) {
  return this.find({
    sendStatus: { $in: ['queued', 'failed'] },
    nextRetryAt: { $lte: new Date() },
    attempts: { $lt: 10 }
  })
    .populate('contact', 'name email phone')
    .populate('conversation')
    .sort({ nextRetryAt: 1 })
    .limit(limit);
};

const OutboundMessageJob = mongoose.model('OutboundMessageJob', outboundMessageJobSchema);
export default OutboundMessageJob;

