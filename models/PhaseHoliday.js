const mongoose = require('mongoose');

const phaseHolidaySchema = new mongoose.Schema({
  date: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/, unique: true },
  name: { type: String, required: true, trim: true, maxlength: 120 },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }
}, { timestamps: true });

module.exports = mongoose.model('PhaseHoliday', phaseHolidaySchema);
