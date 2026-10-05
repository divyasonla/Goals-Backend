const mongoose = require('mongoose');

const auditSchema = new mongoose.Schema({
  action: { type: String, enum: ['updated', 'deleted'], required: true },
  taskId: { type: String },
  actorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  actorEmail: { type: String, required: true },
  timestamp: { type: Date, default: Date.now }
}, { _id: false });

const taskSchema = new mongoose.Schema({
  title: { type: String, required: true, trim: true, maxlength: 200 },
  description: { type: String, required: true, trim: true, maxlength: 600 },
  order: { type: Number, required: true, min: 1 },
  status: { type: String, enum: ['Pending', 'In Progress', 'Completed'], default: 'Pending' },
  source: { type: String, enum: ['ai', 'student', 'admin'], default: 'ai' },
  sourceTaskId: { type: String, default: null },
  audit: { type: [auditSchema], default: [] }
});

const breakdownSchema = new mongoose.Schema({
  studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  studentName: { type: String, required: true },
  studentEmail: { type: String, required: true, index: true },
  goal: { type: String, required: true, maxlength: 1000 },
  timeframe: { type: String, enum: ['daily', 'weekly'], required: true },
  tasks: { type: [taskSchema], default: [] },
  auditTrail: { type: [auditSchema], default: [] },
  accepted: { type: Boolean, default: false },
  expiresAt: { type: Date, expires: 0, default: null }
}, { timestamps: true });

module.exports = mongoose.model('GoalTaskBreakdown', breakdownSchema);
