const crypto = require('node:crypto');
const User = require('../models/User');

const KEY_ENV_NAME = 'GEMINI_KEY_ENCRYPTION_KEY';

const getEncryptionKey = () => {
  const value = process.env[KEY_ENV_NAME];
  if (typeof value !== 'string' || !/^[a-fA-F0-9]{64}$/.test(value)) {
    throw new Error(`${KEY_ENV_NAME} must be a 32-byte key encoded as 64 hexadecimal characters.`);
  }
  return Buffer.from(value, 'hex');
};

const encryptGeminiApiKey = (apiKey) => {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getEncryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(apiKey, 'utf8'), cipher.final()]);
  return JSON.stringify({
    version: 1,
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    ciphertext: ciphertext.toString('base64')
  });
};

const decryptGeminiApiKey = (encryptedValue) => {
  const value = JSON.parse(encryptedValue);
  if (value.version !== 1 || !value.iv || !value.tag || !value.ciphertext) {
    throw new Error('Stored Gemini API key has an unsupported encrypted format.');
  }
  const decipher = crypto.createDecipheriv('aes-256-gcm', getEncryptionKey(), Buffer.from(value.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(value.tag, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(value.ciphertext, 'base64')),
    decipher.final()
  ]).toString('utf8');
};

const getStudentGeminiApiKey = async (studentId) => {
  const user = await User.findById(studentId).select('_id +geminiApiKeyEncrypted');
  if (!user?.geminiApiKeyEncrypted) return null;
  return decryptGeminiApiKey(user.geminiApiKeyEncrypted);
};

module.exports = { encryptGeminiApiKey, decryptGeminiApiKey, getStudentGeminiApiKey, KEY_ENV_NAME };
