const mongoose = require('mongoose');

const phaseDeadlineNotificationSchema = new mongoose.Schema({
  studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  phase: { type: String, required: true },
  deadline: { type: String, required: true },
  type: { type: String, enum: ['overdue'], required: true },
  sentAt: { type: Date, default: null }
}, { timestamps: true });

phaseDeadlineNotificationSchema.index({ studentId: 1, phase: 1, deadline: 1, type: 1 }, { unique: true });
module.exports = mongoose.model('PhaseDeadlineNotification', phaseDeadlineNotificationSchema);
