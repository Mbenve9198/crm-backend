import mongoose from 'mongoose';

/**
 * Modello semplice per memorizzare lo stato di round robin
 * Esempio documento:
 * { key: 'smartlead_round_robin', lastIndex: 0 }
 */
const assignmentStateSchema = new mongoose.Schema({
  key: {
    type: String,
    required: true,
    unique: true,
    trim: true
  },
  lastIndex: {
    type: Number,
    default: 0
  }
}, {
  timestamps: true
});

assignmentStateSchema.index({ key: 1 }, { unique: true });

const AssignmentState = mongoose.model('AssignmentState', assignmentStateSchema);

export default AssignmentState;

