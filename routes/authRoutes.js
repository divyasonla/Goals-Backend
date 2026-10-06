const express = require('express');
const { signup, login, forgotPassword, verifyOtp, resetPassword } = require('../controllers/authController');
const { getGeminiKeySettings, saveGeminiKeySettings, deleteGeminiKeySettings } = require('../controllers/settingsController');
const {
    analyzeGoalHandler,
    analyzeReflectionHandler,
    dailyGoalsHandler,
    weeklyGoalsHandler,
    fetchReportsHandler,
    generateReportHandler,
    breakdownGoalHandler,
    getMyTaskBreakdownsHandler,
    acceptTaskBreakdownHandler,
    listAdminStudentsHandler,
    getAdminStudentGoalsHandler,
    updateAdminStudentGoalHandler,
    deleteAdminStudentGoalHandler,
    updateAdminTaskHandler,
    deleteAdminTaskHandler
} = require('../controllers/goalController');
const { authenticate, requireStudent, requireTeacher, requirePersonalGeminiKey, authorizeGoalSheetRequest, authorizeReportEmail } = require('../middleware/auth');
const { getGrowthInsightsHandler, studentMentorHandler, adminStudentGrowthHandler } = require('../controllers/growthController');
const { getTeacherDashboardOverview } = require('../controllers/teacherDashboardController');
const phaseController = require('../controllers/phaseController');

const router = express.Router();

const validateSignup = (req, res, next) => {
  const { name, email, password } = req.body || {};
  if (!name || !email || !password) {
    return res.status(400).json({ message: 'All fields are required' });
  }
  next();
};

const validateLogin = (req, res, next) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ message: 'Email and password are required' });
  }
  next();
};

// Signup Route
router.post('/signup', validateSignup, signup);

// Login Route
router.post('/login', validateLogin, login);
router.post('/forgot-password', forgotPassword);
router.post('/verify-otp', verifyOtp);
router.post('/reset-password', resetPassword);

// Goal and Report Routes
router.post('/analyze-goal', authenticate, requireStudent, requirePersonalGeminiKey, analyzeGoalHandler);
router.post('/analyze-reflection', authenticate, requireStudent, requirePersonalGeminiKey, analyzeReflectionHandler);
router.post('/daily-goals', authenticate, authorizeGoalSheetRequest('Daily'), dailyGoalsHandler);
router.post('/weekly-goals', authenticate, authorizeGoalSheetRequest('Weekly'), weeklyGoalsHandler);
router.post('/fetch-reports', authenticate, authorizeReportEmail, fetchReportsHandler);
router.post('/generate-report', authenticate, requireStudent, authorizeReportEmail, requirePersonalGeminiKey, generateReportHandler);

// New task-management routes use the existing JWT and database user role.
router.post('/breakdown-goal', authenticate, requireStudent, requirePersonalGeminiKey, breakdownGoalHandler);
router.post('/task-breakdowns/mine', authenticate, requireStudent, getMyTaskBreakdownsHandler);
router.post('/task-breakdowns/:breakdownId/accept', authenticate, requireStudent, acceptTaskBreakdownHandler);
router.get('/growth-insights', authenticate, requireStudent, getGrowthInsightsHandler);
router.get('/phase-progress', authenticate, requireStudent, phaseController.getMyPhaseProgress);
router.get('/phase-change-requests/mine', authenticate, requireStudent, phaseController.getMyPhaseChangeRequests);
router.post('/phase-change-requests', authenticate, requireStudent, phaseController.createPhaseChangeRequest);
router.post('/student-mentor', authenticate, requireStudent, studentMentorHandler);
router.get('/admin/students', authenticate, requireTeacher, listAdminStudentsHandler);
router.get('/admin/dashboard/overview', authenticate, requireTeacher, getTeacherDashboardOverview);
router.get('/admin/phase-progress', authenticate, requireTeacher, phaseController.getAdminPhaseProgressList);
router.get('/admin/phase-change-requests', authenticate, requireTeacher, phaseController.listPhaseChangeRequests);
router.patch('/admin/phase-change-requests/:requestId', authenticate, requireTeacher, phaseController.reviewPhaseChangeRequest);
router.get('/admin/phase-config', authenticate, requireTeacher, phaseController.getPhaseConfig);
router.patch('/admin/phase-config', authenticate, requireTeacher, phaseController.updatePhaseConfig);
router.get('/admin/holidays', authenticate, requireTeacher, phaseController.listHolidays);
router.post('/admin/holidays', authenticate, requireTeacher, phaseController.addHoliday);
router.delete('/admin/holidays/:holidayId', authenticate, requireTeacher, phaseController.deleteHoliday);
router.get('/admin/students/:studentId/goals', authenticate, requireTeacher, getAdminStudentGoalsHandler);
router.patch('/admin/students/:studentId/goals/:goalId', authenticate, requireTeacher, updateAdminStudentGoalHandler);
router.delete('/admin/students/:studentId/goals/:goalId', authenticate, requireTeacher, deleteAdminStudentGoalHandler);
router.patch('/admin/goals/:goalId', authenticate, requireTeacher, updateAdminStudentGoalHandler);
router.delete('/admin/goals/:goalId', authenticate, requireTeacher, deleteAdminStudentGoalHandler);
router.get('/admin/students/:studentId/growth-insights', authenticate, requireTeacher, adminStudentGrowthHandler);
router.get('/admin/students/:studentId/phase-progress', authenticate, requireTeacher, phaseController.getAdminStudentPhaseProgress);
router.patch('/admin/students/:studentId/phase', authenticate, requireTeacher, phaseController.assignStudentPhase);
router.patch('/admin/tasks/:taskId', authenticate, requireTeacher, updateAdminTaskHandler);
router.delete('/admin/tasks/:taskId', authenticate, requireTeacher, deleteAdminTaskHandler);

router.get('/settings/gemini-key', authenticate, requireStudent, getGeminiKeySettings);
router.put('/settings/gemini-key', authenticate, requireStudent, saveGeminiKeySettings);
router.delete('/settings/gemini-key', authenticate, requireStudent, deleteGeminiKeySettings);

module.exports = router;
