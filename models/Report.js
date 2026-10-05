const mongoose = require('mongoose');

const periodSchema = new mongoose.Schema({
    startDate: { type: String, required: true },
    endDate: { type: String, required: true },
    timezone: { type: String, required: true }
}, { _id: false });

const dailyGoalMetricsSchema = new mongoose.Schema({
    total: { type: Number, default: 0 },
    completed: { type: Number, default: 0 },
    inProgress: { type: Number, default: 0 },
    pending: { type: Number, default: 0 },
    completionPercent: { type: Number, default: 0 }
}, { _id: false });

const weeklyGoalMetricsSchema = new mongoose.Schema({
    total: { type: Number, default: 0 },
    completed: { type: Number, default: 0 },
    completionPercent: { type: Number, default: 0 }
}, { _id: false });

const metricsSchema = new mongoose.Schema({
    dailyGoals: { type: dailyGoalMetricsSchema, default: () => ({}) },
    weeklyGoals: { type: weeklyGoalMetricsSchema, default: () => ({}) },
    reflectionCoverage: { type: Number, default: 0 }
}, { _id: false });

const insightsSchema = new mongoose.Schema({
    summary: { type: String, default: '' },
    strengths: { type: [String], default: [] },
    learning: { type: [String], default: [] },
    challenges: { type: [String], default: [] },
    unfinished: { type: [String], default: [] },
    nextActions: { type: [String], default: [] }
}, { _id: false });

const reportSchema = new mongoose.Schema({
    username: { type: String, required: true },
    email: { type: String, required: true },
    week: { type: String, required: true },
    completionPercent: { type: Number, default: 0 },
    mainChallenges: { type: String, default: "" },
    aiFeedback: { type: String, default: "" },
    period: { type: periodSchema },
    metrics: { type: metricsSchema },
    insights: { type: insightsSchema },
    aiStatus: { type: String, enum: ['generated', 'fallback'] },
    createdAt: { type: String, default: () => new Date().toISOString() }
}, { timestamps: true });

reportSchema.index(
    { email: 1, 'period.startDate': 1, 'period.endDate': 1, 'period.timezone': 1 },
    {
        unique: true,
        partialFilterExpression: {
            'period.startDate': { $type: 'string' },
            'period.endDate': { $type: 'string' },
            'period.timezone': { $type: 'string' }
        }
    }
);

module.exports = mongoose.model('Report', reportSchema);
