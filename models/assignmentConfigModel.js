import mongoose from 'mongoose';

const sourceRuleSchema = new mongoose.Schema({
  source: {
    type: String,
    required: true,
    enum: [
      'inbound_rank_checker',
      'inbound_acquisition',
      'inbound_prova_gratuita',
      'inbound_form',
      'inbound_api',
      'smartlead_outbound',
      'referral',
    ],
  },
  strategy: {
    type: String,
    required: true,
    enum: ['specific', 'round_robin'],
  },
  // Used when strategy === 'specific'
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null,
  },
  // Used when strategy === 'round_robin' — ordered array determines rotation
  userIds: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  }],
}, { _id: false });

const assignmentConfigSchema = new mongoose.Schema({
  // Singleton document — always key === 'default'
  key: {
    type: String,
    default: 'default',
    unique: true,
  },
  // Global round-robin pool (fallback for sources without a specific rule)
  globalRoundRobin: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  }],
  sourceRules: [sourceRuleSchema],
}, { timestamps: true });

const AssignmentConfig = mongoose.model('AssignmentConfig', assignmentConfigSchema);

export default AssignmentConfig;
