import { Resend } from 'resend';
import crypto from 'crypto';

let resend = null;
const FROM_EMAIL = 'ELO Stakes <noreply@elostakes.com>';

function emailWrapper(bodyHtml, isAlert = false) {
  const accentColor = isAlert ? '#e53935' : '#7cb342';
  return `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; background: #121212; color: #ececec; border-radius: 12px; overflow: hidden;">
      <div style="padding: 20px 32px; background: #1a1a1a; border-bottom: 2px solid ${accentColor};">
        <span style="font-size: 18px; font-weight: 700; color: #ececec;">\u265A ELO Stakes</span>
      </div>
      <div style="padding: 32px;">
        ${bodyHtml}
      </div>
      <div style="padding: 16px 32px; background: #1a1a1a; border-top: 1px solid #2a2a2a; font-size: 12px; color: #5a5a5a; text-align: center;">
        &copy; ${new Date().getFullYear()} ELO Stakes &mdash; Play. Wager. Win.
      </div>
    </div>
  `;
}

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
    html: emailWrapper(`
        <h1 style="color: #7cb342; margin-bottom: 24px; font-size: 22px;">Welcome to ELO Stakes, ${username}!</h1>
        <p style="font-size: 16px; line-height: 1.5; color: #ececec;">Please verify your email address to complete your registration.</p>
        <a href="${verifyLink}" style="display: inline-block; margin: 24px 0; padding: 12px 32px; background: #7cb342; color: #fff; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 16px;">
          Verify Email
        </a>
        <p style="font-size: 13px; color: #a0a0a0;">This link expires in 24 hours. If you didn't create an account, you can ignore this email.</p>
    `),
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
    html: emailWrapper(`
        <h1 style="color: #7cb342; margin-bottom: 24px; font-size: 22px;">Password Reset</h1>
        <p style="font-size: 16px; line-height: 1.5; color: #ececec;">Hi ${username}, we received a request to reset your password.</p>
        <a href="${resetLink}" style="display: inline-block; margin: 24px 0; padding: 12px 32px; background: #7cb342; color: #fff; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 16px;">
          Reset Password
        </a>
        <p style="font-size: 13px; color: #a0a0a0;">This link expires in 1 hour. If you didn't request a reset, you can ignore this email.</p>
    `),
  });
  if (error) {
    console.error('Resend reset email error:', JSON.stringify(error));
    throw new Error(error.message || 'Failed to send reset email');
  }
  console.log('Reset email sent:', data?.id);
}

const ADMIN_EMAIL = 'jacobchamie@gmail.com';

export async function sendWithdrawalPendingEmail(email, username, { amountTokens, amountCrypto, asset, chain, toAddress, fee }) {
  if (!resend) { console.warn('Resend not initialized, skipping withdrawal pending email'); return; }

  const { data, error } = await resend.emails.send({
    from: FROM_EMAIL,
    to: email,
    subject: 'ELO Stakes — Withdrawal Pending',
    html: emailWrapper(`
        <h1 style="color: #7cb342; margin-bottom: 24px; font-size: 22px;">Withdrawal Pending</h1>
        <p style="font-size: 16px; line-height: 1.5; color: #ececec;">Hi ${username}, your withdrawal request has been submitted and is awaiting review.</p>
        <table style="width: 100%; margin: 20px 0; border-collapse: collapse;">
          <tr><td style="padding: 8px 0; color: #a0a0a0;">Asset</td><td style="padding: 8px 0; text-align: right; color: #ececec;">${asset} (${chain})</td></tr>
          <tr><td style="padding: 8px 0; color: #a0a0a0;">Amount</td><td style="padding: 8px 0; text-align: right; color: #ececec;">${Number(amountTokens).toFixed(2)} tokens</td></tr>
          <tr><td style="padding: 8px 0; color: #a0a0a0;">Fee</td><td style="padding: 8px 0; text-align: right; color: #ececec;">${Number(fee).toFixed(2)} tokens</td></tr>
          <tr><td style="padding: 8px 0; color: #a0a0a0;">You Receive</td><td style="padding: 8px 0; text-align: right; color: #ececec;">${Number(amountCrypto).toFixed(6)} ${asset}</td></tr>
          <tr><td style="padding: 8px 0; color: #a0a0a0;">To Address</td><td style="padding: 8px 0; text-align: right; font-size: 11px; word-break: break-all; color: #ececec;">${toAddress}</td></tr>
        </table>
        <p style="font-size: 14px; color: #a0a0a0;">Our team will review your withdrawal shortly. You will be notified once it has been processed.</p>
    `),
  });
  if (error) {
    console.error('Resend withdrawal pending email error:', JSON.stringify(error));
  } else {
    console.log('Withdrawal pending email sent to user:', data?.id);
  }
}

export async function sendWithdrawalAdminNotification({ withdrawalId, username, email, amountTokens, amountCrypto, asset, chain, toAddress, fee }) {
  if (!resend) { console.warn('Resend not initialized, skipping admin withdrawal notification'); return; }
  const appUrl = process.env.APP_URL || 'http://localhost:5173';

  const { data, error } = await resend.emails.send({
    from: FROM_EMAIL,
    to: ADMIN_EMAIL,
    subject: `Withdrawal Request — ${username} — ${Number(amountTokens).toFixed(2)} tokens`,
    html: emailWrapper(`
        <h1 style="color: #e53935; margin-bottom: 24px; font-size: 22px;">New Withdrawal Request</h1>
        <p style="font-size: 16px; line-height: 1.5; color: #ececec;">A user has requested a withdrawal that requires your approval.</p>
        <table style="width: 100%; margin: 20px 0; border-collapse: collapse;">
          <tr><td style="padding: 8px 0; color: #a0a0a0;">User</td><td style="padding: 8px 0; text-align: right; color: #ececec;">${username} (${email})</td></tr>
          <tr><td style="padding: 8px 0; color: #a0a0a0;">Withdrawal ID</td><td style="padding: 8px 0; text-align: right; font-size: 12px; color: #ececec;">${withdrawalId}</td></tr>
          <tr><td style="padding: 8px 0; color: #a0a0a0;">Amount</td><td style="padding: 8px 0; text-align: right; color: #ececec;">${Number(amountTokens).toFixed(2)} tokens</td></tr>
          <tr><td style="padding: 8px 0; color: #a0a0a0;">Fee</td><td style="padding: 8px 0; text-align: right; color: #ececec;">${Number(fee).toFixed(2)} tokens</td></tr>
          <tr><td style="padding: 8px 0; color: #a0a0a0;">Crypto Out</td><td style="padding: 8px 0; text-align: right; color: #ececec;">${Number(amountCrypto).toFixed(6)} ${asset} (${chain})</td></tr>
          <tr><td style="padding: 8px 0; color: #a0a0a0;">To Address</td><td style="padding: 8px 0; text-align: right; font-size: 11px; word-break: break-all; color: #ececec;">${toAddress}</td></tr>
        </table>
        <p style="font-size: 14px; color: #a0a0a0;">Review their recent games before approving. Go to the admin panel to approve or reject.</p>
        <a href="${appUrl}/admin" style="display: inline-block; margin: 16px 0; padding: 12px 32px; background: #e53935; color: #fff; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 16px;">
          Open Admin Panel
        </a>
    `, true),
  });
  if (error) {
    console.error('Resend admin withdrawal notification error:', JSON.stringify(error));
  } else {
    console.log('Admin withdrawal notification sent:', data?.id);
  }
}

export async function sendEngineFlagAlert({ username, userId, gameId, trustScore, avgStrength, engineCorr, acpl, flagReason }) {
  if (!resend) { console.warn('Resend not initialized, skipping engine flag alert'); return; }
  const appUrl = process.env.APP_URL || 'http://localhost:5173';

  const { data, error } = await resend.emails.send({
    from: FROM_EMAIL,
    to: ADMIN_EMAIL,
    subject: `Engine Alert — ${username} flagged (trust: ${trustScore.toFixed(0)})`,
    html: emailWrapper(`
        <h1 style="color: #e53935; margin-bottom: 24px; font-size: 22px;">Engine Assistance Detected</h1>
        <p style="font-size: 16px; line-height: 1.5; color: #ececec;">A player has been flagged for suspected engine use.</p>
        <table style="width: 100%; margin: 20px 0; border-collapse: collapse;">
          <tr><td style="padding: 8px 0; color: #a0a0a0;">Player</td><td style="padding: 8px 0; text-align: right; color: #ececec;">${username}</td></tr>
          <tr><td style="padding: 8px 0; color: #a0a0a0;">User ID</td><td style="padding: 8px 0; text-align: right; font-size: 12px; color: #ececec;">${userId}</td></tr>
          ${gameId ? `<tr><td style="padding: 8px 0; color: #a0a0a0;">Game ID</td><td style="padding: 8px 0; text-align: right; font-size: 12px; color: #ececec;">${gameId}</td></tr>` : ''}
          <tr><td style="padding: 8px 0; color: #a0a0a0;">Trust Score</td><td style="padding: 8px 0; text-align: right; color: #e53935; font-weight: 600;">${trustScore.toFixed(1)} / 100</td></tr>
          <tr><td style="padding: 8px 0; color: #a0a0a0;">Avg Strength</td><td style="padding: 8px 0; text-align: right; color: #ececec;">${avgStrength.toFixed(1)}</td></tr>
          <tr><td style="padding: 8px 0; color: #a0a0a0;">Engine Correlation</td><td style="padding: 8px 0; text-align: right; color: #ececec;">${(engineCorr * 100).toFixed(1)}%</td></tr>
          <tr><td style="padding: 8px 0; color: #a0a0a0;">Avg CPL</td><td style="padding: 8px 0; text-align: right; color: #ececec;">${acpl.toFixed(1)}</td></tr>
        </table>
        <p style="font-size: 13px; color: #a0a0a0;">${flagReason}</p>
        <a href="${appUrl}/admin" style="display: inline-block; margin: 16px 0; padding: 12px 32px; background: #e53935; color: #fff; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 16px;">
          Review in Admin Panel
        </a>
    `, true),
  });
  if (error) {
    console.error('Resend engine flag alert error:', JSON.stringify(error));
  } else {
    console.log('Engine flag alert sent to admin:', data?.id);
  }
}

export async function sendDepositReceiptEmail(email, username, { amount, asset, chain, usdValue, tokensCredited, txHash }) {
  if (!resend) { console.warn('Resend not initialized, skipping receipt email'); return; }

  const { data, error } = await resend.emails.send({
    from: FROM_EMAIL,
    to: email,
    subject: 'ELO Stakes — Deposit Receipt',
    html: emailWrapper(`
        <h1 style="color: #7cb342; margin-bottom: 24px; font-size: 22px;">Deposit Received</h1>
        <p style="font-size: 16px; line-height: 1.5; color: #ececec;">Hi ${username}, your deposit has been confirmed and credited.</p>
        <table style="width: 100%; margin: 20px 0; border-collapse: collapse;">
          <tr><td style="padding: 8px 0; color: #a0a0a0;">Asset</td><td style="padding: 8px 0; text-align: right; color: #ececec;">${asset} (${chain})</td></tr>
          <tr><td style="padding: 8px 0; color: #a0a0a0;">Amount</td><td style="padding: 8px 0; text-align: right; color: #ececec;">${Number(amount).toFixed(6)} ${asset}</td></tr>
          <tr><td style="padding: 8px 0; color: #a0a0a0;">USD Value</td><td style="padding: 8px 0; text-align: right; color: #ececec;">$${Number(usdValue).toFixed(2)}</td></tr>
          <tr style="border-top: 1px solid #2a2a2a;"><td style="padding: 12px 0; color: #7cb342; font-weight: 600;">Tokens Credited</td><td style="padding: 12px 0; text-align: right; color: #7cb342; font-weight: 600;">${Number(tokensCredited).toFixed(2)}</td></tr>
        </table>
        <p style="font-size: 12px; color: #5a5a5a; word-break: break-all;">Tx: ${txHash}</p>
    `),
  });
  if (error) {
    console.error('Resend receipt email error:', JSON.stringify(error));
    throw new Error(error.message || 'Failed to send receipt email');
  }
  console.log('Deposit receipt email sent:', data?.id);
}
