const mongoose = require('mongoose');

const weeklyGoalSchema = new mongoose.Schema({
    username: { type: String, required: true },
    email: { type: String, required: true },
    weeklyGoal: { type: String, required: true },
    reflection: { type: String, default: "" },
    wentWell: { type: String, default: "" },
    challenges: { type: String, default: "" },
    left: { type: String, default: "" },
    week: { type: String, required: true },
    status: { type: String, default: "Pending" }
}, { timestamps: true });

module.exports = mongoose.model('WeeklyGoal', weeklyGoalSchema);
