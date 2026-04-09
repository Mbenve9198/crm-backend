import mongoose from 'mongoose';

const salesManagerDirectiveSchema = new mongoose.Schema({
  scope: {
    type: String,
    enum: ['strategist', 'planner', 'all'],
    required: true,
    index: true,
  },
  directive: { type: String, required: true },
  reason: String,
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
