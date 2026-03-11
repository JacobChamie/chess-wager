import { Resend } from 'resend';
import crypto from 'crypto';

let resend = null;
const FROM_EMAIL = 'ELO Stakes <noreply@elostakes.com>';

export function initEmailTransporter() {
  const apiKey = process.env.RESEND_API_KEY;

  if (!apiKey) {
    console.warn('RESEND_API_KEY not configured — email sending disabled');
    return;
  }

  resend = new Resend(apiKey);
  console.log('Resend email client initialized');
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
  if (!resend) { console.warn('Resend not initialized, skipping verification email'); return; }
  const appUrl = process.env.APP_URL || 'http://localhost:5173';
  const verifyLink = `${appUrl}/verify-email?token=${token}`;

  const { data, error } = await resend.emails.send({
    from: FROM_EMAIL,
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
  if (error) {
    console.error('Resend verification email error:', JSON.stringify(error));
    throw new Error(error.message || 'Failed to send verification email');
  }
  console.log('Verification email sent:', data?.id);
}

export async function sendPasswordResetEmail(email, username, token) {
  if (!resend) { console.warn('Resend not initialized, skipping reset email'); return; }
  const appUrl = process.env.APP_URL || 'http://localhost:5173';
  const resetLink = `${appUrl}/reset-password?token=${token}`;

  const { data, error } = await resend.emails.send({
    from: FROM_EMAIL,
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
  if (error) {
    console.error('Resend reset email error:', JSON.stringify(error));
    throw new Error(error.message || 'Failed to send reset email');
  }
  console.log('Reset email sent:', data?.id);
}

export async function sendDepositReceiptEmail(email, username, { amount, asset, chain, usdValue, tokensCredited, txHash }) {
  if (!resend) { console.warn('Resend not initialized, skipping receipt email'); return; }

  const { data, error } = await resend.emails.send({
    from: FROM_EMAIL,
    to: email,
    subject: 'ELO Stakes — Deposit Receipt',
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px; background: #1a1a2e; color: #e0e0e0; border-radius: 12px;">
        <h1 style="color: #7c3aed; margin-bottom: 24px;">Deposit Received</h1>
        <p style="font-size: 16px; line-height: 1.5;">Hi ${username}, your deposit has been confirmed and credited.</p>
        <table style="width: 100%; margin: 20px 0; border-collapse: collapse;">
          <tr><td style="padding: 8px 0; color: #999;">Asset</td><td style="padding: 8px 0; text-align: right;">${asset} (${chain})</td></tr>
          <tr><td style="padding: 8px 0; color: #999;">Amount</td><td style="padding: 8px 0; text-align: right;">${Number(amount).toFixed(6)} ${asset}</td></tr>
          <tr><td style="padding: 8px 0; color: #999;">USD Value</td><td style="padding: 8px 0; text-align: right;">$${Number(usdValue).toFixed(2)}</td></tr>
          <tr style="border-top: 1px solid #333;"><td style="padding: 12px 0; color: #7c3aed; font-weight: 600;">Tokens Credited</td><td style="padding: 12px 0; text-align: right; color: #7c3aed; font-weight: 600;">${Number(tokensCredited).toFixed(2)}</td></tr>
        </table>
        <p style="font-size: 12px; color: #666; word-break: break-all;">Tx: ${txHash}</p>
        <p style="font-size: 13px; color: #999; margin-top: 16px;">Thank you for using ELO Stakes!</p>
      </div>
    `,
  });
  if (error) {
    console.error('Resend receipt email error:', JSON.stringify(error));
    throw new Error(error.message || 'Failed to send receipt email');
  }
  console.log('Deposit receipt email sent:', data?.id);
}
