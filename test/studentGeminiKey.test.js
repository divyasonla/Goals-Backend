const { beforeEach, test } = require('node:test');
const assert = require('node:assert/strict');
const User = require('../models/User');
const keyUtils = require('../utils/studentGeminiKey');
const settings = require('../controllers/settingsController');
const routes = require('../routes/authRoutes');
const { requirePersonalGeminiKey } = require('../middleware/auth');

const responseRecorder = () => ({
  statusCode: 200, payload: undefined,
  status(code) { this.statusCode = code; return this; },
  json(body) { this.payload = body; return this; }
});

const originalFindById = User.findById;
const originalUpdateOne = User.updateOne;
const secretKey = 'personal-student-gemini-key-do-not-return';

beforeEach(() => {
  process.env.GEMINI_KEY_ENCRYPTION_KEY = 'a'.repeat(64);
  User.findById = originalFindById;
  User.updateOne = originalUpdateOne;
});

test('student Gemini key encryption uses authenticated AES-GCM ciphertext', () => {
  const encrypted = keyUtils.encryptGeminiApiKey(secretKey);
  assert.equal(encrypted.includes(secretKey), false);
  assert.equal(keyUtils.decryptGeminiApiKey(encrypted), secretKey);
  assert.notEqual(encrypted, keyUtils.encryptGeminiApiKey(secretKey));
});

test('invalid encryption-key configuration fails closed', () => {
  process.env.GEMINI_KEY_ENCRYPTION_KEY = 'not-a-key';
  assert.throws(() => keyUtils.encryptGeminiApiKey(secretKey), /64 hexadecimal characters/);
});

test('saving a Gemini key stores only ciphertext and never returns the key', async () => {
  let savedUpdate;
  User.updateOne = async (_query, update) => { savedUpdate = update; return { matchedCount: 1 }; };
  const res = responseRecorder();
  await settings.saveGeminiKeySettings({ authUser: { _id: 'student-1' }, body: { apiKey: secretKey } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(JSON.stringify(res.payload).includes(secretKey), false);
  assert.equal(savedUpdate.$set.geminiApiKeyEncrypted.includes(secretKey), false);
  assert.equal(keyUtils.decryptGeminiApiKey(savedUpdate.$set.geminiApiKeyEncrypted), secretKey);
});

test('key status returns only configured metadata, not ciphertext or plaintext', async () => {
  User.findById = () => ({ select: async () => ({ geminiApiKeyEncrypted: keyUtils.encryptGeminiApiKey(secretKey), geminiApiKeyUpdatedAt: new Date('2026-10-03T00:00:00Z') }) });
  const res = responseRecorder();
  await settings.getGeminiKeySettings({ authUser: { _id: 'student-1' } }, res);
  assert.equal(res.payload.configured, true);
  assert.equal(JSON.stringify(res.payload).includes(secretKey), false);
  assert.equal(JSON.stringify(res.payload).includes('ciphertext'), false);
});

test('removing a key unsets both encrypted value and timestamp', async () => {
  let update;
  User.updateOne = async (_query, nextUpdate) => { update = nextUpdate; return { matchedCount: 1 }; };
  const res = responseRecorder();
  await settings.deleteGeminiKeySettings({ authUser: { _id: 'student-1' } }, res);
  assert.deepEqual(update.$unset, { geminiApiKeyEncrypted: '', geminiApiKeyUpdatedAt: '' });
  assert.equal(res.payload.configured, false);
});

test('key settings endpoints require a student JWT role', () => {
  for (const method of ['get', 'put', 'delete']) {
    const route = routes.stack.find((layer) => layer.route?.path === '/settings/gemini-key' && layer.route.methods[method])?.route;
    assert.ok(route);
    assert.equal(route.stack[0].handle.name, 'authenticate');
    assert.equal(route.stack[1].handle.name, 'requireStudent');
  }
});

test('all student Gemini features are protected and load that student\'s key', () => {
  for (const path of ['/analyze-goal', '/analyze-reflection', '/breakdown-goal', '/generate-report']) {
    const route = routes.stack.find((layer) => layer.route?.path === path && layer.route.methods.post)?.route;
    assert.ok(route);
    assert.ok(route.stack.some((middleware) => middleware.handle === requirePersonalGeminiKey), `${path} must load the personal key`);
  }
});

test('AI key middleware gives the requested message when a student has no key', async () => {
  User.findById = () => ({ select: async () => ({ _id: 'student-1' }) });
  const res = responseRecorder();
  let calledNext = false;
  await requirePersonalGeminiKey({ authUser: { _id: 'student-1' } }, res, () => { calledNext = true; });
  assert.equal(res.statusCode, 400);
  assert.equal(res.payload.error, 'Please add your Gemini API key to use AI features.');
  assert.equal(calledNext, false);
});

test('AI key middleware decrypts for the request without changing the user response', async () => {
  User.findById = () => ({ select: async () => ({ _id: 'student-1', geminiApiKeyEncrypted: keyUtils.encryptGeminiApiKey(secretKey) }) });
  const req = { authUser: { _id: 'student-1' } };
  const res = responseRecorder();
  let calledNext = false;
  await requirePersonalGeminiKey(req, res, () => { calledNext = true; });
  assert.equal(req.geminiApiKey, secretKey);
  assert.equal(calledNext, true);
});
