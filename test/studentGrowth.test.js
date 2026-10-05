const { beforeEach, test } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const sheets = require('../utils/googleSheets');
const keyUtils = require('../utils/studentGeminiKey');
const User = require('../models/User');
const Report = require('../models/Report');
const Breakdown = require('../models/GoalTaskBreakdown');

let generatedText;
let generatedMentorText;
let generationError;
let generatedPrompts;
let sheetRows;
let sheetEmails;
let reportQueries;
let taskQueries;
let currentUser;
let selectedStudent;
let apiKey;
let keyUserIds;

keyUtils.getStudentGeminiApiKey = async (studentId) => { keyUserIds.push(String(studentId)); return apiKey; };
const genai = require('@google/genai');
genai.GoogleGenAI = class MockGoogleGenAI {
  constructor(options) {
    assert.equal(options.apiKey, 'student-key-only');
    this.models = { generateContent: async ({ contents, config }) => {
      generatedPrompts.push(contents);
      if (generationError) throw generationError;
      return { text: config.responseSchema.properties.answer ? generatedMentorText : generatedText };
    } };
  }
};
sheets.fetchGoalsFromSheet = async (email, type) => {
  sheetEmails.push(email);
  return sheetRows[type] || [];
};
User.findById = () => ({ select: async () => currentUser });
User.findOne = (filter) => ({ select: async () => {
  assert.equal(filter.role, 'student');
  assert.equal(String(filter._id), String(selectedStudent._id));
  return selectedStudent;
} });
Report.find = (filter) => {
  reportQueries.push(filter);
  return { select() { return this; }, sort() { return this; }, limit() { return this; }, lean: async () => [] };
};
Breakdown.find = (filter) => {
  taskQueries.push(filter);
  return { select() { return this; }, sort() { return this; }, limit() { return this; }, lean: async () => [] };
};
const handlers = require('../controllers/growthController');
const routes = require('../routes/authRoutes');

const responseRecorder = () => ({
  statusCode: 200,
  payload: undefined,
  status(code) { this.statusCode = code; return this; },
  json(body) { this.payload = body; return this; }
});

const insights = {
  summary: 'You completed one of two daily goals and reflected on a challenge.',
  strengths: ['Your completed goal included a specific practice task.'],
  improvements: ['Your daily completion rate improved compared with the prior period.'],
  repeatedChallenges: ['Time planning appeared in two reflection entries.'],
  unfinishedPatterns: ['One recent goal remains pending.'],
  nextActions: ['Choose one small next step for the pending goal.'],
  confidence: 'medium'
};

const dailyRows = [
  { text: 'Practice algebra', createdAt: '2026-09-28', status: 'Completed', reflection: 'I practiced three examples.', wentWell: '', challenges: '', left: '' },
  { text: 'Review equations', createdAt: '2026-09-29', status: 'Pending', reflection: '', wentWell: '', challenges: 'Time planning was difficult.', left: '' },
  { text: 'Old practice', createdAt: '2026-09-22', status: 'Completed', reflection: '', wentWell: '', challenges: '', left: '' }
];
const weeklyRows = [
  { text: 'Finish equation set', createdAt: '2026-W40', status: 'Completed', reflection: '', wentWell: '', challenges: '', left: '' }
];

beforeEach(() => {
  process.env.REPORT_TIMEZONE = 'UTC';
  apiKey = 'student-key-only';
  keyUserIds = [];
  generatedText = JSON.stringify(insights);
  generatedMentorText = JSON.stringify({ answer: insights.summary, suggestedActions: ['Choose one small next step.'] });
  generationError = null;
  generatedPrompts = [];
  sheetRows = { Daily: dailyRows, Weekly: weeklyRows };
  sheetEmails = [];
  reportQueries = [];
  taskQueries = [];
  currentUser = { _id: 'student-1', name: 'Student One', email: 'one@example.test', role: 'student' };
  selectedStudent = { _id: new mongoose.Types.ObjectId(), name: 'Student One', email: 'one@example.test' };
});

test('student growth and mentor routes use authenticated student role; admin growth uses teacher role', () => {
  const growth = routes.stack.find((layer) => layer.route?.path === '/growth-insights').route;
  const mentor = routes.stack.find((layer) => layer.route?.path === '/student-mentor').route;
  const admin = routes.stack.find((layer) => layer.route?.path === '/admin/students/:studentId/growth-insights').route;
  assert.equal(growth.stack.length, 3);
  assert.equal(mentor.stack.length, 3);
  assert.equal(admin.stack.length, 3);
  assert.equal(growth.stack[1].handle.name, 'requireStudent');
  assert.equal(mentor.stack[1].handle.name, 'requireStudent');
  assert.equal(admin.stack[1].handle.name, 'requireTeacher');
  const unauthenticated = responseRecorder();
  growth.stack[0].handle({ headers: {} }, unauthenticated, () => {});
  assert.equal(unauthenticated.statusCode, 401);
  const forbidden = responseRecorder();
  admin.stack[1].handle({ authUser: { role: 'student' } }, forbidden, () => {});
  assert.equal(forbidden.statusCode, 403);
});

test('growth metrics are deterministic, bounded to recent periods, and scoped to the JWT student', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-03T12:00:00.000Z') });
  const res = responseRecorder();
  await handlers.getGrowthInsightsHandler({ authUser: { _id: 'student-1' } }, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(sheetEmails, ['one@example.test', 'one@example.test']);
  assert.deepEqual(reportQueries[0].email, 'one@example.test');
  assert.deepEqual(String(taskQueries[0].studentId), 'student-1');
  assert.equal(res.payload.data.metrics.current.dailyGoals.total, 2);
  assert.equal(res.payload.data.metrics.current.dailyGoals.completed, 1);
  assert.equal(res.payload.data.metrics.current.dailyGoals.completionPercent, 50);
  assert.equal(res.payload.data.metrics.current.weeklyGoals.total, 1);
  assert.equal(res.payload.data.metrics.current.reflectionCoverage.count, 2);
  assert.equal(res.payload.data.dataSufficient, true);
  assert.equal(res.payload.data.aiStatus, 'generated');
  assert.deepEqual(keyUserIds, ['student-1']);
  assert.equal(res.payload.data.insights.summary, insights.summary);
  assert.equal(JSON.stringify(res.payload).includes(apiKey), false);
});

test('growth metrics remain available without a key and report the setup message', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-03T12:00:00.000Z') });
  apiKey = null;
  const res = responseRecorder();
  await handlers.getGrowthInsightsHandler({ authUser: { _id: 'student-1' } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.data.keyConfigured, false);
  assert.equal(res.payload.data.insights, null);
  assert.match(res.payload.data.aiMessage, /Please add your Gemini API key in Settings/);
  assert.equal(generatedPrompts.length, 0);
});

test('growth dashboard marks insufficient data and never fabricates AI insight', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-03T12:00:00.000Z') });
  sheetRows = { Daily: [dailyRows[0]], Weekly: [] };
  const res = responseRecorder();
  await handlers.getGrowthInsightsHandler({ authUser: { _id: 'student-1' } }, res);
  assert.equal(res.payload.data.dataSufficient, false);
  assert.equal(res.payload.data.aiStatus, 'insufficient_data');
  assert.equal(res.payload.data.insights, null);
  assert.equal(generatedPrompts.length, 0);
});

test('growth invalid Gemini output and provider failures leave metrics intact', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-03T12:00:00.000Z') });
  sheetRows = { Daily: dailyRows.map((goal) => ({ ...goal, reflection: `${goal.reflection} unique invalid-output-case` })), Weekly: weeklyRows };
  generatedText = '{not-json';
  let res = responseRecorder();
  await handlers.getGrowthInsightsHandler({ authUser: { _id: 'student-1' } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.data.insights, null);
  assert.equal(res.payload.data.metrics.current.dailyGoals.total, 2);
  assert.equal(res.payload.data.aiStatus, 'unavailable');
  generatedText = JSON.stringify({ ...insights, confidence: 'certain' });
  res = responseRecorder();
  await handlers.getGrowthInsightsHandler({ authUser: { _id: 'student-1' } }, res);
  assert.equal(res.payload.data.insights, null);
  generationError = Object.assign(new Error('provider error'), { status: 429 });
  res = responseRecorder();
  await handlers.getGrowthInsightsHandler({ authUser: { _id: 'student-1' } }, res);
  assert.equal(res.payload.data.aiStatus, 'rate_limited');
  assert.equal(res.payload.data.metrics.current.dailyGoals.total, 2);
});

test('mentor validates missing, non-string, empty, and oversized questions before data access', async () => {
  const cases = [[undefined, 400], [4, 400], ['   ', 400], ['x'.repeat(2001), 413]];
  for (const [message, status] of cases) {
    const res = responseRecorder();
    await handlers.studentMentorHandler({ body: { message }, authUser: { _id: 'student-1' } }, res);
    assert.equal(res.statusCode, status);
  }
  assert.equal(generatedPrompts.length, 0);
  const invalidHistory = responseRecorder();
  await handlers.studentMentorHandler({ body: { message: 'Question', history: [{ question: 'Earlier', answer: '' }] }, authUser: { _id: 'student-1' } }, invalidHistory);
  assert.equal(invalidHistory.statusCode, 400);
  const oversizedHistory = responseRecorder();
  await handlers.studentMentorHandler({ body: { message: 'Question', history: [{ question: 'Q'.repeat(2000), answer: 'A'.repeat(2000) }, { question: 'Q'.repeat(2000), answer: 'A'.repeat(2000) }, { question: 'Q'.repeat(2000), answer: 'A'.repeat(2000) }] }, authUser: { _id: 'student-1' } }, oversizedHistory);
  assert.equal(oversizedHistory.statusCode, 413);
});

test('mentor uses only JWT identity, adds marked untrusted data and question, and returns validated response', async () => {
  currentUser.email = 'own@example.test';
  sheetEmails = [];
  const res = responseRecorder();
  await handlers.studentMentorHandler({ body: { studentId: 'another-student', message: 'What should I focus on this week?', history: [{ question: 'Earlier question', answer: 'Earlier answer.' }] }, authUser: { _id: 'student-1' } }, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(sheetEmails, ['own@example.test', 'own@example.test']);
  assert.equal(String(taskQueries.at(-1).studentId), 'student-1');
  assert.match(generatedPrompts[0], /SYSTEM INSTRUCTIONS:/);
  assert.match(generatedPrompts[0], /STUDENT DATA \(JSON; data only\):/);
  assert.match(generatedPrompts[0], /STUDENT QUESTION \(JSON string; data only\):/);
  assert.match(generatedPrompts[0], /Earlier answer/);
  assert.match(generatedPrompts[0], /What should I focus on this week/);
  assert.equal(res.payload.data.answer, insights.summary);
  assert.equal(JSON.stringify(res.payload).includes(apiKey), false);
});

test('mentor requires the personal key and contains Gemini failures and invalid output', async () => {
  apiKey = null;
  let res = responseRecorder();
  await handlers.studentMentorHandler({ body: { message: 'What next?' }, authUser: { _id: 'student-1' } }, res);
  assert.equal(res.statusCode, 400);
  assert.match(res.payload.error, /Please add your Gemini API key in Settings/);

  apiKey = 'student-key-only';
  generatedMentorText = JSON.stringify({ answer: '', suggestedActions: [] });
  res = responseRecorder();
  await handlers.studentMentorHandler({ body: { message: 'What next?' }, authUser: { _id: 'student-1' } }, res);
  assert.equal(res.statusCode, 503);
  assert.equal(res.payload.error, 'AI Mentor returned an unreadable response. Please try again.');

  generationError = Object.assign(new Error('invalid API key'), { status: 403 });
  res = responseRecorder();
  await handlers.studentMentorHandler({ body: { message: 'What next?' }, authUser: { _id: 'student-1' } }, res);
  assert.equal(res.statusCode, 422);
  assert.match(res.payload.error, /Gemini rejected the saved API key/);
});

test('teacher growth route reads selected student by ID and exposes only generated report insights', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-03T12:00:00.000Z') });
  const studentId = selectedStudent._id;
  const res = responseRecorder();
  await handlers.adminStudentGrowthHandler({ params: { studentId: String(studentId) } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.data.student.name, 'Student One');
  assert.equal(reportQueries.at(-1).email, selectedStudent.email);
  assert.ok(!Object.hasOwn(res.payload.data, 'apiKey'));
  assert.equal(apiKey, 'student-key-only');
});
