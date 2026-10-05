const { before, beforeEach, test } = require('node:test');
const assert = require('node:assert/strict');

const sheets = require('../utils/googleSheets');
let appendedRows = [];
sheets.appendGoalToSheet = async (row) => { appendedRows.push(row); return { success: true, mocked: true }; };

const genai = require('@google/genai');
let generatedResponse;
let generateError;
genai.GoogleGenAI = class MockGoogleGenAI {
    constructor() {
        this.models = {
            generateContent: async () => {
                if (generateError) throw generateError;
                return { text: generatedResponse };
            }
        };
    }
};

const { analyzeGoalHandler, analyzeReflectionHandler, dailyGoalsHandler, weeklyGoalsHandler } = require('../controllers/goalController');
const router = require('../routes/authRoutes');

const validReflectionAnalysis = {
    score: 78,
    strengths: ['You described what you completed.'],
    challenges: ['The practice task took longer than expected.'],
    suggestions: ['Include an example of what you learned.'],
    nextAction: 'Complete one more practice problem tomorrow.',
    summary: 'Your reflection includes progress and a clear area to build on.'
};

const responseRecorder = () => ({
    statusCode: 200,
    payload: undefined,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.payload = body; return this; }
});

const callHandler = async (handler, body, authUser) => {
    const res = responseRecorder();
    await handler({ body, authUser, geminiApiKey: 'test-key' }, res);
    return res;
};

const localToday = (timezone) => new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date()).reduce((parts, entry) => ({ ...parts, [entry.type]: entry.value }), {});

before(() => {
    process.env.GEMINI_API_KEY = 'test-key';
});

beforeEach(() => {
    generatedResponse = JSON.stringify(validReflectionAnalysis);
    generateError = null;
    appendedRows = [];
});

test('POST /api/auth/analyze-reflection is registered', () => {
    const registered = router.stack.some((layer) => layer.route?.path === '/analyze-reflection' && layer.route.methods.post);
    assert.equal(registered, true);
});

test('analyzes a valid reflection and returns the predictable schema', async () => {
    const res = await callHandler(analyzeReflectionHandler, {
        reflection: 'I completed the HTML forms exercise and learned when to use required fields.',
        wentWell: 'I finished three practice examples.',
        challenges: 'One validation bug took extra time.',
        left: 'Review keyboard navigation.'
    });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.payload, { success: true, analysis: validReflectionAnalysis });
});

test('rejects empty and missing reflection data', async () => {
    for (const body of [undefined, {}, { reflection: '', wentWell: '  ', challenges: '', left: '' }]) {
        const res = await callHandler(analyzeReflectionHandler, body);
        assert.equal(res.statusCode, 400);
    }
});

test('rejects incorrect reflection field types', async () => {
    const res = await callHandler(analyzeReflectionHandler, { reflection: ['not', 'text'] });
    assert.equal(res.statusCode, 400);
    assert.match(res.payload.error, /must be a string/);
});

test('rejects excessively long reflection fields and total payloads', async () => {
    const fieldTooLong = await callHandler(analyzeReflectionHandler, { reflection: 'x'.repeat(2001) });
    assert.equal(fieldTooLong.statusCode, 413);
    const totalTooLong = await callHandler(analyzeReflectionHandler, {
        reflection: 'x'.repeat(1500), wentWell: 'x'.repeat(1500), challenges: 'x'.repeat(1500)
    });
    assert.equal(totalTooLong.statusCode, 413);
});

test('returns a controlled error when Gemini fails', async () => {
    generateError = new Error('mock Gemini failure');
    const res = await callHandler(analyzeReflectionHandler, { reflection: 'I finished my work.' });
    assert.equal(res.statusCode, 503);
    assert.equal(res.payload.error, 'Reflection analysis is temporarily unavailable.');
});

test('returns a controlled error for invalid Gemini output', async () => {
    generatedResponse = JSON.stringify({ score: 110, strengths: [], challenges: [], suggestions: [], nextAction: '', summary: '' });
    const res = await callHandler(analyzeReflectionHandler, { reflection: 'I finished my work.' });
    assert.equal(res.statusCode, 503);
    assert.equal(res.payload.error, 'Reflection analysis is temporarily unavailable.');
});

test('returns a controlled error when Gemini output is not valid JSON', async () => {
    generatedResponse = 'not-json';
    const res = await callHandler(analyzeReflectionHandler, { reflection: 'I finished my work.' });
    assert.equal(res.statusCode, 503);
    assert.equal(res.payload.error, 'Reflection analysis is temporarily unavailable.');
});

test('existing daily goal submission still saves all reflection fields to the Sheets adapter', async () => {
    const res = await callHandler(dailyGoalsHandler, {
        action: 'add', email: 'student@example.test', dailyGoal: 'Complete a practice task',
        reflection: 'I completed it.', wentWell: 'I stayed focused.', challenges: 'One issue took time.', left: 'Review one item.'
    }, { currentPhase: 'Phase 2', timezone: 'Asia/Kolkata' });
    assert.equal(res.statusCode, 200);
    assert.equal(appendedRows.length, 1);
    assert.deepEqual(appendedRows[0].slice(5, 9), ['I completed it.', 'I stayed focused.', 'One issue took time.', 'Review one item.']);
    assert.equal(appendedRows[0].length, 11);
    assert.match(appendedRows[0][9], /^\d{4}-\d{2}-\d{2}$/);
    const localParts = localToday('Asia/Kolkata');
    assert.equal(appendedRows[0][9], `${localParts.year}-${localParts.month}-${localParts.day}`);
    assert.equal(appendedRows[0][10], 'Phase 2');
});

test('existing weekly goal submission still saves all reflection fields to the Sheets adapter', async () => {
    const res = await callHandler(weeklyGoalsHandler, {
        action: 'add', email: 'student@example.test', weeklyGoal: 'Complete a study plan', week: '2026-W40',
        reflection: 'I completed it.', wentWell: 'Planning helped.', challenges: 'I had limited time.', left: 'Revise notes.'
    }, { currentPhase: 'Phase 2', timezone: 'Asia/Kolkata' });
    assert.equal(res.statusCode, 200);
    assert.equal(appendedRows.length, 1);
    assert.deepEqual(appendedRows[0].slice(5, 9), ['I completed it.', 'Planning helped.', 'I had limited time.', 'Revise notes.']);
    assert.equal(appendedRows[0].length, 11);
    const weeklyLocalParts = localToday('Asia/Kolkata');
    assert.equal(appendedRows[0][9], `${weeklyLocalParts.year}-${weeklyLocalParts.month}-${weeklyLocalParts.day}`);
    assert.equal(appendedRows[0][10], 'Phase 2');
});

test('existing AI Goal Quality Checker endpoint still returns its established shape', async () => {
    generatedResponse = JSON.stringify({
        score: 80, isSpecific: true, isMeasurable: true, isClear: true,
        isAchievable: true, isTimeBound: true, reason: 'Clear plan.', improvedGoal: 'Complete three examples today.'
    });
    const res = await callHandler(analyzeGoalHandler, { goal: 'Complete three examples', timeframe: 'daily' });
    assert.equal(res.statusCode, 200);
    assert.equal(res.payload.success, true);
    assert.equal(res.payload.analysis.improvedGoal, 'Complete three examples today.');
});
