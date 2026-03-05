import { Router } from 'express';
import { pool } from '../config/db.js';
import { hashPassword, verifyPassword, createToken, verifyToken } from './authService.js';
import { generateTokenPair, hashToken, sendVerificationEmail, sendPasswordResetEmail } from '../email/emailService.js';

const router = Router();

// Middleware to extract user from token
function authMiddleware(req, res, next) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' });
  }
  const payload = verifyToken(header.slice(7));
  if (!payload) {
    return res.status(401).json({ error: 'Invalid token' });
  }
  req.user = payload;
  next();
}

router.post('/register', async (req, res) => {
  try {
    const { username, email, password } = req.body;
    if (!username || !email || !password) {
      return res.status(400).json({ error: 'Username, email, and password are required' });
    }
    if (username.length < 3 || username.length > 32) {
      return res.status(400).json({ error: 'Username must be 3-32 characters' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    const hash = await hashPassword(password);
    const result = await pool.query(
      'INSERT INTO users (username, email, password_hash) VALUES ($1, $2, $3) RETURNING id, username, email, rating, avatar_id, is_admin, email_verified, created_at',
      [username.trim(), email.trim().toLowerCase(), hash]
    );
    const user = result.rows[0];
    const token = createToken(user);

    // Send verification email (fire-and-forget)
    try {
      const { token: verifyToken, hash: verifyHash } = generateTokenPair();
      await pool.query(
        'UPDATE users SET verification_token_hash = $1, verification_token_expires = NOW() + INTERVAL \'24 hours\' WHERE id = $2',
        [verifyHash, user.id]
      );
      sendVerificationEmail(user.email, user.username, verifyToken).catch((err) =>
        console.error('Verification email error:', err.message)
      );
    } catch (err) {
      console.error('Verification token error:', err.message);
    }

    res.status(201).json({ user, token });
  } catch (err) {
    if (err.code === '23505') {
      const field = err.constraint?.includes('username') ? 'Username' : 'Email';
      return res.status(409).json({ error: `${field} already taken` });
    }
    console.error('Register error:', err);
    res.status(500).json({ error: 'Registration failed' });
  }
});

router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }

    const result = await pool.query(
      'SELECT id, username, email, password_hash, rating, avatar_id, is_admin, is_banned, email_verified, created_at FROM users WHERE username = $1',
      [username.trim()]
    );
    const row = result.rows[0];
    if (!row || !(await verifyPassword(password, row.password_hash))) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    if (row.is_banned) {
      return res.status(403).json({ error: 'Account is banned' });
    }

    const { password_hash, is_banned: _banned, ...user } = row;
    const token = createToken(user);
    res.json({ user, token });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

router.get('/me', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, username, email, rating, avatar_id, is_admin, email_verified, created_at FROM users WHERE id = $1',
      [req.user.id]
    );
    if (!result.rows[0]) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.json({ user: result.rows[0] });
  } catch (err) {
    console.error('Me error:', err);
    res.status(500).json({ error: 'Failed to fetch user' });
  }
});

const VALID_AVATARS = [
  'default', 'pawn_w', 'pawn_b', 'knight_w', 'knight_b', 'bishop_w', 'bishop_b',
  'rook_w', 'rook_b', 'queen_w', 'queen_b', 'king_w', 'king_b', 'flame', 'lightning', 'crown',
];

router.put('/profile', authMiddleware, async (req, res) => {
  try {
    const { username, avatar_id } = req.body;
    if (!username || username.length < 3 || username.length > 32) {
      return res.status(400).json({ error: 'Username must be 3-32 characters' });
    }
    if (avatar_id && !VALID_AVATARS.includes(avatar_id)) {
      return res.status(400).json({ error: 'Invalid avatar' });
    }

    const avatarValue = avatar_id || 'default';
    const result = await pool.query(
      'UPDATE users SET username = $1, avatar_id = $2 WHERE id = $3 RETURNING id, username, email, rating, avatar_id, created_at',
      [username.trim(), avatarValue, req.user.id]
    );
    if (!result.rows[0]) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.json({ user: result.rows[0] });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Username already taken' });
    }
    console.error('Profile update error:', err);
    res.status(500).json({ error: 'Update failed' });
  }
});

// GET /verify-email?token=...
router.get('/verify-email', async (req, res) => {
  try {
    const { token } = req.query;
    if (!token) return res.status(400).json({ error: 'Token required' });

    const hash = hashToken(token);
    const result = await pool.query(
      `UPDATE users SET email_verified = true, verification_token_hash = NULL, verification_token_expires = NULL
       WHERE verification_token_hash = $1 AND verification_token_expires > NOW()
       RETURNING id, username`,
      [hash]
    );

    if (!result.rows[0]) {
      return res.status(400).json({ error: 'Invalid or expired verification link' });
    }

    res.json({ success: true, username: result.rows[0].username });
  } catch (err) {
    console.error('Verify email error:', err);
    res.status(500).json({ error: 'Verification failed' });
  }
});

// POST /forgot-password
router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email required' });

    // Always return same message to prevent enumeration
    const genericMsg = 'If an account with that email exists, a reset link has been sent.';

    const userResult = await pool.query(
      'SELECT id, username, email, last_email_sent_at FROM users WHERE email = $1',
      [email.trim().toLowerCase()]
    );
    const user = userResult.rows[0];
    if (!user) return res.json({ message: genericMsg });

    // Rate limit: 60s between emails
    if (user.last_email_sent_at && Date.now() - new Date(user.last_email_sent_at).getTime() < 60000) {
      return res.json({ message: genericMsg });
    }

    const { token, hash } = generateTokenPair();
    await pool.query(
      `UPDATE users SET reset_token_hash = $1, reset_token_expires = NOW() + INTERVAL '1 hour', last_email_sent_at = NOW() WHERE id = $2`,
      [hash, user.id]
    );

    sendPasswordResetEmail(user.email, user.username, token).catch((err) =>
      console.error('Reset email error:', err.message)
    );

    res.json({ message: genericMsg });
  } catch (err) {
    console.error('Forgot password error:', err);
    res.status(500).json({ error: 'Request failed' });
  }
});

// POST /reset-password
router.post('/reset-password', async (req, res) => {
  try {
    const { token, password } = req.body;
    if (!token || !password) return res.status(400).json({ error: 'Token and password required' });
    if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });

    const hash = hashToken(token);
    const userResult = await pool.query(
      'SELECT id FROM users WHERE reset_token_hash = $1 AND reset_token_expires > NOW()',
      [hash]
    );

    if (!userResult.rows[0]) {
      return res.status(400).json({ error: 'Invalid or expired reset link' });
    }

    const newHash = await hashPassword(password);
    await pool.query(
      'UPDATE users SET password_hash = $1, reset_token_hash = NULL, reset_token_expires = NULL WHERE id = $2',
      [newHash, userResult.rows[0].id]
    );

    res.json({ success: true });
  } catch (err) {
    console.error('Reset password error:', err);
    res.status(500).json({ error: 'Password reset failed' });
  }
});

// POST /resend-verification (requires auth)
router.post('/resend-verification', authMiddleware, async (req, res) => {
  try {
    const userResult = await pool.query(
      'SELECT id, username, email, email_verified, last_email_sent_at FROM users WHERE id = $1',
      [req.user.id]
    );
    const user = userResult.rows[0];
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (user.email_verified) return res.json({ message: 'Email already verified' });

    // Rate limit: 60s
    if (user.last_email_sent_at && Date.now() - new Date(user.last_email_sent_at).getTime() < 60000) {
      return res.status(429).json({ error: 'Please wait before requesting another email' });
    }

    const { token, hash } = generateTokenPair();
    await pool.query(
      `UPDATE users SET verification_token_hash = $1, verification_token_expires = NOW() + INTERVAL '24 hours', last_email_sent_at = NOW() WHERE id = $2`,
      [hash, user.id]
    );

    await sendVerificationEmail(user.email, user.username, token);
    res.json({ message: 'Verification email sent' });
  } catch (err) {
    console.error('Resend verification error:', err);
    res.status(500).json({ error: 'Failed to send verification email' });
  }
});

export default router;
