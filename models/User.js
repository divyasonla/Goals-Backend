const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const phaseChangeRequestSchema = new mongoose.Schema({
  currentPhase: { type: String, required: true },
  requestedPhase: { type: String, required: true },
  reason: { type: String, required: true, trim: true, maxlength: 1000 },
  status: { type: String, enum: ['PENDING', 'APPROVED', 'REJECTED'], default: 'PENDING', required: true },
  requestedAt: { type: Date, default: Date.now, required: true },
  reviewedAt: { type: Date, default: null },
  reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  reviewComment: { type: String, trim: true, maxlength: 1000, default: '' },
  newPhaseStartDate: { type: String, match: /^\\d{4}-\\d{2}-\\d{2}$/, default: null }
}, { timestamps: false });

const phaseProgressHistorySchema = new mongoose.Schema({
  phase: { type: String, required: true },
  phaseStartDate: { type: String, required: true },
  phaseEndDate: { type: String, required: true },
  requiredLearningDays: { type: Number, required: true },
  learningDaysCompleted: { type: Number, required: true },
  learningDates: { type: [String], default: [] },
  remainingLearningDays: { type: Number, required: true },
  progressPercent: { type: Number, required: true },
  baselineDeadline: { type: String, required: true },
  currentDeadline: { type: String, required: true },
  status: { type: String, required: true },
  completedOn: { type: String, default: null },
  movedToNextPhase: { type: Boolean, default: true },
  phaseChangeRequestId: { type: mongoose.Schema.Types.ObjectId }
}, { timestamps: false });

const userSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
  },
  email: {
    type: String,
    required: true,
    unique: true,
  },
  password: {
    type: String,
    required: true,
  },
  role: {
    type: String,
    required: true,
    enum: ['student', 'teacher', 'admin', 'aa'], // Define allowed roles
  },
  currentPhase: { type: String, trim: true, maxlength: 60, default: null },
  phaseStartDate: { type: String, match: /^\d{4}-\d{2}-\d{2}$/ },
  timezone: { type: String, trim: true, maxlength: 80, default: () => process.env.REPORT_TIMEZONE || 'Asia/Kolkata' },
  phaseAssignmentHistory: [{
    phase: { type: String, required: true },
    phaseStartDate: { type: String, required: true },
    changedAt: { type: Date, default: Date.now },
    changedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }
  }],
  phaseChangeRequests: { type: [phaseChangeRequestSchema], default: [] },
  phaseProgressHistory: { type: [phaseProgressHistorySchema], default: [] },
  otpHash: { type: String, default: null },
  otpExpiresAt: { type: Date, default: null },
  otpCreatedAt: { type: Date, default: null },
  otpAttempts: { type: Number, default: 0 },
  resetToken: { type: String, default: null },
  resetExpires: { type: Date, default: null },
  // Encrypted application-managed copy of the student's Gemini API key.
  // Excluded from normal queries so it cannot leak through user responses.
  geminiApiKeyEncrypted: { type: String, select: false },
  geminiApiKeyUpdatedAt: { type: Date, select: false },
});

// Hash password before saving
userSchema.pre('save', async function () {
  if (!this.isModified('password')) return;
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
});

module.exports = mongoose.model('User', userSchema);
