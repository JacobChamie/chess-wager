import { Router } from 'express';
import { pool } from '../config/db.js';
import { hashPassword, verifyPassword, createToken, verifyToken } from './authService.js';

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
      'INSERT INTO users (username, email, password_hash) VALUES ($1, $2, $3) RETURNING id, username, email, rating, avatar_id, created_at',
      [username.trim(), email.trim().toLowerCase(), hash]
    );
    const user = result.rows[0];
    const token = createToken(user);
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
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const result = await pool.query(
      'SELECT id, username, email, password_hash, rating, avatar_id, created_at FROM users WHERE email = $1',
      [email.trim().toLowerCase()]
    );
    const row = result.rows[0];
    if (!row || !(await verifyPassword(password, row.password_hash))) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const { password_hash, ...user } = row;
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
      'SELECT id, username, email, rating, avatar_id, created_at FROM users WHERE id = $1',
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

export default router;
