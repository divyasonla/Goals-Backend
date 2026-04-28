const mongoose = require('mongoose');

const reportSchema = new mongoose.Schema({
    username: { type: String, required: true },
    email: { type: String, required: true },
    week: { type: String, required: true },
    completionPercent: { type: Number, default: 0 },
    mainChallenges: { type: String, default: "" },
    aiFeedback: { type: String, default: "" },
    createdAt: { type: String, default: () => new Date().toISOString() }
}, { timestamps: true });

module.exports = mongoose.model('Report', reportSchema);
