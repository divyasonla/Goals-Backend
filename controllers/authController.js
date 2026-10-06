const User = require('../models/User');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { sendPasswordResetOtpEmail } = require('../utils/mailer');

// Signup Controller
exports.signup = async (req, res) => {
  const body = req.body || {};
  const { name, email, password, role } = body;

  // Public signup cannot assign privileged teacher/Admin/AA access. Existing teacher
  // accounts continue to use the existing role stored in MongoDB.
  if (['teacher', 'admin', 'aa'].includes(String(role || '').toLowerCase())) {
    return res.status(403).json({ message: 'Teacher/Admin accounts must be provisioned by an administrator.' });
  }

  try {
    // Check if user already exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      console.error('Signup error: User already exists');
      return res.status(400).json({ message: 'User already exists' });
    }

    // Create new user
    const user = new User({ name, email, password, role: 'student' });
    await user.save();

    // Generate JWT token
    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: '1h' });

    res.status(201).json({
      message: 'User created successfully',
      token,
      user: { id: user._id, username: user.name, email: user.email, role: user.role }
    });
  } catch (error) {
    console.error('Signup error:', error);
    res.status(500).json({ message: 'Server error', error: error.message || error });
  }
};

// Login Controller
exports.login = async (req, res) => {
  const body = req.body || {};
  const { email, password } = body;

  try {
    // Check if user exists
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Compare passwords
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ message: 'Invalid credentials' });
    }

    // Generate JWT token
    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: '1h' });

    res.status(200).json({ token, user: { id: user._id, username: user.name, email: user.email, role: user.role } });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message || error });
  }
};

const GENERIC_OTP_MESSAGE = 'If an account exists for this email, an OTP has been sent.';
const OTP_COOLDOWN_MS = 60 * 1000; // 60 seconds
const OTP_EXPIRY_MS = 10 * 60 * 1000; // 10 minutes
const MAX_OTP_ATTEMPTS = 5;

// Forgot Password / Request OTP Controller
exports.forgotPassword = async (req, res) => {
  const { email } = req.body || {};
  if (!email || typeof email !== 'string' || !email.trim()) {
    return res.status(400).json({ success: false, error: 'Email is required.', message: 'Email is required.' });
  }

  const normalizedEmail = email.trim().toLowerCase();

  try {
    const user = await User.findOne({ email: { $regex: new RegExp(`^${normalizedEmail}$`, 'i') } });
    if (!user) {
      // Email enumeration safety: do not reveal that user doesn't exist
      return res.status(200).json({ success: true, message: GENERIC_OTP_MESSAGE });
    }

    // Check resend cooldown
    if (user.otpCreatedAt && (Date.now() - user.otpCreatedAt.getTime() < OTP_COOLDOWN_MS)) {
      const remainingSeconds = Math.ceil((OTP_COOLDOWN_MS - (Date.now() - user.otpCreatedAt.getTime())) / 1000);
      return res.status(429).json({
        success: false,
        error: `Please wait ${remainingSeconds} second(s) before requesting another OTP.`,
        message: `Please wait ${remainingSeconds} second(s) before requesting another OTP.`,
        retryAfter: remainingSeconds
      });
    }

    // Generate secure 6-digit numeric OTP
    const rawOtp = String(crypto.randomInt(100000, 1000000));

    // Hash OTP before storage
    const otpHash = await bcrypt.hash(rawOtp, 10);

    // Save hash, expiration, creation time and reset attempt count
    user.otpHash = otpHash;
    user.otpExpiresAt = new Date(Date.now() + OTP_EXPIRY_MS);
    user.otpCreatedAt = new Date();
    user.otpAttempts = 0;
    user.resetToken = undefined;
    user.resetExpires = undefined;
    await user.save();

    // Send email using existing SMTP/transport infrastructure
    // Do NOT log or return rawOtp in response
    await sendPasswordResetOtpEmail({ to: user.email, otp: rawOtp });

    return res.status(200).json({
      success: true,
      message: GENERIC_OTP_MESSAGE
    });
  } catch (error) {
    console.error('Forgot password error:', error);
    return res.status(500).json({ success: false, error: 'Server error', message: 'Server error' });
  }
};

// Verify OTP Controller
exports.verifyOtp = async (req, res) => {
  const { email, otp } = req.body || {};

  if (!email || typeof email !== 'string' || !email.trim()) {
    return res.status(400).json({ success: false, error: 'Email is required.', message: 'Email is required.' });
  }
  const cleanOtp = String(otp || '').trim();
  if (!cleanOtp || !/^\d{6}$/.test(cleanOtp)) {
    return res.status(400).json({ success: false, error: 'Please enter a valid 6-digit OTP.', message: 'Please enter a valid 6-digit OTP.' });
  }

  const normalizedEmail = email.trim().toLowerCase();

  try {
    const user = await User.findOne({ email: { $regex: new RegExp(`^${normalizedEmail}$`, 'i') } });
    if (!user || !user.otpHash) {
      return res.status(400).json({ success: false, error: 'Invalid or expired OTP.', message: 'Invalid or expired OTP.' });
    }

    // Check attempt limit
    if ((user.otpAttempts || 0) >= MAX_OTP_ATTEMPTS) {
      user.otpHash = undefined;
      user.otpExpiresAt = undefined;
      await user.save();
      return res.status(429).json({
        success: false,
        error: 'Maximum verification attempts exceeded. Please request a new OTP.',
        message: 'Maximum verification attempts exceeded. Please request a new OTP.'
      });
    }

    // Check expiration
    if (!user.otpExpiresAt || user.otpExpiresAt.getTime() < Date.now()) {
      user.otpHash = undefined;
      user.otpExpiresAt = undefined;
      await user.save();
      return res.status(400).json({ success: false, error: 'OTP has expired. Please request a new one.', message: 'OTP has expired. Please request a new one.' });
    }

    // Verify OTP hash
    const isMatch = await bcrypt.compare(cleanOtp, user.otpHash);
    if (!isMatch) {
      user.otpAttempts = (user.otpAttempts || 0) + 1;
      await user.save();
      const remaining = MAX_OTP_ATTEMPTS - user.otpAttempts;
      if (remaining <= 0) {
        user.otpHash = undefined;
        user.otpExpiresAt = undefined;
        await user.save();
        return res.status(429).json({
          success: false,
          error: 'Maximum verification attempts exceeded. Please request a new OTP.',
          message: 'Maximum verification attempts exceeded. Please request a new OTP.'
        });
      }
      return res.status(400).json({
        success: false,
        error: `Invalid OTP. ${remaining} attempt(s) remaining.`,
        message: `Invalid OTP. ${remaining} attempt(s) remaining.`,
        remainingAttempts: remaining
      });
    }

    // OTP is valid -> Invalidate OTP (single use)
    user.otpHash = undefined;
    user.otpExpiresAt = undefined;
    user.otpAttempts = 0;

    // Issue short-lived, single-use reset authorization token (15 mins)
    const resetToken = jwt.sign(
      { id: user._id, purpose: 'password_reset' },
      process.env.JWT_SECRET,
      { expiresIn: '15m' }
    );
    user.resetToken = resetToken;
    user.resetExpires = new Date(Date.now() + 15 * 60 * 1000);
    await user.save();

    return res.status(200).json({
      success: true,
      message: 'OTP verified successfully.',
      resetToken
    });
  } catch (error) {
    console.error('Verify OTP error:', error);
    return res.status(500).json({ success: false, error: 'Server error', message: 'Server error' });
  }
};

// Reset Password Controller
exports.resetPassword = async (req, res) => {
  const { token, resetToken: providedResetToken, newPassword, confirmPassword } = req.body || {};
  const activeToken = providedResetToken || token;

  if (!activeToken || !newPassword) {
    return res.status(400).json({
      success: false,
      error: 'Reset token and new password are required.',
      message: 'Reset token and new password are required.'
    });
  }

  if (confirmPassword !== undefined && newPassword !== confirmPassword) {
    return res.status(400).json({
      success: false,
      error: 'Passwords do not match.',
      message: 'Passwords do not match.'
    });
  }

  if (typeof newPassword !== 'string' || newPassword.length < 6) {
    return res.status(400).json({
      success: false,
      error: 'Password must be at least 6 characters long.',
      message: 'Password must be at least 6 characters long.'
    });
  }

  try {
    let decoded;
    try {
      decoded = jwt.verify(activeToken, process.env.JWT_SECRET);
    } catch {
      return res.status(400).json({
        success: false,
        error: 'Invalid or expired reset token.',
        message: 'Invalid or expired reset token.'
      });
    }

    if (decoded.purpose !== 'password_reset') {
      return res.status(400).json({
        success: false,
        error: 'Invalid reset token.',
        message: 'Invalid reset token.'
      });
    }

    const user = await User.findOne({
      _id: decoded.id,
      resetToken: activeToken,
      resetExpires: { $gt: new Date() }
    });

    if (!user) {
      return res.status(400).json({
        success: false,
        error: 'Invalid or expired reset token.',
        message: 'Invalid or expired reset token.'
      });
    }

    // Invalidate reset token (single-use)
    user.resetToken = undefined;
    user.resetExpires = undefined;

    // Update password (User.pre('save') handles bcrypt hashing)
    user.password = newPassword;
    await user.save();

    return res.status(200).json({
      success: true,
      message: 'Password has been reset successfully. You can now login with your new password.'
    });
  } catch (error) {
    console.error('Reset password error:', error);
    return res.status(500).json({ success: false, error: 'Server error', message: 'Server error' });
  }
};

