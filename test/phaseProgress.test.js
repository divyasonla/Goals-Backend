const { test } = require('node:test');
const assert = require('node:assert/strict');
const routes = require('../routes/authRoutes');
const { authenticate, requireStudent, requireTeacher } = require('../middleware/auth');
const { calculatePhaseProgress, addWorkingDays, getLocalDate } = require('../services/phaseProgressService');

const student = { currentPhase: 'Phase 2', phaseStartDate: '2026-10-01', timezone: 'UTC' };
const goal = (learningDate, type = 'Daily') => ({ learningDate, createdAt: learningDate, type, phaseAtSubmission: student.currentPhase });
const datesFrom = (start, count, holidays = new Set()) => {
  const dates = [];
  for (let date = start; dates.length < count; date = new Date(Date.parse(`${date}T00:00:00Z`) + 86400000).toISOString().slice(0, 10)) {
    const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
    if (weekday !== 0 && !holidays.has(date)) dates.push(date);
  }
  return dates;
};

test('thirteen unique learning dates complete a phase; duplicate goals on a date count once', () => {
  const dates = datesFrom(student.phaseStartDate, 13);
  const progress = calculatePhaseProgress({ student, goals: [...dates.map((date) => goal(date)), goal(dates[0]), goal(dates[0])], phaseDurations: { 'Phase 2': 13 }, now: new Date('2026-10-20T12:00:00Z') });
  assert.equal(progress.learningDaysCompleted, 13);
  assert.equal(progress.remainingLearningDays, 0);
  assert.equal(progress.progressPercent, 100);
  assert.equal(progress.status, 'COMPLETED');
  assert.equal(progress.completedOn, dates[12]);
});

test('multiple saved goals on one date count once, while a later date adds one learning day', () => {
  const progress = calculatePhaseProgress({ student, goals: [
    goal('2026-10-05'), goal('2026-10-05'), goal('2026-10-05'), goal('2026-10-06')
  ], phaseDurations: { 'Phase 2': 13 }, now: new Date('2026-10-06T12:00:00Z') });
  assert.deepEqual(progress.learningDates, ['2026-10-05', '2026-10-06']);
  assert.equal(progress.learningDaysCompleted, 2);
});

test('Sunday and public holidays are excluded from learning counts and baseline deadlines', () => {
  const holidayDates = ['2026-10-02', '2026-10-04']; // Holiday on Friday and on Sunday.
  const progress = calculatePhaseProgress({ student, goals: ['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05'].map((date) => goal(date)), phaseDurations: { 'Phase 2': 4 }, holidayDates, now: new Date('2026-10-05T12:00:00Z') });
  assert.deepEqual(progress.learningDates, ['2026-10-01', '2026-10-03', '2026-10-05']);
  assert.equal(progress.baselineDeadline, '2026-10-06');
  assert.equal(addWorkingDays('2026-10-02', 2, new Set(holidayDates)), '2026-10-05');
});

test('a Monday holiday is skipped and a holiday on Sunday does not extend twice', () => {
  const mondayHoliday = calculatePhaseProgress({ student: { ...student, phaseStartDate: '2026-10-05' },
    goals: [goal('2026-10-05'), goal('2026-10-06')], phaseDurations: { 'Phase 2': 1 },
    holidayDates: ['2026-10-05'], now: new Date('2026-10-06T12:00:00Z') });
  assert.deepEqual(mondayHoliday.learningDates, ['2026-10-06']);
  assert.equal(mondayHoliday.baselineDeadline, '2026-10-06');
  assert.equal(addWorkingDays('2026-10-03', 2, new Set(['2026-10-04'])), '2026-10-05');
});

test('invalid and future goal dates are ignored without crashing', () => {
  const progress = calculatePhaseProgress({ student, goals: [
    goal('2026-02-31'), goal('not-a-date'), goal('2026-10-06')
  ], phaseDurations: { 'Phase 2': 13 }, now: new Date('2026-10-05T12:00:00Z') });
  assert.deepEqual(progress.learningDates, []);
  assert.equal(progress.learningDaysCompleted, 0);
});

test('deadline statuses distinguish not started, on track, due soon, overdue, and completed', () => {
  const base = { student, phaseDurations: { 'Phase 2': 5 } };
  assert.equal(calculatePhaseProgress({ ...base, goals: [], now: new Date('2026-10-02T12:00:00Z') }).status, 'NOT_STARTED');
  assert.equal(calculatePhaseProgress({ ...base, goals: [goal('2026-10-01')], now: new Date('2026-10-01T12:00:00Z') }).status, 'ON_TRACK');
  assert.equal(calculatePhaseProgress({ ...base, goals: [goal('2026-10-01')], now: new Date('2026-10-03T12:00:00Z') }).status, 'DUE_SOON');
  const overdue = calculatePhaseProgress({ ...base, goals: [goal('2026-10-01')], now: new Date('2026-10-08T12:00:00Z') });
  assert.equal(overdue.status, 'OVERDUE');
  assert.equal(overdue.overdueDays, 2);
  const completed = calculatePhaseProgress({ ...base, goals: datesFrom(student.phaseStartDate, 5).map((date) => goal(date)), now: new Date('2026-10-08T12:00:00Z') });
  assert.equal(completed.status, 'COMPLETED');
  assert.equal(completed.completedOn, '2026-10-06');
  assert.equal(completed.overdueDays, 0);
});

test('phase two baseline deadline independently matches the 13th working date from October 1', () => {
  // Manual calendar count: Oct 1-3 are days 1-3; skip Sunday Oct 4; Oct 5-10 are days 4-9;
  // skip Sunday Oct 11; Oct 12-15 are days 10-13.
  const progress = calculatePhaseProgress({ student, goals: [], phaseDurations: { 'Phase 2': 13 }, now: new Date('2026-10-01T12:00:00Z') });
  assert.equal(progress.baselineDeadline, '2026-10-15');
  assert.equal(progress.currentDeadline, progress.baselineDeadline);
});

test('five of thirteen learning days yields 38.46 percent and progress is capped at 100 percent', () => {
  const dates = datesFrom(student.phaseStartDate, 5);
  const partial = calculatePhaseProgress({ student, goals: dates.map((date) => goal(date)), phaseDurations: { 'Phase 2': 13 }, now: new Date('2026-10-06T12:00:00Z') });
  assert.equal(partial.learningDaysCompleted, 5);
  assert.equal(partial.remainingLearningDays, 8);
  assert.equal(partial.progressPercent, 38.46);

  const over = calculatePhaseProgress({ student, goals: [...dates, '2026-10-07'].map((date) => goal(date)), phaseDurations: { 'Phase 2': 5 }, now: new Date('2026-10-08T12:00:00Z') });
  assert.equal(over.learningDaysCompleted, 5);
  assert.equal(over.progressPercent, 100);
  assert.equal(over.status, 'COMPLETED');
  assert.equal(over.completedOn, dates[4]);
});

test('future dates and dates before the current phase start do not count', () => {
  const progress = calculatePhaseProgress({ student, goals: [goal('2026-09-30'), goal('2026-10-02'), goal('2026-10-06')], phaseDurations: { 'Phase 2': 13 }, now: new Date('2026-10-05T12:00:00Z') });
  assert.deepEqual(progress.learningDates, ['2026-10-02']);
});

test('goals without a phase snapshot and goals from a previous phase are excluded', () => {
  const progress = calculatePhaseProgress({ student, goals: [
    goal('2026-10-01'),
    { ...goal('2026-10-02'), phaseAtSubmission: 'Phase 1' },
    { learningDate: '2026-10-03' }
  ], phaseDurations: { 'Phase 2': 13 }, now: new Date('2026-10-05T12:00:00Z') });
  assert.deepEqual(progress.learningDates, ['2026-10-01']);
});

test('IANA timezone determines today without a UTC date shift', () => {
  const indiaStudent = { ...student, timezone: 'Asia/Kolkata' };
  assert.equal(getLocalDate(new Date('2026-10-05T18:45:00Z'), indiaStudent.timezone), '2026-10-06');
  const progress = calculatePhaseProgress({ student: indiaStudent, goals: [goal('2026-10-06')], phaseDurations: { 'Phase 2': 13 }, now: new Date('2026-10-05T18:45:00Z') });
  assert.equal(progress.learningDaysCompleted, 1);
});

test('students without a stored timezone use the documented India timezone fallback', () => {
  const previousTimezone = process.env.REPORT_TIMEZONE;
  delete process.env.REPORT_TIMEZONE;
  try {
    const noTimezone = { ...student, timezone: undefined };
    const progress = calculatePhaseProgress({ student: noTimezone, goals: [goal('2026-10-06')], phaseDurations: { 'Phase 2': 13 }, now: new Date('2026-10-05T18:45:00Z') });
    assert.equal(progress.timezone, 'Asia/Kolkata');
    assert.equal(progress.learningDaysCompleted, 1);
    assert.equal(getLocalDate(new Date('2026-10-05T18:45:00Z')), '2026-10-06');
  } finally {
    if (previousTimezone === undefined) delete process.env.REPORT_TIMEZONE;
    else process.env.REPORT_TIMEZONE = previousTimezone;
  }
});

test('missing assignment or duration returns safe not-configured state', () => {
  assert.equal(calculatePhaseProgress({ student: {}, phaseDurations: {} }).status, 'NOT_CONFIGURED');
});

test('phase progress routes enforce student self access and teacher authorization', () => {
  const route = (path, method) => routes.stack.find((entry) => entry.route?.path === path && entry.route.methods[method])?.route;
  const ownProgress = route('/phase-progress', 'get');
  assert.deepEqual(ownProgress.stack.slice(0, 2).map((layer) => layer.handle), [authenticate, requireStudent]);
  for (const [path, method] of [['/phase-change-requests', 'post'], ['/phase-change-requests/mine', 'get']]) {
    const studentRoute = route(path, method);
    assert.ok(studentRoute, `${method.toUpperCase()} ${path} should exist`);
    assert.deepEqual(studentRoute.stack.slice(0, 2).map((layer) => layer.handle), [authenticate, requireStudent]);
  }
  for (const [path, method] of [
    ['/admin/phase-progress', 'get'], ['/admin/phase-config', 'get'], ['/admin/phase-config', 'patch'],
    ['/admin/holidays', 'get'], ['/admin/holidays', 'post'], ['/admin/holidays/:holidayId', 'delete'],
    ['/admin/students/:studentId/phase-progress', 'get'], ['/admin/students/:studentId/phase', 'patch']
  ]) {
    const adminRoute = route(path, method);
    assert.ok(adminRoute, `${method.toUpperCase()} ${path} should exist`);
    assert.deepEqual(adminRoute.stack.slice(0, 2).map((layer) => layer.handle), [authenticate, requireTeacher]);
  }
  for (const [path, method] of [['/admin/phase-change-requests', 'get'], ['/admin/phase-change-requests/:requestId', 'patch']]) {
    const adminRoute = route(path, method);
    assert.ok(adminRoute, `${method.toUpperCase()} ${path} should exist`);
    assert.deepEqual(adminRoute.stack.slice(0, 2).map((layer) => layer.handle), [authenticate, requireTeacher]);
  }
});
