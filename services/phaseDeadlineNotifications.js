const User = require('../models/User');
const PhaseDeadlineNotification = require('../models/PhaseDeadlineNotification');
const PhaseSettings = require('../models/PhaseSettings');
const PhaseHoliday = require('../models/PhaseHoliday');
const CURRICULUM_PHASE_DURATIONS = require('../config/curriculum').phaseDurations;
const { fetchGoalsFromSheet } = require('../utils/googleSheets');
const { calculatePhaseProgress } = require('./phaseProgressService');

const getTransport = () => {
  const required = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'EMAIL_FROM'];
  if (required.some((name) => !process.env[name])) return null;
  let nodemailer;
  try { nodemailer = require('nodemailer'); } catch { return null; }
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT),
    secure: String(process.env.SMTP_SECURE || '').toLowerCase() === 'true',
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
  });
};

const buildOverdueEmail = ({ student, progress }) => ({
  from: process.env.EMAIL_FROM,
  to: student.email,
  subject: `${progress.phase} Deadline Overdue`,
  text: [
    `Hello ${student.name},`, '',
    `Your ${progress.phase} learning deadline has passed.`,
    `Required learning days: ${progress.requiredLearningDays}`,
    `Completed learning days: ${progress.learningDaysCompleted}`,
    `Remaining learning days: ${progress.remainingLearningDays}`,
    `Baseline deadline: ${progress.baselineDeadline}`,
    `Current deadline: ${progress.currentDeadline}`,
    `Overdue by: ${progress.overdueDays} calendar day(s).`, '',
    'Please contact your teacher or Academic Associate to agree on your next learning steps.'
  ].join('\n')
});

const sendOverdueWarningOnce = async ({ student, progress, transport = getTransport() }) => {
  if (!transport || !student.email || !progress.currentDeadline) return { sent: false, reason: 'email_not_configured' };
  const filter = { studentId: student._id, phase: progress.phase, deadline: progress.currentDeadline, type: 'overdue' };
  try {
    await PhaseDeadlineNotification.create({ ...filter, sentAt: null });
  } catch (error) {
    if (error.code === 11000) return { sent: false, reason: 'already_sent_or_in_progress' };
    throw error;
  }
  try {
    await transport.sendMail(buildOverdueEmail({ student, progress }));
  } catch (error) {
    try { await PhaseDeadlineNotification.deleteOne(filter); }
    catch { console.error('Phase deadline notification reservation cleanup failed.'); }
    console.error('Phase deadline email failed:', error?.code || 'mail transport error');
    return { sent: false, reason: 'email_failed' };
  }

  try {
    await PhaseDeadlineNotification.updateOne(filter, { $set: { sentAt: new Date() } });
    return { sent: true };
  } catch (error) {
    // Keep the unique reservation after a successful send so a tracking-store outage cannot cause duplicate mail.
    console.error('Phase deadline email sent but notification tracking failed:', error?.name || 'database error');
    return { sent: true, notificationRecorded: false };
  }
};

const runDailyPhaseDeadlineCheck = async ({ now = new Date(), transport } = {}) => {
  const activeStudents = await User.find({ role: 'student', currentPhase: { $ne: null }, phaseStartDate: { $type: 'string' } })
    .select('_id name email role currentPhase phaseStartDate timezone').lean();
  if (!activeStudents.length) return { checked: 0, overdue: 0, sent: 0 };
  const [settings, holidays, dailyRows, weeklyRows] = await Promise.all([
    PhaseSettings.findOne({ key: 'global' }).lean(),
    PhaseHoliday.find({}).select('date').lean(),
    fetchGoalsFromSheet(null, 'Daily', { strict: true }),
    fetchGoalsFromSheet(null, 'Weekly', { strict: true })
  ]);
  const durations = CURRICULUM_PHASE_DURATIONS;
  const holidayDates = (holidays || []).map((holiday) => holiday.date);
  let overdue = 0;
  let sent = 0;
  for (const student of activeStudents) {
    const studentGoals = [...dailyRows, ...weeklyRows].filter((goal) => goal.email.toLowerCase() === student.email.toLowerCase());
    const progress = calculatePhaseProgress({ student, goals: studentGoals, phaseDurations: durations, holidayDates, dueSoonWorkingDays: settings?.dueSoonWorkingDays ?? 3, now });
    if (progress.status !== 'OVERDUE') continue;
    overdue += 1;
    const result = await sendOverdueWarningOnce({ student, progress, transport });
    if (result.sent) sent += 1;
  }
  return { checked: activeStudents.length, overdue, sent };
};

module.exports = { getTransport, buildOverdueEmail, sendOverdueWarningOnce, runDailyPhaseDeadlineCheck };
