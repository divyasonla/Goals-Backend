const { before, beforeEach, test } = require('node:test');
const assert = require('node:assert/strict');

const sheets = require('../utils/googleSheets');
let sheetFailure = null;
let dailyRows = [];
let weeklyRows = [];
sheets.fetchGoalsFromSheet = async (_email, type, options) => {
    assert.equal(options.strict, true);
    if (sheetFailure) throw sheetFailure;
    return type === 'Weekly' ? weeklyRows : dailyRows;
};

const genai = require('@google/genai');
let generatedResponse;
let generateError;
let generatedRequest;
genai.GoogleGenAI = class MockGoogleGenAI {
    constructor() {
        this.models = {
            generateContent: async (request) => {
                generatedRequest = request;
                if (generateError) throw generateError;
                return { text: generatedResponse };
            }
        };
    }
};

const Report = require('../models/Report');
let savedReport;
let upsertCalls = [];
Report.findOneAndUpdate = async (filter, update, options) => {
    upsertCalls.push({ filter, update, options });
    savedReport = { ...update.$set, _id: 'mock-report-id' };
    return savedReport;
};

const { generateReportHandler, analyzeGoalHandler, analyzeReflectionHandler, dailyGoalsHandler, weeklyGoalsHandler } = require('../controllers/goalController');
const validInsights = {
    summary: 'You made steady progress and identified a useful next step.',
    strengths: ['You completed one daily goal and reflected on the result.'],
    learning: ['The reflection describes a new approach to practice.'],
    challenges: ['One task took longer than expected.'],
    unfinished: ['Review the final exercise.'],
    nextActions: ['Schedule a short review session tomorrow.']
};

const responseRecorder = () => ({
    statusCode: 200,
    payload: undefined,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.payload = body; return this; }
});

const runReport = async (reportingTimezone = 'Asia/Kolkata') => {
    const res = responseRecorder();
    await generateReportHandler({ body: { email: 'student@example.test', username: 'Student', reportingTimezone }, geminiApiKey: 'test-key' }, res);
    return res;
};

const makeDailyGoal = (createdAt, status, data = {}) => ({
    text: `Daily task ${createdAt}`,
    createdAt,
    status,
    reflection: '',
    wentWell: '',
    challenges: '',
    left: '',
    ...data
});

const makeWeeklyGoal = (createdAt, status, data = {}) => ({
    text: `Weekly task ${createdAt}`,
    createdAt,
    status,
    reflection: '',
    wentWell: '',
    challenges: '',
    left: '',
    ...data
});

before(() => { process.env.GEMINI_API_KEY = 'test-key'; });

beforeEach(() => {
    generatedResponse = JSON.stringify(validInsights);
    generateError = null;
    generatedRequest = null;
    sheetFailure = null;
    upsertCalls = [];
    savedReport = null;
    dailyRows = [
        makeDailyGoal('2026-09-27', 'Completed', {
            reflection: 'I learned to split the task into smaller steps.',
            wentWell: 'I finished two practice problems.',
            challenges: 'I got stuck on validation.',
            left: 'Review keyboard navigation.'
        }),
        makeDailyGoal('2026-10-02', 'In Progress', { wentWell: 'I found a helpful example.' }),
        makeDailyGoal('2026-10-03', 'Pending'),
        makeDailyGoal('2026-09-26', 'Completed'),
        makeDailyGoal('2026-10-04', 'Completed')
    ];
    weeklyRows = [
        makeWeeklyGoal('2026-W40', 'Completed', {
            reflection: 'I made progress on the weekly objective.',
            wentWell: 'The study plan worked.',
            challenges: 'I had limited time.',
            left: 'Finish the last section.'
        }),
        makeWeeklyGoal('2026-W41', 'Pending'),
        makeWeeklyGoal('2026-W42', 'Completed')
    ];
});

test('report uses the previous seven calendar dates in the student timezone and an ISO week label', async (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-03T16:00:00.000Z') });
    const res = await runReport();
    assert.equal(res.statusCode, 200);
    assert.deepEqual(savedReport.period, { startDate: '2026-09-27', endDate: '2026-10-03', timezone: 'Asia/Kolkata' });
    assert.equal(savedReport.week, '2026-W40');
});

test('weekly report refuses to generate without the authenticated student Gemini key', async () => {
    const res = responseRecorder();
    await generateReportHandler({ body: { email: 'student@example.test', username: 'Student' } }, res);
    assert.equal(res.statusCode, 400);
    assert.equal(res.payload.error, 'Please add your Gemini API key to use AI features.');
    assert.equal(upsertCalls.length, 0);
});

test('includes daily and legacy-tagged weekly goals and excludes future or out-of-period rows', async (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-03T16:00:00.000Z') });
    const res = await runReport();
    assert.equal(res.statusCode, 200);
    assert.equal(savedReport.metrics.dailyGoals.total, 3);
    assert.equal(savedReport.metrics.weeklyGoals.total, 2);
    const prompt = generatedRequest.contents;
    assert.ok(prompt.includes('Daily task 2026-09-27'));
    assert.ok(prompt.includes('Weekly task 2026-W40'));
    assert.ok(!prompt.includes('Daily task 2026-09-26'));
    assert.ok(!prompt.includes('Daily task 2026-10-04'));
    assert.ok(!prompt.includes('Weekly task 2026-W42'));
});

test('sends all stored reflection fields and calculated metrics to Gemini as marked JSON data', async (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-03T16:00:00.000Z') });
    await runReport();
    const match = generatedRequest.contents.match(/BEGIN_STUDENT_DATA_JSON\n([\s\S]*?)\nEND_STUDENT_DATA_JSON/);
    assert.ok(match);
    const sourceData = JSON.parse(match[1]);
    assert.equal(sourceData.dailyGoals[0].reflection, 'I learned to split the task into smaller steps.');
    assert.equal(sourceData.dailyGoals[0].wentWell, 'I finished two practice problems.');
    assert.equal(sourceData.dailyGoals[0].challenges, 'I got stuck on validation.');
    assert.equal(sourceData.dailyGoals[0].left, 'Review keyboard navigation.');
    assert.equal(sourceData.weeklyGoals[0].weeklyGoal, 'Weekly task 2026-W40');
    assert.equal(sourceData.weeklyGoals[0].week, '2026-W40');
    assert.equal(sourceData.metrics.dailyGoals.completed, 1);
    assert.equal(sourceData.metrics.dailyGoals.inProgress, 1);
    assert.equal(sourceData.metrics.dailyGoals.pending, 1);
    assert.equal(sourceData.metrics.dailyGoals.completionPercent, 33);
    assert.equal(sourceData.metrics.weeklyGoals.completed, 1);
    assert.equal(sourceData.metrics.weeklyGoals.completionPercent, 50);
    assert.equal(sourceData.metrics.reflectionCoverage, 2);
    assert.equal(savedReport.metrics.reflectionCoverage, 2);
});

test('saves validated structured insights and maintains legacy report fields', async (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-03T16:00:00.000Z') });
    const res = await runReport();
    assert.equal(res.statusCode, 200);
    assert.equal(savedReport.aiStatus, 'generated');
    assert.deepEqual(savedReport.insights, validInsights);
    assert.equal(savedReport.aiFeedback.includes(validInsights.summary), true);
    assert.equal(savedReport.completionPercent, 33);
    assert.equal(typeof savedReport.mainChallenges, 'string');
    assert.equal(savedReport.email, 'student@example.test');
    assert.equal(savedReport.username, 'Student');
});

test('upserts the same student and exact reporting period', async (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-03T16:00:00.000Z') });
    await runReport();
    assert.equal(upsertCalls.length, 1);
    assert.equal(upsertCalls[0].options.upsert, true);
    assert.deepEqual(upsertCalls[0].filter, {
        email: 'student@example.test',
        'period.startDate': '2026-09-27',
        'period.endDate': '2026-10-03',
        'period.timezone': 'Asia/Kolkata'
    });
    assert.equal(upsertCalls[0].options.timestamps, false);
    assert.equal(upsertCalls[0].update.$setOnInsert.createdAt, '2026-10-03T16:00:00.000Z');
    assert.equal(upsertCalls[0].update.$set.updatedAt.toISOString(), '2026-10-03T16:00:00.000Z');
});

test('returns an error and does not save when Sheets cannot be read', async (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-03T16:00:00.000Z') });
    sheetFailure = new Error('mock Google Sheets failure');
    const originalError = console.error;
    console.error = () => {};
    try {
        const res = await runReport();
        assert.equal(res.statusCode, 502);
        assert.equal(res.payload.success, false);
        assert.equal(upsertCalls.length, 0);
        assert.equal(generatedRequest, null);
    } finally {
        console.error = originalError;
    }
});

test('preserves metrics and saves a clearly marked fallback when Gemini fails', async (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-03T16:00:00.000Z') });
    generateError = new Error('mock Gemini failure');
    const originalError = console.error;
    console.error = () => {};
    try {
        const res = await runReport();
        assert.equal(res.statusCode, 200);
        assert.equal(savedReport.aiStatus, 'fallback');
        assert.equal(savedReport.metrics.dailyGoals.total, 3);
        assert.match(savedReport.aiFeedback, /AI analysis is unavailable/);
    } finally {
        console.error = originalError;
    }
});

test('preserves metrics and uses fallback for malformed or schema-invalid Gemini output', async (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-03T16:00:00.000Z') });
    generatedResponse = '{malformed';
    const originalError = console.error;
    console.error = () => {};
    try {
        const malformed = await runReport();
        assert.equal(malformed.statusCode, 200);
        assert.equal(savedReport.aiStatus, 'fallback');
        generatedResponse = JSON.stringify({ ...validInsights, strengths: 'not an array' });
        const invalid = await runReport();
        assert.equal(invalid.statusCode, 200);
        assert.equal(savedReport.aiStatus, 'fallback');
        assert.equal(savedReport.metrics.dailyGoals.total, 3);
    } finally {
        console.error = originalError;
    }
});

test('rejects an invalid reporting timezone without saving a report', async () => {
    const res = await runReport('Not/A_Real_Zone');
    assert.equal(res.statusCode, 400);
    assert.equal(upsertCalls.length, 0);
});
