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

const sendPasswordResetOtpEmail = async ({ to, otp, transport = getTransport() }) => {
  if (!transport || !to) {
    return { sent: false, reason: 'smtp_not_configured' };
  }

  const mailOptions = {
    from: process.env.EMAIL_FROM || 'Goal Setting App <no-reply@example.com>',
    to,
    subject: 'Password Reset OTP',
    text: [
      'Password Reset OTP',
      '',
      `Your OTP is: ${otp}`,
      '',
      'This OTP will expire in 10 minutes.',
      '',
      'If you did not request a password reset, please ignore this email.'
    ].join('\n')
  };

  try {
    await transport.sendMail(mailOptions);
    return { sent: true };
  } catch (error) {
    console.error('Password reset OTP email failed to send:', error?.message || 'mail transport error');
    return { sent: false, reason: 'send_failed', error: error?.message };
  }
};

module.exports = {
  getTransport,
  sendPasswordResetOtpEmail
};
