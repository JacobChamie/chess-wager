import { createTransport } from 'nodemailer';
import crypto from 'crypto';

let transporter = null;

export function initEmailTransporter() {
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!user || !pass) {
    console.warn('SMTP credentials not configured — email sending disabled');
    return;
  }

  transporter = createTransport({
    host: 'smtp.gmail.com',
    port: 587,
    secure: false,
    auth: { user, pass },
  });

  transporter.verify()
    .then(() => console.log('Email transporter ready'))
    .catch((err) => console.error('Email transporter verification failed:', err.message));
}

export function generateTokenPair() {
  const token = crypto.randomBytes(32).toString('hex');
  const hash = hashToken(token);
  return { token, hash };
}

export function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export async function sendVerificationEmail(email, username, token) {
  if (!transporter) return;
  const appUrl = process.env.APP_URL || 'http://localhost:5173';
  const verifyLink = `${appUrl}/verify-email?token=${token}`;

  await transporter.sendMail({
    from: `"ELO Stakes" <${process.env.SMTP_USER}>`,
    to: email,
    subject: 'Verify your ELO Stakes account',
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px; background: #1a1a2e; color: #e0e0e0; border-radius: 12px;">
        <h1 style="color: #7c3aed; margin-bottom: 24px;">Welcome to ELO Stakes, ${username}!</h1>
        <p style="font-size: 16px; line-height: 1.5;">Please verify your email address to complete your registration.</p>
        <a href="${verifyLink}" style="display: inline-block; margin: 24px 0; padding: 12px 32px; background: #7c3aed; color: #fff; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 16px;">
          Verify Email
        </a>
        <p style="font-size: 13px; color: #999;">This link expires in 24 hours. If you didn't create an account, you can ignore this email.</p>
      </div>
    `,
  });
}

export async function sendPasswordResetEmail(email, username, token) {
  if (!transporter) return;
  const appUrl = process.env.APP_URL || 'http://localhost:5173';
  const resetLink = `${appUrl}/reset-password?token=${token}`;

  await transporter.sendMail({
    from: `"ELO Stakes" <${process.env.SMTP_USER}>`,
    to: email,
    subject: 'Reset your ELO Stakes password',
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px; background: #1a1a2e; color: #e0e0e0; border-radius: 12px;">
        <h1 style="color: #7c3aed; margin-bottom: 24px;">Password Reset</h1>
        <p style="font-size: 16px; line-height: 1.5;">Hi ${username}, we received a request to reset your password.</p>
        <a href="${resetLink}" style="display: inline-block; margin: 24px 0; padding: 12px 32px; background: #7c3aed; color: #fff; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 16px;">
          Reset Password
        </a>
        <p style="font-size: 13px; color: #999;">This link expires in 1 hour. If you didn't request a reset, you can ignore this email.</p>
      </div>
    `,
  });
}
