const DAY_MS = 86400000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const curriculum = require('../config/curriculum');
const getDefaultTimezone = () => process.env.REPORT_TIMEZONE || 'Asia/Kolkata';

const isValidDate = (value) => {
  if (typeof value !== 'string' || !DATE_RE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
};

const getLocalDate = (date, timezone = getDefaultTimezone()) => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
};

const addDays = (date, amount) => new Date(Date.parse(`${date}T00:00:00.000Z`) + amount * DAY_MS).toISOString().slice(0, 10);
const weekday = (date) => new Date(`${date}T00:00:00.000Z`).getUTCDay();
const isLearningDay = (date, holidays) => weekday(date) !== 0 && !holidays.has(date);

const countWorkingDays = (start, end, holidays) => {
  if (start > end) return 0;
  let count = 0;
  for (let date = start; date <= end; date = addDays(date, 1)) if (isLearningDay(date, holidays)) count += 1;
  return count;
};

const addWorkingDays = (start, duration, holidays) => {
  let date = start;
  let count = 0;
  while (count < duration) {
    if (isLearningDay(date, holidays)) count += 1;
    if (count < duration) date = addDays(date, 1);
  }
  return date;
};

const calendarDayDifference = (from, to) => Math.max(0, Math.floor((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS));

const calculatePhaseProgress = ({ student, goals = [], phaseDurations = {}, holidayDates = [], dueSoonWorkingDays = 3, now = new Date() }) => {
  const timezone = student.timezone || getDefaultTimezone();
  const today = getLocalDate(now, timezone);
  const phase = student.currentPhase || null;
  const startDate = student.phaseStartDate || null;
  const phaseDetails = curriculum.getPhase(phase);
  const required = Number(phase && phaseDurations[phase]);
  if (!phase || !startDate || !isValidDate(startDate) || !Number.isInteger(required) || required < 1) {
    return {
      configured: false, phase, phaseDetails, phaseStartDate: startDate, status: 'NOT_CONFIGURED',
      message: !phase ? 'A teacher has not assigned a current phase yet.' : !startDate ? 'The phase start date is not configured.' : 'The configured phase duration is unavailable.'
    };
  }

  const holidays = new Set(holidayDates.filter(isValidDate));
  const learningDates = [...new Set(goals.filter((goal) => goal.phaseAtSubmission === phase)
    .map((goal) => goal.learningDate)
    .filter((date) => isValidDate(date) && date >= startDate && date <= today && isLearningDay(date, holidays)))].sort();
  const completed = Math.min(learningDates.length, required);
  const remaining = Math.max(0, required - completed);
  const baselineDeadline = addWorkingDays(startDate, required, holidays);
  const currentDeadline = baselineDeadline;
  const dueWorkingDays = today > currentDeadline ? 0 : countWorkingDays(addDays(today, 1), currentDeadline, holidays);
  const completedOn = completed >= required ? learningDates[required - 1] : null;
  let status;
  if (completed >= required) status = 'COMPLETED';
  else if (today > currentDeadline) status = 'OVERDUE';
  else if (completed === 0) status = 'NOT_STARTED';
  else if (dueWorkingDays <= dueSoonWorkingDays) status = 'DUE_SOON';
  else if (completed < Math.min(required, countWorkingDays(startDate, today, holidays))) status = 'BEHIND';
  else status = 'ON_TRACK';

  return {
    configured: true, phase, phaseDetails, requiredLearningDays: required, learningDaysCompleted: completed,
    remainingLearningDays: remaining, progressPercent: Math.round(completed / required * 10000) / 100,
    phaseStartDate: startDate, learningDates, baselineDeadline, currentDeadline,
    extensionDays: 0, extensionReasons: [], expectedLearningDaysToDate: Math.min(required, countWorkingDays(startDate, today, holidays)),
    completedOn, overdueDays: status === 'OVERDUE' ? calendarDayDifference(currentDeadline, today) : 0, status,
    timezone,
    deadlineNote: 'No approved leave source exists in this application; current deadline equals the baseline deadline.'
  };
};

module.exports = { getDefaultTimezone, isValidDate, getLocalDate, isLearningDay, countWorkingDays, addWorkingDays, calculatePhaseProgress };
