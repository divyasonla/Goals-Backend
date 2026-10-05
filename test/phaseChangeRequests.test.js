const { test } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const User = require('../models/User');
const PhaseSettings = require('../models/PhaseSettings');
const PhaseHoliday = require('../models/PhaseHoliday');
const sheets = require('../utils/googleSheets');
const routes = require('../routes/authRoutes');
const { authenticate, requireStudent, requireTeacher } = require('../middleware/auth');
const curriculum = require('../config/curriculum');
const { calculatePhaseProgress } = require('../services/phaseProgressService');

const response = () => ({ statusCode: 200, payload: null, status(code) { this.statusCode = code; return this; }, json(data) { this.payload = data; return this; } });
const fakeRequest = (id = '507f1f77bcf86cd799439011') => ({ _id: id, currentPhase: 'Phase 1', phaseStartDate: '2026-10-01', timezone: 'UTC', email: 'student@example.test', role: 'student' });

test('Milestone 1 curriculum preserves all source durations, including induction and Phase 3 = 20 days', () => {
  assert.deepEqual(curriculum.phaseDurations, {
    Induction: 30, 'Phase 1': 5, 'Phase 2': 13, 'Phase 3': 20, 'Phase 4': 14,
    'Phase 5': 15, 'Phase 6': 10, 'Phase 7': 45, 'Phase 8 Final Open-ended Project': 30
  });
  assert.deepEqual(curriculum.getPhase('Phase 4').learningTopics, ['AI-Powered Content Generator', 'JavaScript ES6', 'Gemini API Introduction']);
  assert.equal(curriculum.getPhase('Phase 8 Final Open-ended Project').prerequisites, null);
  assert.match(curriculum.curriculumContext.flowchartsFccBlock.note, /NOT DEFINED IN MILESTONE 1/);
  const progress = calculatePhaseProgress({ student: { currentPhase: 'Phase 3', phaseStartDate: '2026-10-01', timezone: 'UTC' }, phaseDurations: curriculum.phaseDurations, now: new Date('2026-10-01T12:00:00Z') });
  assert.equal(progress.requiredLearningDays, 20);
});

test('legacy database phase-duration overrides do not supersede Milestone 1', async () => {
  const oldSettings = PhaseSettings.findOne;
  const oldHolidays = PhaseHoliday.find;
  PhaseSettings.findOne = () => ({ lean: async () => ({ phaseDurations: { 'Phase 3': 13 }, dueSoonWorkingDays: 4 }) });
  PhaseHoliday.find = () => ({ select() { return this; }, sort() { return this; }, lean: async () => [] });
  try {
    const calendar = await require('../controllers/phaseController').readCalendar();
    assert.equal(calendar.phaseDurations['Phase 3'], 20);
    assert.equal(calendar.phaseDurations['Phase 7'], 45);
    assert.equal(calendar.dueSoonWorkingDays, 4);
  } finally { PhaseSettings.findOne = oldSettings; PhaseHoliday.find = oldHolidays; }
});

test('the overdue scheduler also ignores legacy durations that conflict with Milestone 1', async () => {
  const oldMethods = { find: User.find, settings: PhaseSettings.findOne, holidays: PhaseHoliday.find, fetch: sheets.fetchGoalsFromSheet };
  User.find = () => ({ select() { return this; }, lean: async () => [{ _id: 's1', name: 'Student', email: 'student@example.test', currentPhase: 'Phase 3', phaseStartDate: '2026-10-01', timezone: 'UTC' }] });
  PhaseSettings.findOne = () => ({ lean: async () => ({ phaseDurations: { 'Phase 3': 1 }, dueSoonWorkingDays: 3 }) });
  PhaseHoliday.find = () => ({ select() { return this; }, lean: async () => [] });
  sheets.fetchGoalsFromSheet = async () => [];
  const notificationPath = require.resolve('../services/phaseDeadlineNotifications');
  const originalModule = require.cache[notificationPath];
  try {
    delete require.cache[notificationPath];
    const { runDailyPhaseDeadlineCheck } = require('../services/phaseDeadlineNotifications');
    const result = await runDailyPhaseDeadlineCheck({ now: new Date('2026-10-03T12:00:00Z'), transport: null });
    assert.deepEqual(result, { checked: 1, overdue: 0, sent: 0 });
  } finally {
    if (originalModule) require.cache[notificationPath] = originalModule;
    else delete require.cache[notificationPath];
    User.find = oldMethods.find; PhaseSettings.findOne = oldMethods.settings;
    PhaseHoliday.find = oldMethods.holidays; sheets.fetchGoalsFromSheet = oldMethods.fetch;
  }
});

test('student phase-change request stays pending and never writes the current phase', async () => {
  const original = User.findOneAndUpdate;
  let captured;
  User.findOneAndUpdate = (filter, update) => ({ lean: async () => {
    captured = { filter, update };
    return { phaseChangeRequests: [{ _id: new mongoose.Types.ObjectId(), status: 'PENDING', currentPhase: 'Phase 1', requestedPhase: 'Phase 2' }] };
  } });
  try {
    const controller = require('../controllers/phaseController');
    const res = response();
    await controller.createPhaseChangeRequest({ authUser: fakeRequest(), body: { requestedPhase: 'Phase 2', reason: 'Ready to apply CSS.' } }, res);
    assert.equal(res.statusCode, 201);
    assert.equal(res.payload.request.status, 'PENDING');
    assert.equal(captured.update.$push.phaseChangeRequests.currentPhase, 'Phase 1');
    assert.equal(captured.update.$set, undefined);
    assert.equal(captured.filter.phaseChangeRequests.$not.$elemMatch.status, 'PENDING');
  } finally { User.findOneAndUpdate = original; }
});

test('a student cannot create a request for an unknown phase or without a reason', async () => {
  const controller = require('../controllers/phaseController');
  const unknown = response();
  await controller.createPhaseChangeRequest({ authUser: fakeRequest(), body: { requestedPhase: 'Phase 99', reason: 'test' } }, unknown);
  assert.equal(unknown.statusCode, 400);
  const noReason = response();
  await controller.createPhaseChangeRequest({ authUser: fakeRequest(), body: { requestedPhase: 'Phase 2', reason: '  ' } }, noReason);
  assert.equal(noReason.statusCode, 400);
});

test('teacher rejection changes request status but leaves the student phase untouched', async () => {
  const originalFindOne = User.findOne;
  const originalUpdate = User.findOneAndUpdate;
  const requestId = new mongoose.Types.ObjectId();
  const request = { _id: requestId, currentPhase: 'Phase 1', requestedPhase: 'Phase 2', status: 'PENDING', reason: 'Ready' };
  User.findOne = () => ({ select: async () => ({ _id: 'student', currentPhase: 'Phase 1', phaseChangeRequests: { id: () => request } }) });
  let captured;
  User.findOneAndUpdate = (filter, update) => ({ lean: async () => { captured = { filter, update }; return { phaseChangeRequests: [{ ...request, status: 'REJECTED' }] }; } });
  try {
    const controller = require('../controllers/phaseController');
    const res = response();
    await controller.reviewPhaseChangeRequest({ params: { requestId: String(requestId) }, body: { decision: 'reject', reviewComment: 'Please continue practice.' }, authUser: { _id: 'teacher' } }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.payload.request.status, 'REJECTED');
    assert.equal(captured.update.$set.currentPhase, undefined);
    assert.equal(captured.update.$set.phaseStartDate, undefined);
  } finally { User.findOne = originalFindOne; User.findOneAndUpdate = originalUpdate; }
});

test('teacher direct assignment cannot bypass approval for an already assigned student', async () => {
  const oldFindOne = User.findOne;
  const oldSettings = PhaseSettings.findOne;
  const oldHolidays = PhaseHoliday.find;
  let saved = false;
  User.findOne = () => ({ select: async () => ({ _id: 'student', currentPhase: 'Phase 1', phaseStartDate: '2026-10-01', timezone: 'UTC', save: async () => { saved = true; } }) });
  PhaseSettings.findOne = () => ({ lean: async () => null });
  PhaseHoliday.find = () => ({ select() { return this; }, sort() { return this; }, lean: async () => [] });
  try {
    const controller = require('../controllers/phaseController');
    const res = response();
    await controller.assignStudentPhase({ params: { studentId: '507f1f77bcf86cd799439011' }, body: { phase: 'Phase 2', phaseStartDate: '2026-10-05' }, authUser: { _id: 'teacher' } }, res);
    assert.equal(res.statusCode, 409);
    assert.equal(saved, false);
  } finally { User.findOne = oldFindOne; PhaseSettings.findOne = oldSettings; PhaseHoliday.find = oldHolidays; }
});

test('teacher approval snapshots old-phase progress and atomically activates the requested phase', async () => {
  const originals = { findOne: User.findOne, update: User.findOneAndUpdate, settings: PhaseSettings.findOne, holidays: PhaseHoliday.find, fetch: sheets.fetchGoalsFromSheet };
  const requestId = new mongoose.Types.ObjectId();
  const request = { _id: requestId, currentPhase: 'Phase 1', requestedPhase: 'Phase 2', status: 'PENDING', reason: 'Ready' };
  const student = { _id: 'student', name: 'Student', email: 'student@example.test', currentPhase: 'Phase 1', phaseStartDate: '2026-10-01', timezone: 'UTC', phaseChangeRequests: { id: () => request } };
  User.findOne = () => ({ select: async () => student });
  let captured;
  User.findOneAndUpdate = (_filter, update) => ({ lean: async () => {
    captured = update;
    return { currentPhase: 'Phase 2', phaseStartDate: '2026-10-05', phaseChangeRequests: [{ ...request, status: 'APPROVED', newPhaseStartDate: '2026-10-05' }] };
  } });
  PhaseSettings.findOne = () => ({ lean: async () => null });
  PhaseHoliday.find = () => ({ select() { return this; }, sort() { return this; }, lean: async () => [] });
  sheets.fetchGoalsFromSheet = async (_email, type) => type === 'Daily' ? [
    { email: 'student@example.test', type, learningDate: '2026-10-01', phaseAtSubmission: 'Phase 1' },
    { email: 'student@example.test', type, learningDate: '2026-10-02', phaseAtSubmission: 'Phase 1' },
    { email: 'student@example.test', type, learningDate: '2026-10-02', phaseAtSubmission: 'Phase 1' }
  ] : [];
  const controllerPath = require.resolve('../controllers/phaseController');
  const oldController = require.cache[controllerPath];
  try {
    delete require.cache[controllerPath];
    const controller = require('../controllers/phaseController');
    const res = response();
    await controller.reviewPhaseChangeRequest({ params: { requestId: String(requestId) }, body: { decision: 'approve' }, authUser: { _id: 'teacher' } }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.payload.currentPhase, 'Phase 2');
    assert.equal(res.payload.phaseStartDate, '2026-10-05');
    assert.equal(captured.$push.phaseProgressHistory.learningDaysCompleted, 2);
    assert.equal(captured.$push.phaseProgressHistory.status, 'MOVED_TO_NEXT_PHASE');
    assert.equal(captured.$push.phaseProgressHistory.requiredLearningDays, 5);
    assert.equal(captured.$push.phaseAssignmentHistory.phase, 'Phase 2');
    assert.equal(captured.$set['phaseChangeRequests.$[item].status'], 'APPROVED');
  } finally {
    if (oldController) require.cache[controllerPath] = oldController;
    else delete require.cache[controllerPath];
    User.findOne = originals.findOne; User.findOneAndUpdate = originals.update;
    PhaseSettings.findOne = originals.settings; PhaseHoliday.find = originals.holidays; sheets.fetchGoalsFromSheet = originals.fetch;
  }
});

test('phase request routes reuse JWT and student/teacher authorization middleware', () => {
  const route = (path, method) => routes.stack.find((entry) => entry.route?.path === path && entry.route.methods[method])?.route;
  for (const [path, method] of [['/phase-change-requests', 'post'], ['/phase-change-requests/mine', 'get']]) {
    assert.deepEqual(route(path, method).stack.slice(0, 2).map((layer) => layer.handle), [authenticate, requireStudent]);
  }
  for (const [path, method] of [['/admin/phase-change-requests', 'get'], ['/admin/phase-change-requests/:requestId', 'patch']]) {
    assert.deepEqual(route(path, method).stack.slice(0, 2).map((layer) => layer.handle), [authenticate, requireTeacher]);
  }
});
