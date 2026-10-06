const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { fetchGoalsFromSheet } = require('../utils/googleSheets');
const { getStudentGeminiApiKey } = require('../utils/studentGeminiKey');

const authenticate = async (req, res, next) => {
  const authorization = req.headers.authorization || '';
  const [scheme, token] = authorization.split(' ');
  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ success: false, error: 'Authentication required.' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.id).select('_id name email role currentPhase phaseStartDate timezone');
    if (!user) return res.status(401).json({ success: false, error: 'Authentication required.' });
    req.authUser = user;
    return next();
  } catch {
    return res.status(401).json({ success: false, error: 'Authentication required.' });
  }
};

const requireStudent = (req, res, next) => {
  if (req.authUser?.role !== 'student') {
    return res.status(403).json({ success: false, error: 'Student access required.' });
  }
  return next();
};

const requireTeacher = (req, res, next) => {
  const role = String(req.authUser?.role || '').toLowerCase();
  if (!['teacher', 'admin', 'aa'].includes(role)) {
    return res.status(403).json({ success: false, error: 'Teacher/Admin access required.' });
  }
  return next();
};

const requirePersonalGeminiKey = async (req, res, next) => {
  try {
    const apiKey = await getStudentGeminiApiKey(req.authUser._id);
    if (!apiKey) {
      return res.status(400).json({ success: false, error: 'Please add your Gemini API key to use AI features.' });
    }
    req.geminiApiKey = apiKey;
    return next();
  } catch (error) {
    console.error('Student Gemini key could not be loaded:', error?.name || 'key storage error');
    return res.status(503).json({ success: false, error: 'Unable to securely load your Gemini API key.' });
  }
};

const bindStudentEmail = (req, res) => {
  if (req.authUser?.role !== 'student') return true;
  const requestedEmail = req.body?.email;
  if (requestedEmail !== undefined && (typeof requestedEmail !== 'string' || requestedEmail.toLowerCase() !== req.authUser.email.toLowerCase())) {
    res.status(403).json({ success: false, error: 'You may access only your own student data.' });
    return false;
  }
  req.body = { ...(req.body || {}), email: req.authUser.email };
  return true;
};

const authorizeGoalSheetRequest = (type) => async (req, res, next) => {
  if (!bindStudentEmail(req, res)) return;
  if (req.authUser?.role !== 'student' || !['update', 'delete'].includes(req.body?.action)) return next();

  try {
    const rowIndex = req.body.rowIndex;
    if (!['update', 'delete'].includes(req.body.action)) return next();
    if (!Number.isInteger(Number(rowIndex)) || Number(rowIndex) < 2) {
      return res.status(404).json({ success: false, error: 'Goal not found.' });
    }
    const goals = await fetchGoalsFromSheet(req.authUser.email, type, { strict: true });
    const verifiedGoal = goals.find((goal) => String(goal.rowIndex) === String(rowIndex));
    if (!verifiedGoal) {
      return res.status(404).json({ success: false, error: 'Goal not found.' });
    }
    req.verifiedGoal = verifiedGoal;
    return next();
  } catch (error) {
    console.error('Student goal ownership check error:', error);
    return res.status(502).json({ success: false, error: 'Unable to verify goal ownership.' });
  }
};

const authorizeReportEmail = (req, res, next) => {
  if (bindStudentEmail(req, res)) return next();
};

module.exports = { authenticate, requireStudent, requireTeacher, requirePersonalGeminiKey, authorizeGoalSheetRequest, authorizeReportEmail };
