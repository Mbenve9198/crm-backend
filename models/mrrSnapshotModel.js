import mongoose from 'mongoose';

const movementSchema = new mongoose.Schema({
  contactId: { type: mongoose.Schema.Types.ObjectId, ref: 'Contact' },
  contactName: String,
  contactEmail: String,
  type: {
    type: String,
    enum: ['new', 'reactivation', 'expansion', 'contraction', 'voluntary_churn', 'delinquent_churn'],
    required: true,
  },
  previousMrr: { type: Number, default: 0 },
  currentMrr: { type: Number, default: 0 },
  delta: { type: Number, required: true },
  planName: String,
}, { _id: false });

const planBreakdownSchema = new mongoose.Schema({
  planName: { type: String, required: true },
  customers: { type: Number, default: 0 },
  mrr: { type: Number, default: 0 },
}, { _id: false });

const mrrSnapshotSchema = new mongoose.Schema({
  month: { type: String, required: true, unique: true, index: true }, // "YYYY-MM"
  snapshotDate: { type: Date, required: true },

  // MRR movements (in EUR, not cents)
  newMrr: { type: Number, default: 0 },
  reactivationMrr: { type: Number, default: 0 },
  expansionMrr: { type: Number, default: 0 },
  contractionMrr: { type: Number, default: 0 },
  voluntaryChurnMrr: { type: Number, default: 0 },
  delinquentChurnMrr: { type: Number, default: 0 },
  existingMrr: { type: Number, default: 0 },
  totalMrr: { type: Number, default: 0 },

  // Customer counts
  totalCustomers: { type: Number, default: 0 },
  newCustomers: { type: Number, default: 0 },
  reactivatedCustomers: { type: Number, default: 0 },
  churnedCustomers: { type: Number, default: 0 },

  planBreakdown: [planBreakdownSchema],
  movements: [movementSchema],
}, { timestamps: true });

export default mongoose.model('MrrSnapshot', mrrSnapshotSchema);
