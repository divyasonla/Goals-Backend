const mongoose = require('mongoose');

const dailyGoalSchema = new mongoose.Schema({
    username: { type: String, required: true },
    email: { type: String, required: true },
    dailyGoal: { type: String, required: true },
    reflection: { type: String, default: "" },
    wentWell: { type: String, default: "" },
    challenges: { type: String, default: "" },
    left: { type: String, default: "" },
    date: { type: String, required: true },
    status: { type: String, default: "Pending" }
}, { timestamps: true });

module.exports = mongoose.model('DailyGoal', dailyGoalSchema);
