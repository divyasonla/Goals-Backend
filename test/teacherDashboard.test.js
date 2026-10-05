const { beforeEach, test } = require('node:test');
const assert = require('node:assert/strict');
const User = require('../models/User');
const Breakdown = require('../models/GoalTaskBreakdown');
const sheets = require('../utils/googleSheets');
const routes = require('../routes/authRoutes');
const { getTeacherDashboardOverview } = require('../controllers/teacherDashboardController');

let sourceStudents;
let dailyRows;
let weeklyRows;
let plans;
let sheetError;
let capturedFilter;
let capturedSkip;
let capturedLimit;

const responseRecorder = () => ({
  statusCode: 200,
  payload: undefined,
  status(code) { this.statusCode = code; return this; },
  json(body) { this.payload = body; return this; }
});

User.find = (filter) => {
  capturedFilter = filter;
  let matching = sourceStudents.filter((student) => {
    if (filter.$or) return filter.$or.some((condition) => {
      const field = Object.keys(condition)[0];
      return new RegExp(condition[field].$regex, condition[field].$options).test(student[field]);
    });
    return true;
  });
  const chain = {
    select() { return this; }, sort() { return this; },
    skip(value) { capturedSkip = value; return this; },
    limit(value) { capturedLimit = value; return this; },
    lean: async () => matching.slice(capturedSkip || 0, (capturedSkip || 0) + (capturedLimit || matching.length))
  };
  return chain;
};
User.countDocuments = async (filter) => {
  if (!filter.$or) return sourceStudents.length;
  return sourceStudents.filter((student) => filter.$or.some((condition) => {
    const field = Object.keys(condition)[0];
    return new RegExp(condition[field].$regex, condition[field].$options).test(student[field]);
  })).length;
};
Breakdown.find = (filter) => ({ select() { return this; }, lean: async () => plans.filter((plan) => filter.studentId.$in.some((id) => String(id) === String(plan.studentId))) });
sheets.fetchGoalsFromSheet = async (_email, type) => {
  if (sheetError) throw sheetError;
  return type === 'Daily' ? dailyRows : weeklyRows;
};

beforeEach(() => {
  sourceStudents = [
    { _id: 'student-1', name: 'Ari', email: 'ari@example.test', role: 'student' },
    { _id: 'student-2', name: 'Bina', email: 'bina@example.test', role: 'student' },
    { _id: 'teacher-1', name: 'Teacher', email: 'teacher@example.test', role: 'teacher' }
  ];
  dailyRows = [
    { email: 'ari@example.test', createdAt: '2026-10-01', status: 'Completed', reflection: 'I practiced.', wentWell: '', challenges: 'Need more time', left: '' },
    { email: 'ari@example.test', createdAt: '2026-10-02', status: 'Pending', reflection: '', wentWell: '', challenges: 'need more time', left: '' },
    { email: 'bina@example.test', createdAt: '2026-10-02', status: 'Completed', reflection: '', wentWell: 'Solved it', challenges: '', left: '' },
    { email: 'ari@example.test', createdAt: '2026-09-01', status: 'Completed' }
  ];
  weeklyRows = [{ email: 'ari@example.test', createdAt: '2026-10-02', status: 'Pending' }];
  plans = [{ studentId: 'student-1', tasks: [{ status: 'Completed' }, { status: 'Pending' }] }];
  sheetError = null;
  capturedFilter = null;
  capturedSkip = null;
  capturedLimit = null;
});

test('overview requires teacher authorization and student role is denied', () => {
  const route = routes.stack.find((layer) => layer.route?.path === '/admin/dashboard/overview').route;
  assert.equal(route.stack.length, 3);
  assert.equal(route.stack[0].handle.name, 'authenticate');
  assert.equal(route.stack[1].handle.name, 'requireTeacher');
  const denied = responseRecorder();
  route.stack[1].handle({ authUser: { role: 'student' } }, denied, () => {});
  assert.equal(denied.statusCode, 403);
});

test('overview applies server-side name/email search and pagination with exact metrics', async () => {
  const res = responseRecorder();
  await getTeacherDashboardOverview({ query: { search: 'Ari', page: '1', limit: '1', days: '7', endDate: '2026-10-03' } }, res);
  assert.equal(res.statusCode, 200);
  assert.match(capturedFilter.$or[0].name.$regex, /Ari/i);
  assert.equal(capturedSkip, 0);
  assert.equal(capturedLimit, 1);
  assert.equal(res.payload.data.totalStudents, 1);
  const data = res.payload.data;
  assert.deepEqual(data.period, { startDate: '2026-09-27', endDate: '2026-10-03' });
  assert.equal(data.students[0].goals, 3);
  assert.equal(data.students[0].completedGoals, 1);
  assert.equal(data.students[0].completionPercent, 50);
  assert.equal(data.students[0].reflections, 2);
  assert.equal(data.students[0].tasksCompleted, 1);
  assert.equal(data.students[0].tasksRemaining, 1);
  assert.deepEqual(data.commonChallenges, [{ text: 'Need more time', count: 2 }]);
  assert.equal(data.overview.reflectionCoverage, 100);
  assert.equal(JSON.stringify(data).includes('geminiApiKey'), false);
});

test('overview rejects invalid and overlong date ranges before reading Sheets', async () => {
  const res = responseRecorder();
  await getTeacherDashboardOverview({ query: { startDate: '2026-01-01', endDate: '2026-04-01' } }, res);
  assert.equal(res.statusCode, 400);
  assert.match(res.payload.error, /valid date range/);
});

test('Google Sheets failure returns a controlled error without exposing internals', async () => {
  sheetError = new Error('private spreadsheet details');
  const res = responseRecorder();
  await getTeacherDashboardOverview({ query: {} }, res);
  assert.equal(res.statusCode, 502);
  assert.doesNotMatch(JSON.stringify(res.payload), /private spreadsheet details/);
});
