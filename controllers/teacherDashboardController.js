const User = require('../models/User');
const GoalTaskBreakdown = require('../models/GoalTaskBreakdown');
const googleSheets = require('../utils/googleSheets');
const { getDateInTimezone, tagsForPeriod } = require('./growthController');

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const hasReflection = (goal) => [goal.reflection, goal.wentWell, goal.challenges, goal.left]
  .some((value) => typeof value === 'string' && value.trim().length > 0);

const getPeriod = (query) => {
  let endDate = query.endDate;
  if (!endDate) {
    try { endDate = getDateInTimezone(new Date(), process.env.REPORT_TIMEZONE || 'UTC'); }
    catch { return null; }
  }
  const startDate = query.startDate || (() => {
    const days = [7, 14, 30].includes(Number(query.days)) ? Number(query.days) : 7;
    const date = new Date(`${endDate}T00:00:00.000Z`);
    date.setUTCDate(date.getUTCDate() - days + 1);
    return date.toISOString().slice(0, 10);
  })();
  if (!DATE_RE.test(startDate) || !DATE_RE.test(endDate) || startDate > endDate) return null;
  const length = (Date.parse(`${endDate}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`)) / 86400000 + 1;
  if (!Number.isInteger(length) || length > 90) return null;
  return { startDate, endDate };
};

const getTeacherDashboardOverview = async (req, res) => {
  const period = getPeriod(req.query || {});
  if (!period) return res.status(400).json({ success: false, error: 'Use a valid date range of up to 90 days.' });
  const page = Math.max(1, Math.min(100000, Number.parseInt(req.query?.page, 10) || 1));
  const limit = Math.max(1, Math.min(50, Number.parseInt(req.query?.limit, 10) || 20));
  const search = typeof req.query?.search === 'string' ? req.query.search.trim().slice(0, 100) : '';
  const studentFilter = { role: 'student' };
  if (search) studentFilter.$or = [
    { name: { $regex: search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' } },
    { email: { $regex: search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' } }
  ];

  try {
    const [students, totalStudents, dailyRows, weeklyRows] = await Promise.all([
      User.find(studentFilter).select('_id name email').sort({ name: 1, _id: 1 }).skip((page - 1) * limit).limit(limit).lean(),
      User.countDocuments(studentFilter),
      googleSheets.fetchGoalsFromSheet(null, 'Daily', { strict: true }),
      googleSheets.fetchGoalsFromSheet(null, 'Weekly', { strict: true })
    ]);
    const emailSet = new Set(students.map((student) => student.email.toLowerCase()));
    const inPeriod = (row) => row.createdAt >= period.startDate && row.createdAt <= period.endDate;
    const weeklyTags = tagsForPeriod(period.startDate, period.endDate);
    const weeklyInPeriod = (row) => inPeriod(row) || weeklyTags.has(row.createdAt);
    const plans = students.length ? await GoalTaskBreakdown.find({ studentId: { $in: students.map((student) => student._id) }, accepted: true }).select('studentId tasks').lean() : [];
    const tasksByStudent = new Map();
    for (const plan of plans) {
      const studentId = String(plan.studentId);
      const values = tasksByStudent.get(studentId) || { total: 0, completed: 0 };
      for (const task of plan.tasks || []) {
        values.total += 1;
        if (task.status === 'Completed') values.completed += 1;
      }
      tasksByStudent.set(studentId, values);
    }
    const studentRows = students.map((student) => {
      const matches = (row) => row.email.toLowerCase() === student.email.toLowerCase() && inPeriod(row);
      const daily = dailyRows.filter(matches);
      const weekly = weeklyRows.filter((row) => row.email.toLowerCase() === student.email.toLowerCase() && weeklyInPeriod(row));
      const completed = daily.filter((row) => row.status === 'Completed').length;
      const reflections = daily.filter(hasReflection).length;
      const studentTasks = tasksByStudent.get(String(student._id)) || { total: 0, completed: 0 };
      return {
        id: String(student._id), name: student.name, email: student.email,
        goals: daily.length + weekly.length,
        dailyGoals: daily.length,
        completedGoals: completed,
        completionPercent: daily.length ? Math.round(completed / daily.length * 100) : null,
        reflections,
        reflectionCoverage: daily.length ? Math.round(reflections / daily.length * 100) : null,
        tasksCompleted: studentTasks.completed,
        tasksRemaining: studentTasks.total - studentTasks.completed,
        lastActivity: [...daily, ...weekly].map((row) => row.createdAt).sort().at(-1) || null,
        active: daily.length + weekly.length > 0
      };
    });
    const allPeriodDaily = dailyRows.filter((row) => inPeriod(row) && emailSet.has(row.email.toLowerCase()));
    const allPeriodWeekly = weeklyRows.filter((row) => weeklyInPeriod(row) && emailSet.has(row.email.toLowerCase()));
    const totalGoals = allPeriodDaily.length + allPeriodWeekly.length;
    const completedGoals = allPeriodDaily.filter((row) => row.status === 'Completed').length;
    const reflectionRows = allPeriodDaily.filter(hasReflection).length;
    const tasks = plans.flatMap((plan) => plan.tasks || []);
    const taskCompleted = tasks.filter((task) => task.status === 'Completed').length;
    const challengeCounts = new Map();
    for (const row of allPeriodDaily) {
      const challenge = String(row.challenges || '').trim();
      if (challenge) {
        const key = challenge.toLocaleLowerCase();
        const prior = challengeCounts.get(key) || { text: challenge.slice(0, 240), count: 0 };
        prior.count += 1;
        challengeCounts.set(key, prior);
      }
    }
    const commonChallenges = [...challengeCounts.values()].filter((item) => item.count > 1).sort((a, b) => b.count - a.count).slice(0, 8);
    return res.json({ success: true, data: {
      period, page, limit, totalStudents,
      overview: {
        activeStudents: new Set([...allPeriodDaily, ...allPeriodWeekly].map((row) => row.email.toLowerCase())).size,
        goalsCreated: totalGoals, goalsCompleted: completedGoals,
        completionPercent: allPeriodDaily.length ? Math.round(completedGoals / allPeriodDaily.length * 100) : null,
        reflectionCoverage: allPeriodDaily.length ? Math.round(reflectionRows / allPeriodDaily.length * 100) : null,
        reflectionGoals: reflectionRows, dailyGoals: allPeriodDaily.length,
        tasksCompleted: taskCompleted, tasksRemaining: tasks.length - taskCompleted,
        taskScope: 'accepted task plans for the students on this page; historical task completion dates are not stored'
      },
      students: studentRows,
      commonChallenges,
      limitations: { phaseAvailable: false, challengeCounting: 'case-insensitive exact text matches from daily reflection challenge fields' }
    } });
  } catch (error) {
    console.error('Teacher dashboard overview error:', error?.name || 'data source error');
    return res.status(502).json({ success: false, error: 'Unable to load teacher dashboard data. Please try again later.' });
  }
};

module.exports = { getTeacherDashboardOverview, getPeriod, hasReflection };
