import { Router } from 'express';
import { pool } from '../config/db.js';
import { adminMiddleware } from '../auth/middleware.js';

export default function createAdminRoutes(io, botManager, gameManager) {
  const router = Router();

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

  // --- Stress Test Endpoints ---

  router.post('/stress-test/start', adminMiddleware, async (req, res) => {
    try {
      const config = req.body || {};
      // Don't await — let it run in the background
      botManager.start(io, config, gameManager).catch(err => {
        console.error('[BotManager] Unhandled error:', err);
      });
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/stress-test/stop', adminMiddleware, async (req, res) => {
    try {
      await botManager.stop();
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.get('/stress-test/status', adminMiddleware, async (req, res) => {
    res.json(botManager.getStatus());
  });

  // --- Withdrawal Approval Queue ---

  // List all awaiting_approval withdrawals
  router.get('/withdrawals/pending', adminMiddleware, async (req, res) => {
    try {
      const result = await pool.query(`
        SELECT w.*, u.username, u.email
        FROM withdrawals w
        JOIN users u ON u.id = w.user_id
        WHERE w.status = 'awaiting_approval'
        ORDER BY w.created_at ASC
      `);
      res.json({ withdrawals: result.rows });
    } catch (err) {
      console.error('Admin pending withdrawals error:', err);
      res.status(500).json({ error: 'Failed to fetch pending withdrawals' });
    }
  });

  // Approve withdrawal — sets status to 'pending' so WithdrawalProcessor picks it up
  router.post('/withdrawals/:id/approve', adminMiddleware, async (req, res) => {
    try {
      const { id } = req.params;
      const result = await pool.query(
        `UPDATE withdrawals
         SET status = 'pending', approved_by = $1, approved_at = NOW()
         WHERE id = $2 AND status = 'awaiting_approval'
         RETURNING *`,
        [req.user.id, id]
      );
      if (!result.rows[0]) {
        return res.status(404).json({ error: 'Withdrawal not found or already processed' });
      }
      res.json({ withdrawal: result.rows[0] });
    } catch (err) {
      console.error('Admin approve withdrawal error:', err);
      res.status(500).json({ error: 'Failed to approve withdrawal' });
    }
  });

  // Reject withdrawal — refund tokens to user
  router.post('/withdrawals/:id/reject', adminMiddleware, async (req, res) => {
    const client = await pool.connect();
    try {
      const { id } = req.params;
      const { reason } = req.body || {};

      await client.query('BEGIN');

      const wResult = await client.query(
        `SELECT * FROM withdrawals WHERE id = $1 AND status = 'awaiting_approval'`,
        [id]
      );
      if (!wResult.rows[0]) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Withdrawal not found or already processed' });
      }
      const withdrawal = wResult.rows[0];

      // Refund the token amount (gross amount before fee was deducted)
      // The original withdrawal deducted tokens from balance, so refund them
      const refundAmount = parseFloat(withdrawal.token_amount || 0);
      if (refundAmount > 0) {
        await client.query(
          'UPDATE users SET token_balance = token_balance + $1 WHERE id = $2',
          [refundAmount, withdrawal.user_id]
        );
        await client.query(
          `INSERT INTO ledger (user_id, type, amount, description)
           VALUES ($1, 'withdrawal_refund', $2, $3)`,
          [withdrawal.user_id, refundAmount, `Withdrawal rejected: ${reason || 'No reason provided'}`]
        );
      }

      await client.query(
        `UPDATE withdrawals SET status = 'rejected', admin_note = $1 WHERE id = $2`,
        [reason || null, id]
      );

      await client.query('COMMIT');
      res.json({ success: true });
    } catch (err) {
      await client.query('ROLLBACK');
      console.error('Admin reject withdrawal error:', err);
      res.status(500).json({ error: 'Failed to reject withdrawal' });
    } finally {
      client.release();
    }
  });

  // --- Transaction Browser ---

  // Paginated ledger browser with type filter
  router.get('/transactions', adminMiddleware, async (req, res) => {
    try {
      const page = parseInt(req.query.page) || 1;
      const limit = Math.min(parseInt(req.query.limit) || 50, 200);
      const offset = (page - 1) * limit;
      const type = req.query.type; // deposit, withdrawal, wager_lock, wager_win, etc.

      let whereClause = '';
      const params = [limit, offset];

      if (type && type !== 'all') {
        whereClause = 'WHERE l.type = $3';
        params.push(type);
      }

      const countQuery = type && type !== 'all'
        ? await pool.query('SELECT COUNT(*) FROM ledger WHERE type = $1', [type])
        : await pool.query('SELECT COUNT(*) FROM ledger');

      const result = await pool.query(`
        SELECT l.*, u.username, u.email
        FROM ledger l
        LEFT JOIN users u ON u.id = l.user_id
        ${whereClause}
        ORDER BY l.created_at DESC
        LIMIT $1 OFFSET $2
      `, params);

      res.json({
        transactions: result.rows,
        total: parseInt(countQuery.rows[0].count),
        page,
        limit,
      });
    } catch (err) {
      console.error('Admin transactions error:', err);
      res.status(500).json({ error: 'Failed to fetch transactions' });
    }
  });

  // Reverse a transaction — create a reversing ledger entry
  router.post('/transactions/:id/reverse', adminMiddleware, async (req, res) => {
    const client = await pool.connect();
    try {
      const { id } = req.params;
      const { reason } = req.body || {};

      await client.query('BEGIN');

      const txResult = await client.query('SELECT * FROM ledger WHERE id = $1', [id]);
      if (!txResult.rows[0]) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Transaction not found' });
      }
      const tx = txResult.rows[0];
      const reversalAmount = parseFloat(tx.amount);

      // Create reversing entry (negate the original amount)
      await client.query(
        `INSERT INTO ledger (user_id, type, amount, description)
         VALUES ($1, $2, $3, $4)`,
        [tx.user_id, 'admin_reversal', -reversalAmount, `Reversal of txn ${id}: ${reason || 'No reason'}`]
      );

      // Update user balance
      await client.query(
        'UPDATE users SET token_balance = token_balance - $1 WHERE id = $2',
        [reversalAmount, tx.user_id]
      );

      // Record in admin_reversals
      await client.query(
        `INSERT INTO admin_reversals (admin_user_id, target_user_id, reversal_type, reference_id, amount, reason)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [req.user.id, tx.user_id, tx.type, id.toString(), reversalAmount, reason || null]
      );

      await client.query('COMMIT');
      res.json({ success: true });
    } catch (err) {
      await client.query('ROLLBACK');
      console.error('Admin reverse transaction error:', err);
      res.status(500).json({ error: 'Failed to reverse transaction' });
    } finally {
      client.release();
    }
  });

  return router;
}
