const mongoose = require('mongoose');

const goalAuditLogSchema = new mongoose.Schema({
  action: {
    type: String,
    enum: ['GOAL_UPDATED', 'GOAL_DELETED'],
    required: true
  },
  studentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  studentEmail: {
    type: String,
    required: true
  },
  goalId: {
    type: String,
    required: true
  },
  timeframe: {
    type: String,
    enum: ['daily', 'weekly'],
    required: true
  },
  performedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  performedByEmail: {
    type: String,
    required: true
  },
  performedAt: {
    type: Date,
    default: Date.now,
    required: true
  },
  details: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  }
}, { timestamps: false });

module.exports = mongoose.model('GoalAuditLog', goalAuditLogSchema);
