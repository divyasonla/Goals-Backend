const mongoose = require('mongoose');
const User = require('../models/User');
const PhaseSettings = require('../models/PhaseSettings');
const PhaseHoliday = require('../models/PhaseHoliday');
const { fetchGoalsFromSheet } = require('../utils/googleSheets');
const curriculum = require('../config/curriculum');
const { isValidDate, getLocalDate, calculatePhaseProgress } = require('../services/phaseProgressService');

const readCalendar = async () => {
  const [settings, holidays] = await Promise.all([
    PhaseSettings.findOne({ key: 'global' }).lean(),
    PhaseHoliday.find({}).select('date name').sort({ date: 1 }).lean()
  ]);
  return {
    // Milestone 1 is authoritative. Legacy MongoDB phase-duration overrides are
    // intentionally ignored so old defaults cannot silently change curriculum.
    phaseDurations: curriculum.phaseDurations,
    phases: curriculum.phases,
    induction: curriculum.induction,
    curriculumContext: curriculum.curriculumContext,
    dueSoonWorkingDays: settings?.dueSoonWorkingDays ?? 3,
    holidays: holidays || []
  };
};

const progressForStudent = async (student, calendar) => {
  const [daily, weekly] = await Promise.all([
    fetchGoalsFromSheet(student.email, 'Daily', { strict: true }),
    fetchGoalsFromSheet(student.email, 'Weekly', { strict: true })
  ]);
  return calculatePhaseProgress({
    student,
    goals: [...daily, ...weekly],
    phaseDurations: calendar.phaseDurations,
    holidayDates: calendar.holidays.map((holiday) => holiday.date),
    dueSoonWorkingDays: calendar.dueSoonWorkingDays
  });
};

const getMyPhaseProgress = async (req, res) => {
  try {
    const [calendar, student] = await Promise.all([
      readCalendar(), User.findById(req.authUser._id).select('_id name email currentPhase phaseStartDate timezone phaseProgressHistory phaseChangeRequests').lean()
    ]);
    if (!student) return res.status(404).json({ success: false, error: 'Student not found.' });
    const progress = await progressForStudent(student, calendar);
    return res.json({ success: true, data: {
      ...progress,
      holidays: calendar.holidays.map(({ date, name }) => ({ date, name })),
      phaseHistory: student.phaseProgressHistory || [],
      phaseChangeRequests: student.phaseChangeRequests || [],
      curriculum: { source: curriculum.source, phases: curriculum.phases, induction: curriculum.induction, context: curriculum.curriculumContext }
    } });
  } catch (error) {
    console.error('Student phase progress error:', error?.name || 'data source error');
    return res.status(502).json({ success: false, error: 'Unable to load phase progress right now.' });
  }
};

const getAdminStudentPhaseProgress = async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.studentId)) return res.status(404).json({ success: false, error: 'Student not found.' });
  try {
    const student = await User.findOne({ _id: req.params.studentId, role: 'student' }).select('_id name email role currentPhase phaseStartDate timezone phaseProgressHistory phaseChangeRequests').lean();
    if (!student) return res.status(404).json({ success: false, error: 'Student not found.' });
    const calendar = await readCalendar();
    const progress = await progressForStudent(student, calendar);
    return res.json({ success: true, student: { id: String(student._id), name: student.name, email: student.email }, data: {
      ...progress, phaseHistory: student.phaseProgressHistory || [], phaseChangeRequests: student.phaseChangeRequests || [],
      curriculum: { source: curriculum.source, phases: curriculum.phases, induction: curriculum.induction, context: curriculum.curriculumContext }
    } });
  } catch (error) {
    console.error('Admin student phase progress error:', error?.name || 'data source error');
    return res.status(502).json({ success: false, error: 'Unable to load this student’s phase progress.' });
  }
};

const getAdminPhaseProgressList = async (req, res) => {
  const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
  const limit = Math.min(50, Math.max(1, Number.parseInt(req.query.limit, 10) || 20));
  const phase = typeof req.query.phase === 'string' ? req.query.phase.trim() : '';
  const status = typeof req.query.status === 'string' ? req.query.status.trim().toUpperCase() : '';
  const search = typeof req.query.search === 'string' ? req.query.search.trim().slice(0, 100) : '';
  const filter = { role: 'student' };
  if (phase && phase !== 'all') filter.currentPhase = phase;
  if (search) {
    const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    filter.$or = [{ name: { $regex: escaped, $options: 'i' } }, { email: { $regex: escaped, $options: 'i' } }];
  }
  const validStatuses = ['NOT_CONFIGURED', 'NOT_STARTED', 'ON_TRACK', 'BEHIND', 'DUE_SOON', 'OVERDUE', 'COMPLETED'];
  if (status && !validStatuses.includes(status)) return res.status(400).json({ success: false, error: 'Invalid phase progress status.' });
  try {
    const [calendar, students, dailyRows, weeklyRows] = await Promise.all([
      readCalendar(),
      User.find(filter).select('_id name email role currentPhase phaseStartDate timezone').sort({ name: 1, _id: 1 }).lean(),
      fetchGoalsFromSheet(null, 'Daily', { strict: true }),
      fetchGoalsFromSheet(null, 'Weekly', { strict: true })
    ]);
    const progressRows = students.map((student) => ({
      student: { id: String(student._id), name: student.name, email: student.email },
      progress: calculatePhaseProgress({
        student,
        goals: [...dailyRows, ...weeklyRows].filter((goal) => goal.email.toLowerCase() === student.email.toLowerCase()),
        phaseDurations: calendar.phaseDurations,
        holidayDates: calendar.holidays.map((holiday) => holiday.date),
        dueSoonWorkingDays: calendar.dueSoonWorkingDays
      })
    })).filter((entry) => !status || entry.progress.status === status);
    const total = progressRows.length;
    const visible = progressRows.slice((page - 1) * limit, page * limit);
    return res.json({ success: true, data: {
      students: visible, page, limit, total, phases: Object.keys(calendar.phaseDurations), curriculum: calendar.phases,
      statusOptions: validStatuses
    } });
  } catch (error) {
    console.error('Admin phase progress list error:', error?.name || 'data source error');
    return res.status(502).json({ success: false, error: 'Unable to load phase progress for students.' });
  }
};

const assignStudentPhase = async (req, res) => {
  const { phase, phaseStartDate, timezone } = req.body || {};
  if (!mongoose.isValidObjectId(req.params.studentId)) return res.status(404).json({ success: false, error: 'Student not found.' });
  if (typeof phase !== 'string' || !phase.trim() || !isValidDate(phaseStartDate)) {
    return res.status(400).json({ success: false, error: 'Choose a valid phase and phase start date.' });
  }
  try {
    const calendar = await readCalendar();
    if (!calendar.phaseDurations[phase]) return res.status(400).json({ success: false, error: 'Choose a phase defined in Milestone 1.' });
    const student = await User.findOne({ _id: req.params.studentId, role: 'student' }).select('_id currentPhase phaseStartDate timezone phaseAssignmentHistory');
    if (!student) return res.status(404).json({ success: false, error: 'Student not found.' });
    if (student.currentPhase && student.currentPhase !== phase.trim()) return res.status(409).json({ success: false, error: 'An assigned phase can only be changed through an approved student phase-change request.' });
    if (student.currentPhase === phase.trim()) return res.status(409).json({ success: false, error: 'This student already has that phase assigned.' });
    const resolvedTimezone = timezone || student.timezone || process.env.REPORT_TIMEZONE || 'Asia/Kolkata';
    try { new Intl.DateTimeFormat('en-US', { timeZone: resolvedTimezone }).format(new Date()); }
    catch { return res.status(400).json({ success: false, error: 'Choose a valid IANA timezone.' }); }
    student.phaseAssignmentHistory = student.phaseAssignmentHistory || [];
    student.phaseAssignmentHistory.push({ phase: phase.trim(), phaseStartDate, changedAt: new Date(), changedBy: req.authUser._id });
    student.currentPhase = phase.trim();
    student.phaseStartDate = phaseStartDate;
    student.timezone = resolvedTimezone;
    await student.save();
    return res.json({ success: true, data: { studentId: String(student._id), phase: student.currentPhase, phaseStartDate: student.phaseStartDate, timezone: student.timezone } });
  } catch (error) {
    console.error('Student phase assignment error:', error?.name || 'database error');
    return res.status(500).json({ success: false, error: 'Unable to assign this student’s phase.' });
  }
};

const getPhaseConfig = async (_req, res) => {
  try {
    const calendar = await readCalendar();
    return res.json({ success: true, phaseDurations: calendar.phaseDurations, phases: calendar.phases, induction: calendar.induction, curriculumContext: calendar.curriculumContext, dueSoonWorkingDays: calendar.dueSoonWorkingDays });
  } catch {
    return res.status(500).json({ success: false, error: 'Unable to load phase configuration.' });
  }
};

const updatePhaseConfig = async (req, res) => {
  return res.status(409).json({ success: false, error: 'Phase names and durations are defined by Milestone 1 and cannot be changed here.', phaseDurations: curriculum.phaseDurations });
};

const getMyPhaseChangeRequests = async (req, res) => {
  const student = await User.findById(req.authUser._id).select('phaseChangeRequests phaseProgressHistory currentPhase phaseStartDate').lean();
  if (!student) return res.status(404).json({ success: false, error: 'Student not found.' });
  return res.json({ success: true, currentPhase: student.currentPhase || null, phaseStartDate: student.phaseStartDate || null, requests: student.phaseChangeRequests || [], history: student.phaseProgressHistory || [] });
};

const createPhaseChangeRequest = async (req, res) => {
  const requestedPhase = typeof req.body?.requestedPhase === 'string' ? req.body.requestedPhase.trim() : '';
  const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
  if (!requestedPhase || !curriculum.phaseDurations[requestedPhase]) return res.status(400).json({ success: false, error: 'Choose a phase defined in Milestone 1.' });
  if (!reason || reason.length > 1000) return res.status(400).json({ success: false, error: 'Enter a reason of 1 to 1000 characters.' });
  if (!req.authUser.currentPhase) return res.status(409).json({ success: false, error: 'Ask a teacher to assign your initial phase before requesting a phase change.' });
  if (req.authUser.currentPhase === requestedPhase) return res.status(400).json({ success: false, error: 'Requested phase must differ from your current phase.' });
  try {
    const student = await User.findOneAndUpdate(
      { _id: req.authUser._id, role: 'student', currentPhase: req.authUser.currentPhase, phaseChangeRequests: { $not: { $elemMatch: { status: 'PENDING' } } } },
      { $push: { phaseChangeRequests: { currentPhase: req.authUser.currentPhase, requestedPhase, reason, status: 'PENDING', requestedAt: new Date() } } },
      { new: true, projection: { phaseChangeRequests: 1 } }
    ).lean();
    if (!student) return res.status(409).json({ success: false, error: 'A phase-change request is already pending or your current phase changed. Refresh and try again.' });
    return res.status(201).json({ success: true, request: student.phaseChangeRequests.at(-1) });
  } catch (error) {
    console.error('Phase-change request error:', error?.name || 'database error');
    return res.status(500).json({ success: false, error: 'Unable to submit your phase-change request.' });
  }
};

const listPhaseChangeRequests = async (req, res) => {
  const status = typeof req.query.status === 'string' ? req.query.status.toUpperCase() : 'PENDING';
  if (!['PENDING', 'APPROVED', 'REJECTED', 'ALL'].includes(status)) return res.status(400).json({ success: false, error: 'Invalid request status.' });
  const filter = { role: 'student' };
  if (status !== 'ALL') filter['phaseChangeRequests.status'] = status;
  try {
    const [students, calendar, daily, weekly] = await Promise.all([
      User.find(filter).select('_id name email currentPhase phaseStartDate timezone phaseChangeRequests phaseProgressHistory').lean(),
      readCalendar(), fetchGoalsFromSheet(null, 'Daily', { strict: true }), fetchGoalsFromSheet(null, 'Weekly', { strict: true })
    ]);
    const requests = [];
    for (const student of students) {
      const studentGoals = [...daily, ...weekly].filter((goal) => (goal.email || '').toLowerCase() === student.email.toLowerCase());
      const progress = calculatePhaseProgress({ student, goals: studentGoals, phaseDurations: calendar.phaseDurations, holidayDates: calendar.holidays.map(({ date }) => date), dueSoonWorkingDays: calendar.dueSoonWorkingDays });
      for (const request of student.phaseChangeRequests || []) {
        if (status !== 'ALL' && request.status !== status) continue;
        requests.push({ student: { id: String(student._id), name: student.name, email: student.email }, request, progress, phaseHistory: student.phaseProgressHistory || [], requestedPhaseCurriculum: curriculum.getPhase(request.requestedPhase) });
      }
    }
    requests.sort((a, b) => new Date(b.request.requestedAt) - new Date(a.request.requestedAt));
    return res.json({ success: true, requests, curriculum: calendar.phases });
  } catch (error) {
    console.error('Phase-change request list error:', error?.name || 'data source error');
    return res.status(502).json({ success: false, error: 'Unable to load phase-change requests.' });
  }
};

const reviewPhaseChangeRequest = async (req, res) => {
  const { decision, reviewComment = '' } = req.body || {};
  if (!mongoose.isValidObjectId(req.params.requestId)) return res.status(404).json({ success: false, error: 'Phase-change request not found.' });
  if (!['approve', 'reject'].includes(decision)) return res.status(400).json({ success: false, error: 'Decision must be approve or reject.' });
  if (typeof reviewComment !== 'string' || reviewComment.trim().length > 1000) return res.status(400).json({ success: false, error: 'Review comment must be 1000 characters or fewer.' });
  try {
    const student = await User.findOne({ role: 'student', 'phaseChangeRequests._id': req.params.requestId }).select('_id name email currentPhase phaseStartDate timezone phaseChangeRequests phaseProgressHistory phaseAssignmentHistory');
    if (!student) return res.status(404).json({ success: false, error: 'Phase-change request not found.' });
    const request = student.phaseChangeRequests.id(req.params.requestId);
    if (!request || request.status !== 'PENDING') return res.status(409).json({ success: false, error: 'This request has already been reviewed.' });
    if (student.currentPhase !== request.currentPhase) return res.status(409).json({ success: false, error: 'The student current phase changed after this request was made.' });
    const reviewedAt = new Date();
    if (decision === 'reject') {
      const updated = await User.findOneAndUpdate(
        { _id: student._id, currentPhase: request.currentPhase, phaseChangeRequests: { $elemMatch: { _id: request._id, status: 'PENDING' } } },
        { $set: { 'phaseChangeRequests.$[item].status': 'REJECTED', 'phaseChangeRequests.$[item].reviewedAt': reviewedAt, 'phaseChangeRequests.$[item].reviewedBy': req.authUser._id, 'phaseChangeRequests.$[item].reviewComment': reviewComment.trim() } },
        { new: true, arrayFilters: [{ 'item._id': request._id, 'item.status': 'PENDING' }] }
      ).lean();
      if (!updated) return res.status(409).json({ success: false, error: 'This request was reviewed by another team member.' });
      return res.json({ success: true, request: updated.phaseChangeRequests.find((item) => String(item._id) === String(request._id)) });
    }

    const calendar = await readCalendar();
    const oldProgress = await progressForStudent(student, calendar);
    if (!oldProgress.configured) return res.status(409).json({ success: false, error: 'The student’s current phase progress is not configured; cannot archive it safely.' });
    const newPhaseStartDate = getLocalDate(reviewedAt, student.timezone);
    const historyEntry = {
      phase: student.currentPhase, phaseStartDate: student.phaseStartDate, phaseEndDate: newPhaseStartDate,
      requiredLearningDays: oldProgress.requiredLearningDays, learningDaysCompleted: oldProgress.learningDaysCompleted,
      learningDates: oldProgress.learningDates,
      remainingLearningDays: oldProgress.remainingLearningDays, progressPercent: oldProgress.progressPercent,
      baselineDeadline: oldProgress.baselineDeadline, currentDeadline: oldProgress.currentDeadline,
      status: oldProgress.status === 'COMPLETED' ? 'COMPLETED' : 'MOVED_TO_NEXT_PHASE',
      completedOn: oldProgress.completedOn || null, movedToNextPhase: true, phaseChangeRequestId: request._id
    };
    const updated = await User.findOneAndUpdate(
      { _id: student._id, currentPhase: request.currentPhase, phaseChangeRequests: { $elemMatch: { _id: request._id, status: 'PENDING' } } },
      {
        $set: {
          currentPhase: request.requestedPhase, phaseStartDate: newPhaseStartDate,
          'phaseChangeRequests.$[item].status': 'APPROVED', 'phaseChangeRequests.$[item].reviewedAt': reviewedAt,
          'phaseChangeRequests.$[item].reviewedBy': req.authUser._id, 'phaseChangeRequests.$[item].reviewComment': reviewComment.trim(),
          'phaseChangeRequests.$[item].newPhaseStartDate': newPhaseStartDate
        },
        $push: {
          phaseProgressHistory: historyEntry,
          phaseAssignmentHistory: { phase: request.requestedPhase, phaseStartDate: newPhaseStartDate, changedAt: reviewedAt, changedBy: req.authUser._id }
        }
      },
      { new: true, arrayFilters: [{ 'item._id': request._id, 'item.status': 'PENDING' }] }
    ).lean();
    if (!updated) return res.status(409).json({ success: false, error: 'This request was reviewed by another team member.' });
    return res.json({ success: true, request: updated.phaseChangeRequests.find((item) => String(item._id) === String(request._id)), currentPhase: updated.currentPhase, phaseStartDate: updated.phaseStartDate, previousPhase: historyEntry });
  } catch (error) {
    console.error('Phase-change review error:', error?.name || 'database or data-source error');
    return res.status(500).json({ success: false, error: 'Unable to review this phase-change request.' });
  }
};

const listHolidays = async (_req, res) => {
  try { return res.json({ success: true, holidays: await PhaseHoliday.find({}).select('date name').sort({ date: 1 }).lean() }); }
  catch { return res.status(500).json({ success: false, error: 'Unable to load holidays.' }); }
};

const addHoliday = async (req, res) => {
  const { date, name } = req.body || {};
  if (!isValidDate(date) || typeof name !== 'string' || !name.trim() || name.trim().length > 120) {
    return res.status(400).json({ success: false, error: 'Enter a valid holiday date and a name of 120 characters or fewer.' });
  }
  try {
    const holiday = await PhaseHoliday.create({ date, name: name.trim(), createdBy: req.authUser._id });
    return res.status(201).json({ success: true, holiday: { id: String(holiday._id), date: holiday.date, name: holiday.name } });
  } catch (error) {
    if (error.code === 11000) return res.status(409).json({ success: false, error: 'A holiday is already configured for that date.' });
    return res.status(500).json({ success: false, error: 'Unable to save this holiday.' });
  }
};

const deleteHoliday = async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.holidayId)) return res.status(404).json({ success: false, error: 'Holiday not found.' });
  try {
    const result = await PhaseHoliday.deleteOne({ _id: req.params.holidayId });
    if (!result.deletedCount) return res.status(404).json({ success: false, error: 'Holiday not found.' });
    return res.json({ success: true });
  } catch { return res.status(500).json({ success: false, error: 'Unable to remove this holiday.' }); }
};

module.exports = { getMyPhaseProgress, getMyPhaseChangeRequests, createPhaseChangeRequest, listPhaseChangeRequests, reviewPhaseChangeRequest, getAdminStudentPhaseProgress, getAdminPhaseProgressList, assignStudentPhase, getPhaseConfig, updatePhaseConfig, listHolidays, addHoliday, deleteHoliday, readCalendar, progressForStudent };
