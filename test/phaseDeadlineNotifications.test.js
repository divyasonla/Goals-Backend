const { test } = require('node:test');
const assert = require('node:assert/strict');
const PhaseDeadlineNotification = require('../models/PhaseDeadlineNotification');
const { sendOverdueWarningOnce } = require('../services/phaseDeadlineNotifications');

test('overdue warning is sent once per student, phase, and deadline', async () => {
  const original = {
    create: PhaseDeadlineNotification.create,
    updateOne: PhaseDeadlineNotification.updateOne,
    deleteOne: PhaseDeadlineNotification.deleteOne,
  };
  const reserved = new Set();
  let sent = 0;
  PhaseDeadlineNotification.create = async (event) => {
    const key = `${event.studentId}:${event.phase}:${event.deadline}:${event.type}`;
    if (reserved.has(key)) { const error = new Error('duplicate'); error.code = 11000; throw error; }
    reserved.add(key);
  };
  PhaseDeadlineNotification.updateOne = async () => ({ modifiedCount: 1 });
  PhaseDeadlineNotification.deleteOne = async () => ({ deletedCount: 1 });
  try {
    const input = {
      student: { _id: 'student-1', name: 'Ari', email: 'ari@example.test' },
      progress: { phase: 'Phase 2', currentDeadline: '2026-10-06', baselineDeadline: '2026-10-06', requiredLearningDays: 13, learningDaysCompleted: 4, remainingLearningDays: 9, overdueDays: 2 },
      transport: { sendMail: async () => { sent += 1; } },
    };
    assert.deepEqual(await sendOverdueWarningOnce(input), { sent: true });
    assert.deepEqual(await sendOverdueWarningOnce(input), { sent: false, reason: 'already_sent_or_in_progress' });
    assert.deepEqual(await sendOverdueWarningOnce({ ...input, progress: { ...input.progress, currentDeadline: '2026-10-07' } }), { sent: true });
    assert.equal(sent, 2);
  } finally {
    PhaseDeadlineNotification.create = original.create;
    PhaseDeadlineNotification.updateOne = original.updateOne;
    PhaseDeadlineNotification.deleteOne = original.deleteOne;
  }
});

test('mail transport failure is contained and releases the notification reservation for retry', async () => {
  const original = {
    create: PhaseDeadlineNotification.create,
    updateOne: PhaseDeadlineNotification.updateOne,
    deleteOne: PhaseDeadlineNotification.deleteOne,
  };
  const reserved = new Set();
  PhaseDeadlineNotification.create = async (event) => {
    const key = `${event.studentId}:${event.phase}:${event.deadline}:${event.type}`;
    if (reserved.has(key)) { const error = new Error('duplicate'); error.code = 11000; throw error; }
    reserved.add(key);
  };
  PhaseDeadlineNotification.updateOne = async () => ({ modifiedCount: 1 });
  PhaseDeadlineNotification.deleteOne = async (event) => {
    reserved.delete(`${event.studentId}:${event.phase}:${event.deadline}:${event.type}`);
    return { deletedCount: 1 };
  };
  try {
    const input = {
      student: { _id: 'student-2', name: 'Priya', email: 'priya@example.test' },
      progress: { phase: 'Phase 3', currentDeadline: '2026-10-06' },
      transport: { sendMail: async () => { throw new Error('mock SMTP outage'); } },
    };
    assert.deepEqual(await sendOverdueWarningOnce(input), { sent: false, reason: 'email_failed' });
    assert.equal(reserved.size, 0);
  } finally {
    PhaseDeadlineNotification.create = original.create;
    PhaseDeadlineNotification.updateOne = original.updateOne;
    PhaseDeadlineNotification.deleteOne = original.deleteOne;
  }
});

test('notification tracking failure after a successful send does not release the duplicate guard', async () => {
  const original = {
    create: PhaseDeadlineNotification.create,
    updateOne: PhaseDeadlineNotification.updateOne,
    deleteOne: PhaseDeadlineNotification.deleteOne,
  };
  const reserved = new Set();
  let sent = 0;
  PhaseDeadlineNotification.create = async (event) => {
    const key = `${event.studentId}:${event.phase}:${event.deadline}:${event.type}`;
    if (reserved.has(key)) { const error = new Error('duplicate'); error.code = 11000; throw error; }
    reserved.add(key);
  };
  PhaseDeadlineNotification.updateOne = async () => { throw new Error('mock database outage'); };
  PhaseDeadlineNotification.deleteOne = async () => { throw new Error('must retain reservation after successful send'); };
  try {
    const input = {
      student: { _id: 'student-3', name: 'Sam', email: 'sam@example.test' },
      progress: { phase: 'Phase 1', currentDeadline: '2026-10-06' },
      transport: { sendMail: async () => { sent += 1; } },
    };
    assert.deepEqual(await sendOverdueWarningOnce(input), { sent: true, notificationRecorded: false });
    assert.deepEqual(await sendOverdueWarningOnce(input), { sent: false, reason: 'already_sent_or_in_progress' });
    assert.equal(sent, 1);
  } finally {
    PhaseDeadlineNotification.create = original.create;
    PhaseDeadlineNotification.updateOne = original.updateOne;
    PhaseDeadlineNotification.deleteOne = original.deleteOne;
  }
});
