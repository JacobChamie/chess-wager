import { Router } from 'express';
import { pool } from '../config/db.js';
import { verifyToken } from '../auth/authService.js';

const router = Router();

// Admin middleware
function adminMiddleware(req, res, next) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' });
  }
  const payload = verifyToken(header.slice(7));
  if (!payload) {
    return res.status(401).json({ error: 'Invalid token' });
  }
  if (!payload.is_admin) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  req.user = payload;
  next();
}

// List all users with game count and ban status
router.get('/users', adminMiddleware, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT u.id, u.username, u.email, u.rating, u.is_admin, u.is_banned, u.created_at,
        (SELECT COUNT(*) FROM games g WHERE g.white_user_id = u.id OR g.black_user_id = u.id) AS game_count
      FROM users u
      ORDER BY u.created_at DESC
    `);
    res.json({ users: result.rows });
  } catch (err) {
    console.error('Admin list users error:', err);
    res.status(500).json({ error: 'Failed to list users' });
  }
});

// Toggle ban
router.put('/users/:id/ban', adminMiddleware, async (req, res) => {
  try {
    const userId = req.params.id;
    if (userId === req.user.id) {
      return res.status(400).json({ error: 'Cannot ban yourself' });
    }
    const result = await pool.query(
      'UPDATE users SET is_banned = NOT is_banned WHERE id = $1 RETURNING id, username, is_banned',
      [userId]
    );
    if (!result.rows[0]) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.json({ user: result.rows[0] });
  } catch (err) {
    console.error('Admin ban error:', err);
    res.status(500).json({ error: 'Failed to update ban status' });
  }
});

// Reset rating to 1200
router.put('/users/:id/reset-rating', adminMiddleware, async (req, res) => {
  try {
    const userId = req.params.id;
    const result = await pool.query(
      'UPDATE users SET rating = 1200 WHERE id = $1 RETURNING id, username, rating',
      [userId]
    );
    if (!result.rows[0]) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.json({ user: result.rows[0] });
  } catch (err) {
    console.error('Admin reset rating error:', err);
    res.status(500).json({ error: 'Failed to reset rating' });
  }
});

// Delete user (nullify their references in games first)
router.delete('/users/:id', adminMiddleware, async (req, res) => {
  try {
    const userId = req.params.id;
    if (userId === req.user.id) {
      return res.status(400).json({ error: 'Cannot delete yourself' });
    }
    // Nullify user IDs in games
    await pool.query('UPDATE games SET white_user_id = NULL WHERE white_user_id = $1', [userId]);
    await pool.query('UPDATE games SET black_user_id = NULL WHERE black_user_id = $1', [userId]);
    const result = await pool.query('DELETE FROM users WHERE id = $1 RETURNING id', [userId]);
    if (!result.rows[0]) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.json({ deleted: true });
  } catch (err) {
    console.error('Admin delete user error:', err);
    res.status(500).json({ error: 'Failed to delete user' });
  }
});

// Delete game record
router.delete('/games/:id', adminMiddleware, async (req, res) => {
  try {
    const gameId = req.params.id;
    const result = await pool.query('DELETE FROM games WHERE id = $1 RETURNING id', [gameId]);
    if (!result.rows[0]) {
      return res.status(404).json({ error: 'Game not found' });
    }
    res.json({ deleted: true });
  } catch (err) {
    console.error('Admin delete game error:', err);
    res.status(500).json({ error: 'Failed to delete game' });
  }
});

export default router;
