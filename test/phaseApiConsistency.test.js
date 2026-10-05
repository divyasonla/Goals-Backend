const { test } = require('node:test');
const assert = require('node:assert/strict');

const User = require('../models/User');
const PhaseSettings = require('../models/PhaseSettings');
const PhaseHoliday = require('../models/PhaseHoliday');
const sheets = require('../utils/googleSheets');

test('student and Team progress APIs return identical calculations for the same student', async () => {
  const oldMethods = {
    userFind: User.find,
    userFindById: User.findById,
    settingsFindOne: PhaseSettings.findOne,
    holidayFind: PhaseHoliday.find,
    fetchGoals: sheets.fetchGoalsFromSheet,
  };
  const phaseControllerPath = require.resolve('../controllers/phaseController');
  const oldControllerModule = require.cache[phaseControllerPath];
  const student = {
    _id: '507f1f77bcf86cd799439011', name: 'Ari', email: 'ari@example.test', role: 'student',
    currentPhase: 'Phase 2', phaseStartDate: '2000-01-01', timezone: 'UTC', phaseProgressHistory: [], phaseChangeRequests: []
  };
  const rows = [
    { email: 'ARI@example.test', type: 'Daily', learningDate: '2026-10-01', phaseAtSubmission: 'Phase 2' },
    { email: 'ari@example.test', type: 'Weekly', learningDate: '2026-10-02', phaseAtSubmission: 'Phase 2' },
  ];
  try {
    PhaseSettings.findOne = () => ({ lean: async () => null });
    PhaseHoliday.find = () => ({ select() { return this; }, sort() { return this; }, lean: async () => [] });
    User.find = () => ({ select() { return this; }, sort() { return this; }, lean: async () => [student] });
    User.findById = () => ({ select() { return this; }, lean: async () => student });
    sheets.fetchGoalsFromSheet = async (email, type) => rows.filter((goal) => goal.type === type && (!email || goal.email.toLowerCase() === email.toLowerCase()));

    delete require.cache[phaseControllerPath];
    const controller = require('../controllers/phaseController');
    const response = () => ({ statusCode: 200, payload: null, status(code) { this.statusCode = code; return this; }, json(data) { this.payload = data; return this; } });
    const studentResponse = response();
    await controller.getMyPhaseProgress({ authUser: student }, studentResponse);
    const teamResponse = response();
    await controller.getAdminPhaseProgressList({ query: {} }, teamResponse);

    assert.equal(studentResponse.statusCode, 200);
    assert.equal(teamResponse.statusCode, 200);
    const studentProgress = { ...studentResponse.payload.data };
    delete studentProgress.holidays;
    delete studentProgress.phaseHistory;
    delete studentProgress.phaseChangeRequests;
    delete studentProgress.curriculum;
    assert.deepEqual(teamResponse.payload.data.students[0].progress, studentProgress);
  } finally {
    User.find = oldMethods.userFind;
    User.findById = oldMethods.userFindById;
    PhaseSettings.findOne = oldMethods.settingsFindOne;
    PhaseHoliday.find = oldMethods.holidayFind;
    sheets.fetchGoalsFromSheet = oldMethods.fetchGoals;
    if (oldControllerModule) require.cache[phaseControllerPath] = oldControllerModule;
    else delete require.cache[phaseControllerPath];
  }
});
