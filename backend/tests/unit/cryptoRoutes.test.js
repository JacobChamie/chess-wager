import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import { createServer } from 'http';
import createCryptoRoutes from '../../src/crypto/cryptoRoutes.js';
import { verifyToken } from '../../src/auth/authService.js';

// Mock verifyToken to return a test user
vi.mock('../../src/auth/authService.js', () => ({
  verifyToken: vi.fn(),
}));

function createTestApp(pool, walletManager, priceService) {
  const app = express();
  app.use(express.json());
  app.use('/api/crypto', createCryptoRoutes(pool, walletManager, priceService));
  return app;
}

function makeRequest(app, method, path, body = null, token = 'valid-token') {
  return new Promise((resolve) => {
    const server = createServer(app);
    server.listen(0, async () => {
      const port = server.address().port;
      const url = `http://localhost:${port}${path}`;
      const opts = {
        method,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
      };
      if (body) opts.body = JSON.stringify(body);

      try {
        const res = await fetch(url, opts);
        const data = await res.json();
        resolve({ status: res.status, data });
      } finally {
        server.close();
      }
    });
  });
}

describe('Crypto Routes', () => {
  let pool;
  let walletManager;
  let priceService;
  let app;

  beforeEach(() => {
    verifyToken.mockReturnValue({ id: 'user-123', username: 'testuser' });

    pool = {
      query: vi.fn(),
      connect: vi.fn(),
    };
    walletManager = {
      createDepositAddress: vi.fn(),
    };
    priceService = {
      getPrice: vi.fn(),
      getAllPrices: vi.fn(),
    };
    app = createTestApp(pool, walletManager, priceService);
  });

  describe('GET /api/crypto/balance', () => {
    it('should return user balance and pending deposits', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [{ token_balance: '150.50' }] })
        .mockResolvedValueOnce({ rows: [{ count: '2' }] });

      const { status, data } = await makeRequest(app, 'GET', '/api/crypto/balance');
      expect(status).toBe(200);
      expect(data.balance).toBe(150.5);
      expect(data.pendingDeposits).toBe(2);
    });

    it('should return 404 if user not found', async () => {
      pool.query.mockResolvedValueOnce({ rows: [] });

      const { status, data } = await makeRequest(app, 'GET', '/api/crypto/balance');
      expect(status).toBe(404);
      expect(data.error).toMatch(/not found/i);
    });

    it('should return 401 without auth token', async () => {
      verifyToken.mockReturnValue(null);

      const { status } = await makeRequest(app, 'GET', '/api/crypto/balance');
      expect(status).toBe(401);
    });
  });

  describe('POST /api/crypto/deposit/address', () => {
    it('should return deposit address for ethereum', async () => {
      walletManager.createDepositAddress.mockResolvedValue('0xabc123');

      const { status, data } = await makeRequest(app, 'POST', '/api/crypto/deposit/address', {
        chain: 'ethereum',
      });

      expect(status).toBe(200);
      expect(data.address).toBe('0xabc123');
      expect(data.chain).toBe('ethereum');
      expect(data.assets).toHaveLength(2);
      expect(data.assets[0].asset).toBe('ETH');
      expect(data.assets[1].asset).toBe('USDC_ERC20');
    });

    it('should return deposit address for solana', async () => {
      walletManager.createDepositAddress.mockResolvedValue('SolAddr123');

      const { status, data } = await makeRequest(app, 'POST', '/api/crypto/deposit/address', {
        chain: 'solana',
      });

      expect(status).toBe(200);
      expect(data.address).toBe('SolAddr123');
      expect(data.chain).toBe('solana');
      expect(data.assets[0].asset).toBe('SOL');
      expect(data.assets[1].asset).toBe('USDC_SPL');
    });

    it('should reject invalid chain', async () => {
      const { status, data } = await makeRequest(app, 'POST', '/api/crypto/deposit/address', {
        chain: 'bitcoin',
      });

      expect(status).toBe(400);
      expect(data.error).toMatch(/Invalid chain/);
    });

    it('should reject missing chain', async () => {
      const { status, data } = await makeRequest(app, 'POST', '/api/crypto/deposit/address', {});
      expect(status).toBe(400);
    });
  });

  describe('GET /api/crypto/deposits', () => {
    it('should return paginated deposits', async () => {
      pool.query
        .mockResolvedValueOnce({
          rows: [
            { id: 'd1', chain: 'ethereum', asset: 'ETH', amount_decimal: '0.5', status: 'credited' },
          ],
        })
        .mockResolvedValueOnce({ rows: [{ count: '1' }] });

      const { status, data } = await makeRequest(app, 'GET', '/api/crypto/deposits?page=1&limit=10');
      expect(status).toBe(200);
      expect(data.deposits).toHaveLength(1);
      expect(data.total).toBe(1);
      expect(data.page).toBe(1);
    });
  });

  describe('POST /api/crypto/withdraw', () => {
    it('should create a withdrawal successfully', async () => {
      priceService.getPrice.mockResolvedValue(3000); // ETH price

      const mockClient = {
        query: vi.fn()
          .mockResolvedValueOnce({}) // BEGIN
          .mockResolvedValueOnce({ rows: [{ token_balance: '90' }] }) // deduct
          .mockResolvedValueOnce({ rows: [{ id: 'w-123' }] }) // insert withdrawal
          .mockResolvedValueOnce({}) // ledger
          .mockResolvedValueOnce({}), // COMMIT
        release: vi.fn(),
      };
      pool.connect.mockResolvedValue(mockClient);

      const { status, data } = await makeRequest(app, 'POST', '/api/crypto/withdraw', {
        chain: 'ethereum',
        asset: 'ETH',
        to_address: '0x1234567890123456789012345678901234567890',
        amount_tokens: 100,
      });

      expect(status).toBe(200);
      expect(data.withdrawalId).toBe('w-123');
      expect(data.amountTokens).toBe(100);
      expect(data.amountCrypto).toBeCloseTo(100 / 3000, 4);
    });

    it('should reject invalid Ethereum address', async () => {
      const { status, data } = await makeRequest(app, 'POST', '/api/crypto/withdraw', {
        chain: 'ethereum',
        asset: 'ETH',
        to_address: 'invalid',
        amount_tokens: 10,
      });

      expect(status).toBe(400);
      expect(data.error).toMatch(/Invalid Ethereum address/);
    });

    it('should reject invalid asset for chain', async () => {
      const { status, data } = await makeRequest(app, 'POST', '/api/crypto/withdraw', {
        chain: 'ethereum',
        asset: 'SOL',
        to_address: '0x1234567890123456789012345678901234567890',
        amount_tokens: 10,
      });

      expect(status).toBe(400);
      expect(data.error).toMatch(/Invalid asset/);
    });

    it('should reject zero amount', async () => {
      const { status, data } = await makeRequest(app, 'POST', '/api/crypto/withdraw', {
        chain: 'ethereum',
        asset: 'ETH',
        to_address: '0x1234567890123456789012345678901234567890',
        amount_tokens: 0,
      });

      expect(status).toBe(400);
      expect(data.error).toMatch(/Invalid amount/);
    });

    it('should handle insufficient balance', async () => {
      priceService.getPrice.mockResolvedValue(3000);

      const mockClient = {
        query: vi.fn()
          .mockResolvedValueOnce({}) // BEGIN
          .mockResolvedValueOnce({ rows: [] }), // deduct fails (no rows)
        release: vi.fn(),
      };
      pool.connect.mockResolvedValue(mockClient);

      const { status, data } = await makeRequest(app, 'POST', '/api/crypto/withdraw', {
        chain: 'ethereum',
        asset: 'ETH',
        to_address: '0x1234567890123456789012345678901234567890',
        amount_tokens: 100,
      });

      expect(status).toBe(400);
      expect(data.error).toMatch(/Insufficient balance/);
    });
  });

  describe('GET /api/crypto/prices', () => {
    it('should return current prices', async () => {
      priceService.getAllPrices.mockResolvedValue({ ETH: 3500, SOL: 150, USDC: 1.0 });

      const { status, data } = await makeRequest(app, 'GET', '/api/crypto/prices');
      expect(status).toBe(200);
      expect(data.ETH).toBe(3500);
      expect(data.SOL).toBe(150);
      expect(data.USDC).toBe(1.0);
    });
  });

  describe('GET /api/crypto/ledger', () => {
    it('should return paginated ledger entries', async () => {
      pool.query
        .mockResolvedValueOnce({
          rows: [
            { id: '1', type: 'deposit', amount: '100', balance_after: '100', description: 'Test deposit' },
          ],
        })
        .mockResolvedValueOnce({ rows: [{ count: '1' }] });

      const { status, data } = await makeRequest(app, 'GET', '/api/crypto/ledger');
      expect(status).toBe(200);
      expect(data.entries).toHaveLength(1);
      expect(data.total).toBe(1);
    });
  });

  describe('GET /api/crypto/withdrawals', () => {
    it('should return paginated withdrawals', async () => {
      pool.query
        .mockResolvedValueOnce({
          rows: [
            { id: 'w1', chain: 'ethereum', asset: 'ETH', amount_tokens: '50', status: 'sent' },
          ],
        })
        .mockResolvedValueOnce({ rows: [{ count: '1' }] });

      const { status, data } = await makeRequest(app, 'GET', '/api/crypto/withdrawals');
      expect(status).toBe(200);
      expect(data.withdrawals).toHaveLength(1);
      expect(data.total).toBe(1);
    });
  });
});
