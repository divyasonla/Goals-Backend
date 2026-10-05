const { runDailyPhaseDeadlineCheck } = require('./phaseDeadlineNotifications');

const DAY_MS = 24 * 60 * 60 * 1000;
let interval = null;

const startPhaseDeadlineScheduler = () => {
  if (interval) return interval;
  if (!['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'EMAIL_FROM'].every((key) => process.env[key])) {
    console.warn('Phase deadline emails are disabled until SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, and EMAIL_FROM are configured.');
  } else {
    try { require.resolve('nodemailer'); }
    catch { console.warn('Phase deadline emails are disabled because the Nodemailer dependency is unavailable.'); }
  }
  runDailyPhaseDeadlineCheck().catch((error) => console.error('Daily phase deadline check failed:', error?.name || 'scheduler error'));
  interval = setInterval(() => {
    runDailyPhaseDeadlineCheck().catch((error) => console.error('Daily phase deadline check failed:', error?.name || 'scheduler error'));
  }, DAY_MS);
  interval.unref?.();
  return interval;
};

const stopPhaseDeadlineScheduler = () => {
  if (interval) clearInterval(interval);
  interval = null;
};

module.exports = { startPhaseDeadlineScheduler, stopPhaseDeadlineScheduler };
