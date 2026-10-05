const User = require('../models/User');
const { encryptGeminiApiKey, KEY_ENV_NAME } = require('../utils/studentGeminiKey');

const getGeminiKeySettings = async (req, res) => {
  try {
    const user = await User.findById(req.authUser._id).select('_id +geminiApiKeyEncrypted +geminiApiKeyUpdatedAt');
    if (!user) return res.status(404).json({ success: false, error: 'Student account not found.' });
    return res.json({ success: true, configured: Boolean(user.geminiApiKeyEncrypted), updatedAt: user.geminiApiKeyUpdatedAt || null });
  } catch (error) {
    console.error('Gemini key settings read failed:', error?.name || 'database error');
    return res.status(500).json({ success: false, error: 'Unable to load AI key settings.' });
  }
};

const saveGeminiKeySettings = async (req, res) => {
  const { apiKey } = req.body || {};
  if (typeof apiKey !== 'string' || apiKey.trim().length < 20 || apiKey.trim().length > 256) {
    return res.status(400).json({ success: false, error: 'Enter a valid Gemini API key.' });
  }
  let encrypted;
  try {
    encrypted = encryptGeminiApiKey(apiKey.trim());
  } catch (error) {
    console.error('Gemini key encryption is not configured:', error?.message?.split(' ')[0] || 'configuration error');
    return res.status(503).json({ success: false, error: `Secure AI key storage is not configured. Set ${KEY_ENV_NAME} in the backend environment.` });
  }

  try {
    const result = await User.updateOne({ _id: req.authUser._id }, {
      $set: { geminiApiKeyEncrypted: encrypted, geminiApiKeyUpdatedAt: new Date() }
    });
    if (!result.matchedCount) return res.status(404).json({ success: false, error: 'Student account not found.' });
    return res.json({ success: true, configured: true, message: 'Gemini API key saved securely.' });
  } catch (error) {
    console.error('Gemini key settings save failed:', error?.name || 'database error');
    return res.status(500).json({ success: false, error: 'Unable to save the Gemini API key.' });
  }
};

const deleteGeminiKeySettings = async (req, res) => {
  try {
    const result = await User.updateOne({ _id: req.authUser._id }, {
      $unset: { geminiApiKeyEncrypted: '', geminiApiKeyUpdatedAt: '' }
    });
    if (!result.matchedCount) return res.status(404).json({ success: false, error: 'Student account not found.' });
    return res.json({ success: true, configured: false, message: 'Gemini API key removed.' });
  } catch (error) {
    console.error('Gemini key settings delete failed:', error?.name || 'database error');
    return res.status(500).json({ success: false, error: 'Unable to remove the Gemini API key.' });
  }
};

module.exports = { getGeminiKeySettings, saveGeminiKeySettings, deleteGeminiKeySettings };
