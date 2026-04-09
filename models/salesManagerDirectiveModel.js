import mongoose from 'mongoose';

const salesManagerDirectiveSchema = new mongoose.Schema({
  scope: {
    type: String,
    enum: ['strategist', 'planner', 'all'],
    required: true,
    index: true,
  },
  type: {
    type: String,
    enum: ['observation', 'pattern', 'recommendation'],
    default: 'observation',
  },
  directive: { type: String, required: true },
  evidence: String,
  reason: String,
  confidence: {
    type: String,
    enum: ['low', 'medium', 'high'],
    default: 'low',
  },
  dataPoints: {
    type: Number,
    default: 0,
  },
  priority: {
    type: String,
    enum: ['high', 'medium', 'low'],
    default: 'medium',
  },
  isActive: { type: Boolean, default: true, index: true },
  expiresAt: { type: Date, index: true },
  source: { type: String, default: 'sales_manager' },
}, { timestamps: true });

salesManagerDirectiveSchema.index({ isActive: 1, expiresAt: 1 });

const SalesManagerDirective = mongoose.model('SalesManagerDirective', salesManagerDirectiveSchema);

export default SalesManagerDirective;
