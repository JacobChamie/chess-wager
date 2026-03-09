import { Router } from 'express';
import { verifyToken } from '../auth/authService.js';
import { WITHDRAWAL_FEE, MIN_DEPOSIT, CHAINS } from './constants.js';

export default function createCryptoRoutes(pool, walletManager, priceService) {
  const router = Router();

  // Auth middleware
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

  // GET /balance — user's token balance + pending deposits
  router.get('/balance', async (req, res) => {
    try {
      const balRes = await pool.query(
        'SELECT token_balance FROM users WHERE id = $1',
        [req.user.id]
      );
      if (!balRes.rows[0]) return res.status(404).json({ error: 'User not found' });

      const pendingRes = await pool.query(
        "SELECT COUNT(*) as count FROM deposits WHERE user_id = $1 AND status IN ('pending', 'confirmed')",
        [req.user.id]
      );

      res.json({
        balance: parseFloat(balRes.rows[0].token_balance),
        pendingDeposits: parseInt(pendingRes.rows[0].count, 10),
      });
    } catch (err) {
      console.error('Balance fetch error:', err);
      res.status(500).json({ error: 'Failed to fetch balance' });
    }
  });

  // POST /deposit/address — create or get deposit address
  router.post('/deposit/address', async (req, res) => {
    try {
      const { chain } = req.body;
      if (!chain || !CHAINS[chain]) {
        return res.status(400).json({ error: 'Invalid chain. Use "ethereum" or "solana"' });
      }

      const address = await walletManager.createDepositAddress(req.user.id, chain);
      const chainConfig = CHAINS[chain];

      res.json({
        address,
        chain,
        assets: chain === 'ethereum'
          ? [{ asset: 'ETH', minDeposit: MIN_DEPOSIT.ETH }, { asset: 'USDC_ERC20', minDeposit: MIN_DEPOSIT.USDC_ERC20 }]
          : [{ asset: 'SOL', minDeposit: MIN_DEPOSIT.SOL }, { asset: 'USDC_SPL', minDeposit: MIN_DEPOSIT.USDC_SPL }],
        requiredConfirmations: chainConfig.requiredConfirmations,
      });
    } catch (err) {
      console.error('Deposit address error:', err);
      res.status(500).json({ error: 'Failed to generate deposit address' });
    }
  });

  // GET /deposits — user's deposit history
  router.get('/deposits', async (req, res) => {
    try {
      const page = Math.max(1, parseInt(req.query.page) || 1);
      const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 20));
      const offset = (page - 1) * limit;

      const result = await pool.query(
        'SELECT id, chain, asset, amount_decimal, usd_value, tokens_credited, status, tx_hash, detected_at, credited_at FROM deposits WHERE user_id = $1 ORDER BY detected_at DESC LIMIT $2 OFFSET $3',
        [req.user.id, limit, offset]
      );

      const countRes = await pool.query(
        'SELECT COUNT(*) FROM deposits WHERE user_id = $1',
        [req.user.id]
      );

      res.json({
        deposits: result.rows,
        total: parseInt(countRes.rows[0].count, 10),
        page,
        limit,
      });
    } catch (err) {
      console.error('Deposits fetch error:', err);
      res.status(500).json({ error: 'Failed to fetch deposits' });
    }
  });

  // POST /withdraw — request a withdrawal
  router.post('/withdraw', async (req, res) => {
    try {
      const { chain, asset, to_address, amount_tokens } = req.body;

      // Validation
      if (!chain || !CHAINS[chain]) {
        return res.status(400).json({ error: 'Invalid chain' });
      }
      const validAssets = chain === 'ethereum'
        ? ['ETH', 'USDC_ERC20']
        : ['SOL', 'USDC_SPL'];
      if (!validAssets.includes(asset)) {
        return res.status(400).json({ error: `Invalid asset for ${chain}` });
      }
      if (!to_address || typeof to_address !== 'string') {
        return res.status(400).json({ error: 'Invalid destination address' });
      }
      const amount = parseFloat(amount_tokens);
      if (!amount || amount <= 0) {
        return res.status(400).json({ error: 'Invalid amount' });
      }

      // Address format validation
      if (chain === 'ethereum' && !/^0x[0-9a-fA-F]{40}$/.test(to_address)) {
        return res.status(400).json({ error: 'Invalid Ethereum address' });
      }
      if (chain === 'solana' && (to_address.length < 32 || to_address.length > 44)) {
        return res.status(400).json({ error: 'Invalid Solana address' });
      }

      const fee = WITHDRAWAL_FEE[asset] || 0;
      const totalDeduction = amount + fee;

      // Get price to calculate crypto amount
      const price = await priceService.getPrice(asset);
      const usdValue = amount; // tokens = USD 1:1
      const amountCrypto = usdValue / price;

      // Deduct from balance in a transaction
      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        const balRes = await client.query(
          'UPDATE users SET token_balance = token_balance - $1 WHERE id = $2 AND token_balance >= $1 RETURNING token_balance',
          [totalDeduction, req.user.id]
        );
        if (!balRes.rows[0]) {
          await client.query('ROLLBACK');
          return res.status(400).json({ error: 'Insufficient balance' });
        }
        const newBalance = balRes.rows[0].token_balance;

        // Create withdrawal record
        const wRes = await client.query(
          `INSERT INTO withdrawals (user_id, chain, asset, to_address, amount_tokens, amount_crypto, usd_value, fee_tokens)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
          [req.user.id, chain, asset, to_address, amount, amountCrypto, usdValue, fee]
        );

        // Ledger entry
        await client.query(
          `INSERT INTO ledger (user_id, type, amount, balance_after, reference_type, reference_id, description)
           VALUES ($1, 'withdrawal', $2, $3, 'withdrawal', $4, $5)`,
          [req.user.id, -totalDeduction, newBalance, wRes.rows[0].id, `Withdraw ${amountCrypto.toFixed(6)} ${asset} to ${to_address}`]
        );

        await client.query('COMMIT');

        res.json({
          withdrawalId: wRes.rows[0].id,
          amountTokens: amount,
          amountCrypto,
          fee,
          newBalance: parseFloat(newBalance),
        });
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    } catch (err) {
      console.error('Withdrawal error:', err);
      res.status(500).json({ error: 'Withdrawal failed' });
    }
  });

  // GET /withdrawals — user's withdrawal history
  router.get('/withdrawals', async (req, res) => {
    try {
      const page = Math.max(1, parseInt(req.query.page) || 1);
      const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 20));
      const offset = (page - 1) * limit;

      const result = await pool.query(
        'SELECT id, chain, asset, to_address, amount_tokens, amount_crypto, usd_value, fee_tokens, tx_hash, status, created_at, processed_at, error_message FROM withdrawals WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3',
        [req.user.id, limit, offset]
      );

      const countRes = await pool.query(
        'SELECT COUNT(*) FROM withdrawals WHERE user_id = $1',
        [req.user.id]
      );

      res.json({
        withdrawals: result.rows,
        total: parseInt(countRes.rows[0].count, 10),
        page,
        limit,
      });
    } catch (err) {
      console.error('Withdrawals fetch error:', err);
      res.status(500).json({ error: 'Failed to fetch withdrawals' });
    }
  });

  // GET /prices — current crypto prices
  router.get('/prices', async (_req, res) => {
    try {
      const prices = await priceService.getAllPrices();
      res.json(prices);
    } catch (err) {
      console.error('Prices fetch error:', err);
      res.status(500).json({ error: 'Failed to fetch prices' });
    }
  });

  // GET /ledger — user's transaction history
  router.get('/ledger', async (req, res) => {
    try {
      const page = Math.max(1, parseInt(req.query.page) || 1);
      const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 20));
      const offset = (page - 1) * limit;

      const result = await pool.query(
        'SELECT id, type, amount, balance_after, reference_type, reference_id, description, created_at FROM ledger WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3',
        [req.user.id, limit, offset]
      );

      const countRes = await pool.query(
        'SELECT COUNT(*) FROM ledger WHERE user_id = $1',
        [req.user.id]
      );

      res.json({
        entries: result.rows,
        total: parseInt(countRes.rows[0].count, 10),
        page,
        limit,
      });
    } catch (err) {
      console.error('Ledger fetch error:', err);
      res.status(500).json({ error: 'Failed to fetch ledger' });
    }
  });

  return router;
}
