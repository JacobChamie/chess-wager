import { Router } from 'express';
import { verifyToken } from '../auth/authService.js';

const PREMIUM_COST = 15;
const PREMIUM_DURATION_DAYS = 30;

export default function createPremiumRoutes(pool) {
  const router = Router();

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

  router.use(authMiddleware);

  // GET /status
  router.get('/status', async (req, res) => {
    try {
      const userRes = await pool.query(
        'SELECT is_premium, premium_expires_at, token_balance FROM users WHERE id = $1',
        [req.user.id]
      );
      if (!userRes.rows[0]) return res.status(404).json({ error: 'User not found' });

      const { is_premium, premium_expires_at, token_balance } = userRes.rows[0];

      const subRes = await pool.query(
        'SELECT id, amount_tokens, started_at, expires_at, status, created_at FROM subscriptions WHERE user_id = $1 ORDER BY created_at DESC LIMIT 10',
        [req.user.id]
      );

      res.json({
        isPremium: is_premium,
        expiresAt: premium_expires_at,
        balance: parseFloat(token_balance),
        cost: PREMIUM_COST,
        durationDays: PREMIUM_DURATION_DAYS,
        subscriptions: subRes.rows,
      });
    } catch (err) {
      console.error('Premium status error:', err);
      res.status(500).json({ error: 'Failed to fetch premium status' });
    }
  });

  // POST /subscribe
  router.post('/subscribe', async (req, res) => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Lock user row
      const userRes = await client.query(
        'SELECT token_balance, is_premium, premium_expires_at FROM users WHERE id = $1 FOR UPDATE',
        [req.user.id]
      );
      if (!userRes.rows[0]) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'User not found' });
      }

      const { token_balance, is_premium, premium_expires_at } = userRes.rows[0];
      if (parseFloat(token_balance) < PREMIUM_COST) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Insufficient balance. Need 15 tokens.' });
      }

      // Calculate new expiry: extend from current expiry if active, otherwise from now
      const baseDate = is_premium && premium_expires_at && new Date(premium_expires_at) > new Date()
        ? new Date(premium_expires_at)
        : new Date();
      const newExpiry = new Date(baseDate.getTime() + PREMIUM_DURATION_DAYS * 24 * 60 * 60 * 1000);

      // Deduct tokens
      const balRes = await client.query(
        'UPDATE users SET token_balance = token_balance - $1, is_premium = true, premium_expires_at = $2 WHERE id = $3 RETURNING token_balance',
        [PREMIUM_COST, newExpiry.toISOString(), req.user.id]
      );
      const newBalance = parseFloat(balRes.rows[0].token_balance);

      // Ledger entry
      await client.query(
        `INSERT INTO ledger (user_id, type, amount, balance_after, description)
         VALUES ($1, 'premium_purchase', $2, $3, $4)`,
        [req.user.id, -PREMIUM_COST, newBalance, `Premium subscription (30 days)`]
      );

      // Subscription record
      await client.query(
        `INSERT INTO subscriptions (user_id, amount_tokens, started_at, expires_at, status)
         VALUES ($1, $2, NOW(), $3, 'active')`,
        [req.user.id, PREMIUM_COST, newExpiry.toISOString()]
      );

      await client.query('COMMIT');

      res.json({
        success: true,
        isPremium: true,
        expiresAt: newExpiry.toISOString(),
        newBalance,
      });
    } catch (err) {
      await client.query('ROLLBACK');
      console.error('Premium subscribe error:', err);
      res.status(500).json({ error: 'Subscription failed' });
    } finally {
      client.release();
    }
  });

  return router;
}
