const { before, beforeEach, after, test } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

const genai = require('@google/genai');
const sheets = require('../utils/googleSheets');
let deletedRows;
sheets.deleteGoalFromSheet = async (rowIndex, type) => { deletedRows.push({ rowIndex, type }); return { success: true, mocked: true }; };
let generatedText;
let generationError;
let generationCalls;
genai.GoogleGenAI = class MockGoogleGenAI {
  constructor() {
    this.models = { generateContent: async ({ contents }) => {
      generationCalls += 1;
      if (generationError) throw generationError;
      generatedPrompt = contents;
      return { text: generatedText };
    } };
  }
};
let generatedPrompt;

const Breakdown = require('../models/GoalTaskBreakdown');
const User = require('../models/User');
const originalCreate = Breakdown.create;
const originalFindOne = Breakdown.findOne;
const originalUserFindById = User.findById;
const handlers = require('../controllers/goalController');
const authController = require('../controllers/authController');
const routes = require('../routes/authRoutes');
const jwt = require('jsonwebtoken');
const { authenticate, requireStudent, requireTeacher, authorizeReportEmail } = require('../middleware/auth');

const goalTasks = [
  { title: 'Review the relevant concepts', description: 'Review the core ideas needed for the goal.', order: 1 },
  { title: 'Practice a small example', description: 'Apply the concepts in one focused exercise.', order: 2 },
  { title: 'Build the first part', description: 'Complete the first concrete section of the work.', order: 3 },
  { title: 'Check and finish', description: 'Review what is complete and identify any remaining work.', order: 4 }
];

const responseRecorder = () => ({
  statusCode: 200, payload: undefined,
  status(code) { this.statusCode = code; return this; },
  json(body) { this.payload = body; return this; }
});

const restoreMocks = () => {
  Breakdown.create = originalCreate;
  Breakdown.findOne = originalFindOne;
  User.findById = originalUserFindById;
};

before(() => { process.env.GEMINI_API_KEY = 'test-key'; process.env.JWT_SECRET = 'test-jwt-secret'; });
after(restoreMocks);
beforeEach(() => {
  restoreMocks();
  generatedText = JSON.stringify({ tasks: goalTasks });
  generatedPrompt = '';
  deletedRows = [];
  generationError = null;
  generationCalls = 0;
});

test('POST /api/auth/breakdown-goal is protected by JWT and student role middleware', () => {
  const layer = routes.stack.find((entry) => entry.route?.path === '/breakdown-goal' && entry.route.methods.post);
  assert.ok(layer);
  assert.equal(layer.route.stack.length, 4);
});

test('existing goal and report data routes now require authentication', () => {
  for (const path of ['/daily-goals', '/weekly-goals', '/fetch-reports', '/generate-report']) {
    const route = routes.stack.find((entry) => entry.route?.path === path && entry.route.methods.post)?.route;
    assert.ok(route, `${path} should exist`);
    assert.equal(route.stack[0].handle, authenticate);
  }
});

test('creates a structured AI task breakdown and marks generated tasks as AI', async () => {
  Breakdown.create = async (record) => ({ _id: 'breakdown-1', ...record });
  const res = responseRecorder();
  await handlers.breakdownGoalHandler({ body: { goal: 'Finish a small React project', timeframe: 'weekly' }, authUser: { _id: 'student-1', name: 'Student', email: 's@example.test' }, geminiApiKey: 'test-key' }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.breakdown.tasks.length, 4);
  assert.equal(res.payload.breakdown.tasks[0].source, 'ai');
  assert.equal(res.payload.breakdown.timeframe, 'weekly');
  assert.match(generatedPrompt, /STUDENT_GOAL_JSON/);
  assert.match(generatedPrompt, /"Finish a small React project"/);
});

test('rejects missing, non-string, empty, overlong goals and invalid timeframe before Gemini', async () => {
  const cases = [
    [{ timeframe: 'daily' }, 400],
    [{ goal: 5, timeframe: 'daily' }, 400],
    [{ goal: '  ', timeframe: 'daily' }, 400],
    [{ goal: 'x'.repeat(1001), timeframe: 'daily' }, 413],
    [{ goal: 'Study', timeframe: 'monthly' }, 400]
  ];
  for (const [body, status] of cases) {
    const res = responseRecorder();
    await handlers.breakdownGoalHandler({ body, authUser: { _id: 's', name: 'S', email: 's@example.test' }, geminiApiKey: 'test-key' }, res);
    assert.equal(res.statusCode, status);
  }
  assert.equal(generationCalls, 0);
});

test('returns controlled 503 for Gemini failure, malformed output, and invalid task data', async () => {
  Breakdown.create = async () => { throw new Error('should not save invalid AI output'); };
  const invoke = async () => {
    const res = responseRecorder();
    await handlers.breakdownGoalHandler({ body: { goal: 'Learn React', timeframe: 'daily' }, authUser: { _id: 's', name: 'S', email: 's@example.test' }, geminiApiKey: 'test-key' }, res);
    assert.equal(res.statusCode, 503);
    assert.equal(res.payload.error, 'Task breakdown is temporarily unavailable.');
  };
  generationError = new Error('mock Gemini unavailable');
  await invoke();
  generationError = null;
  generatedText = 'not-json';
  await invoke();
  generatedText = JSON.stringify({ tasks: [{ title: 'Only one', description: 'Not enough tasks', order: 1 }] });
  await invoke();
});

test('student task reads and accepts are scoped to the authenticated student', async () => {
  const studentId = new mongoose.Types.ObjectId();
  const breakdownId = new mongoose.Types.ObjectId().toString();
  let capturedQuery;
  Breakdown.findOne = async (query) => { capturedQuery = query; return null; };
  const res = responseRecorder();
  await handlers.acceptTaskBreakdownHandler({ params: { breakdownId }, body: { tasks: goalTasks }, authUser: { _id: studentId } }, res);
  assert.equal(res.statusCode, 404);
  assert.equal(String(capturedQuery.studentId), String(studentId));
});

test('daily and weekly goal deletion use the existing Sheets adapter and correct tab type', async () => {
  const daily = responseRecorder();
  await handlers.dailyGoalsHandler({ body: { action: 'delete', email: 's@example.test', rowIndex: 8 } }, daily);
  const weekly = responseRecorder();
  await handlers.weeklyGoalsHandler({ body: { action: 'delete', email: 's@example.test', rowIndex: 12 } }, weekly);
  assert.equal(daily.statusCode, 200);
  assert.equal(weekly.statusCode, 200);
  assert.deepEqual(deletedRows, [{ rowIndex: 8, type: 'Daily' }, { rowIndex: 12, type: 'Weekly' }]);
});

test('admin task update marks provenance, adds audit metadata, and preserves the original goal', async () => {
  const originalGoal = 'Complete the React project';
  const taskId = new mongoose.Types.ObjectId().toString();
  const task = { title: 'Old title', description: 'Old description', order: 1, status: 'Pending', source: 'ai', audit: [], _id: taskId };
  const tasks = [task];
  tasks.id = () => task;
  const breakdown = { goal: originalGoal, tasks, save: async () => {} };
  Breakdown.findOne = async () => breakdown;
  const res = responseRecorder();
  await handlers.updateAdminTaskHandler({ params: { taskId }, body: { title: 'New title', description: 'More detail', order: 1, status: 'In Progress' }, authUser: { _id: 'teacher-1', email: 'teacher@example.test' } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(task.source, 'admin');
  assert.equal(task.audit[0].action, 'updated');
  assert.equal(breakdown.goal, originalGoal);
});

test('admin task deletion removes only the task and leaves goal/reflection data intact', async () => {
  const original = { goal: 'Complete the React project', reflection: 'I learned components.', tasks: [] };
  const taskId = new mongoose.Types.ObjectId().toString();
  const task = { order: 1, deleteOne() { original.tasks = []; } };
  original.tasks = [task];
  original.auditTrail = [];
  original.save = async () => {};
  Breakdown.findOne = async () => ({
    ...original,
    tasks: Object.assign([...original.tasks], { id: () => task, forEach: Array.prototype.forEach }),
    auditTrail: original.auditTrail,
    save: async function () { original.goal = this.goal; original.reflection = this.reflection; }
  });
  const res = responseRecorder();
  await handlers.deleteAdminTaskHandler({ params: { taskId }, authUser: { _id: 'teacher-1', email: 'teacher@example.test' } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(original.goal, 'Complete the React project');
  assert.equal(original.reflection, 'I learned components.');
});

test('server role middleware rejects the wrong database role', () => {
  const studentRes = responseRecorder();
  let advanced = false;
  requireStudent({ authUser: { role: 'teacher' } }, studentRes, () => { advanced = true; });
  assert.equal(studentRes.statusCode, 403);
  assert.equal(advanced, false);
  const teacherRes = responseRecorder();
  requireTeacher({ authUser: { role: 'student' } }, teacherRes, () => { advanced = true; });
  assert.equal(teacherRes.statusCode, 403);
});

test('student report access binds the requested email to the authenticated account', () => {
  const res = responseRecorder();
  let reachedNext = false;
  authorizeReportEmail({ body: { email: 'another@example.test' }, authUser: { role: 'student', email: 'student@example.test' } }, res, () => { reachedNext = true; });
  assert.equal(res.statusCode, 403);
  assert.equal(reachedNext, false);
  const ownRes = responseRecorder();
  const ownReq = { body: {}, authUser: { role: 'student', email: 'student@example.test' } };
  authorizeReportEmail(ownReq, ownRes, () => { reachedNext = true; });
  assert.equal(ownReq.body.email, 'student@example.test');
  assert.equal(reachedNext, true);
});

test('public signup cannot create a teacher/Admin role from a client-supplied role', async () => {
  const res = responseRecorder();
  await authController.signup({ body: { name: 'New User', email: 'new@example.test', password: 'not-a-secret', role: 'teacher' } }, res);
  assert.equal(res.statusCode, 403);
  assert.match(res.payload.message, /provisioned by an administrator/);
});

test('JWT middleware rejects unauthenticated requests and loads role from Mongo user record', async () => {
  const noToken = responseRecorder();
  await authenticate({ headers: {} }, noToken, () => {});
  assert.equal(noToken.statusCode, 401);

  const id = new mongoose.Types.ObjectId();
  User.findById = () => ({ select: async () => ({ _id: id, role: 'student', email: 's@example.test' }) });
  const token = jwt.sign({ id: String(id) }, process.env.JWT_SECRET, { expiresIn: '1m' });
  const res = responseRecorder();
  let reachedNext = false;
  await authenticate({ headers: { authorization: `Bearer ${token}` } }, res, () => { reachedNext = true; });
  assert.equal(reachedNext, true);
});
