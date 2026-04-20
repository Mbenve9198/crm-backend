import mongoose from 'mongoose';

const SOURCE_ENUM = [
  'inbound_rank_checker',
  'inbound_acquisition',
  'inbound_prova_gratuita',
  'inbound_menu_landing',
  'inbound_social_proof',
  'inbound_qr_recensioni',
  'smartlead_outbound',
  'referral',
];

const sourceRuleSchema = new mongoose.Schema({
  sources: [{
    type: String,
    enum: SOURCE_ENUM,
  }],
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
