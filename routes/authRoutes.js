const express = require('express');
const { signup, login, forgotPassword, resetPassword } = require('../controllers/authController');
const {
    dailyGoalsHandler,
    weeklyGoalsHandler,
    fetchReportsHandler,
    generateReportHandler
} = require('../controllers/goalController');

const router = express.Router();

// Signup Route
router.post('/signup', signup);

// Login Route
router.post('/login', login);
router.post('/forgot-password', forgotPassword);
router.post('/reset-password', resetPassword);

// Goal and Report Routes
router.post('/daily-goals', dailyGoalsHandler);
router.post('/weekly-goals', weeklyGoalsHandler);
router.post('/fetch-reports', fetchReportsHandler);
router.post('/generate-report', generateReportHandler);

module.exports = router;