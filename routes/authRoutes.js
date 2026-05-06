const express = require('express');
const { signup, login, forgotPassword, resetPassword } = require('../controllers/authController');
const {
    dailyGoalsHandler,
    weeklyGoalsHandler,
    fetchReportsHandler,
    generateReportHandler
} = require('../controllers/goalController');

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
router.post('/reset-password', resetPassword);

// Goal and Report Routes
router.post('/daily-goals', dailyGoalsHandler);
router.post('/weekly-goals', weeklyGoalsHandler);
router.post('/fetch-reports', fetchReportsHandler);
router.post('/generate-report', generateReportHandler);

module.exports = router;