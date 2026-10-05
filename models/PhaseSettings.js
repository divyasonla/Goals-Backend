const mongoose = require('mongoose');
const DEFAULT_PHASE_DURATIONS = require('../config/phaseDurations');

const phaseSettingsSchema = new mongoose.Schema({
  key: { type: String, default: 'global', unique: true },
  phaseDurations: { type: mongoose.Schema.Types.Mixed, default: () => ({ ...DEFAULT_PHASE_DURATIONS }) },
  dueSoonWorkingDays: { type: Number, default: 3, min: 0, max: 30 }
}, { timestamps: true });

module.exports = mongoose.model('PhaseSettings', phaseSettingsSchema);
