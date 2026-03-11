import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import createAdminRoutes from '../../src/admin/adminRoutes.js';

// Mock the verifyToken function
vi.mock('../../src/auth/authService.js', () => ({
  verifyToken: vi.fn(),
}));

// Mock the pool
vi.mock('../../src/config/db.js', () => ({
  pool: {
    query: vi.fn(),
    connect: vi.fn(),
  },
}));

import { verifyToken } from '../../src/auth/authService.js';
import { pool } from '../../src/config/db.js';

function createApp() {
  const app = express();
  app.use(express.json());
  const io = {};
  const botManager = { start: vi.fn(), stop: vi.fn(), getStatus: vi.fn().mockReturnValue({ running: false }) };
  const gameManager = {};
  app.use('/api/admin', createAdminRoutes(io, botManager, gameManager));
  return app;
}

describe('Admin Withdrawal Routes', () => {
  let app;

  beforeEach(() => {
    vi.clearAllMocks();
    verifyToken.mockReturnValue({ id: 'admin-1', is_admin: true });
    app = createApp();
  });

  describe('GET /withdrawals/pending', () => {
    it('should return pending withdrawals', async () => {
      pool.query.mockResolvedValueOnce({
        rows: [
          { id: 'w-1', username: 'alice', amount_tokens: '50', status: 'awaiting_approval', chain: 'ethereum', asset: 'ETH' },
          { id: 'w-2', username: 'bob', amount_tokens: '100', status: 'awaiting_approval', chain: 'solana', asset: 'SOL' },
        ],
      });

      const res = await request(app)
        .get('/api/admin/withdrawals/pending')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(200);
      expect(res.body.withdrawals).toHaveLength(2);
      expect(res.body.withdrawals[0].username).toBe('alice');
    });

    it('should return 401 without token', async () => {
      verifyToken.mockReturnValue(null);
      const res = await request(app).get('/api/admin/withdrawals/pending');
      expect(res.status).toBe(401);
    });

    it('should return 403 for non-admin', async () => {
      verifyToken.mockReturnValue({ id: 'user-1', is_admin: false });
      const res = await request(app)
        .get('/api/admin/withdrawals/pending')
        .set('Authorization', 'Bearer valid-token');
      expect(res.status).toBe(403);
    });
  });

  describe('POST /withdrawals/:id/approve', () => {
    it('should approve a pending withdrawal', async () => {
      pool.query.mockResolvedValueOnce({
        rows: [{ id: 'w-1', status: 'pending', approved_by: 'admin-1' }],
      });

      const res = await request(app)
        .post('/api/admin/withdrawals/w-1/approve')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(200);
      expect(res.body.withdrawal.id).toBe('w-1');
    });

    it('should return 404 if withdrawal not found', async () => {
      pool.query.mockResolvedValueOnce({ rows: [] });

      const res = await request(app)
        .post('/api/admin/withdrawals/bad-id/approve')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(404);
    });
  });

  describe('POST /withdrawals/:id/reject', () => {
    it('should reject and refund a withdrawal', async () => {
      const mockClient = {
        query: vi.fn()
          .mockResolvedValueOnce({}) // BEGIN
          .mockResolvedValueOnce({ rows: [{ id: 'w-1', user_id: 'user-1', token_amount: '50' }] }) // SELECT withdrawal
          .mockResolvedValueOnce({}) // UPDATE balance
          .mockResolvedValueOnce({}) // INSERT ledger
          .mockResolvedValueOnce({}) // UPDATE status
          .mockResolvedValueOnce({}), // COMMIT
        release: vi.fn(),
      };
      pool.connect.mockResolvedValueOnce(mockClient);

      const res = await request(app)
        .post('/api/admin/withdrawals/w-1/reject')
        .set('Authorization', 'Bearer valid-token')
        .send({ reason: 'Suspicious activity' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(mockClient.release).toHaveBeenCalled();
    });

    it('should return 404 if withdrawal not found on reject', async () => {
      const mockClient = {
        query: vi.fn()
          .mockResolvedValueOnce({}) // BEGIN
          .mockResolvedValueOnce({ rows: [] }) // SELECT - not found
          .mockResolvedValueOnce({}), // ROLLBACK
        release: vi.fn(),
      };
      pool.connect.mockResolvedValueOnce(mockClient);

      const res = await request(app)
        .post('/api/admin/withdrawals/bad-id/reject')
        .set('Authorization', 'Bearer valid-token')
        .send({ reason: 'test' });

      expect(res.status).toBe(404);
    });
  });
});

describe('Admin Transaction Routes', () => {
  let app;

  beforeEach(() => {
    vi.clearAllMocks();
    verifyToken.mockReturnValue({ id: 'admin-1', is_admin: true });
    app = createApp();
  });

  describe('GET /transactions', () => {
    it('should return paginated transactions', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [{ count: '100' }] }) // COUNT
        .mockResolvedValueOnce({
          rows: [
            { id: '1', username: 'alice', type: 'deposit', amount: '50', created_at: new Date() },
          ],
        }); // SELECT

      const res = await request(app)
        .get('/api/admin/transactions?page=1&limit=50')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(200);
      expect(res.body.transactions).toHaveLength(1);
      expect(res.body.total).toBe(100);
      expect(res.body.page).toBe(1);
    });

    it('should filter by type', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [{ count: '10' }] })
        .mockResolvedValueOnce({ rows: [] });

      const res = await request(app)
        .get('/api/admin/transactions?type=deposit')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(200);
      // Verify the type filter was passed
      const countCall = pool.query.mock.calls[0];
      expect(countCall[0]).toContain('type = $1');
      expect(countCall[1]).toContain('deposit');
    });

    it('should not filter when type is "all"', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [{ count: '50' }] })
        .mockResolvedValueOnce({ rows: [] });

      const res = await request(app)
        .get('/api/admin/transactions?type=all')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(200);
      const countCall = pool.query.mock.calls[0];
      expect(countCall[0]).not.toContain('type = $1');
    });
  });

  describe('POST /transactions/:id/reverse', () => {
    it('should reverse a transaction', async () => {
      const mockClient = {
        query: vi.fn()
          .mockResolvedValueOnce({}) // BEGIN
          .mockResolvedValueOnce({ rows: [{ id: '1', user_id: 'user-1', type: 'deposit', amount: '50' }] }) // SELECT
          .mockResolvedValueOnce({}) // INSERT reversal ledger
          .mockResolvedValueOnce({}) // UPDATE balance
          .mockResolvedValueOnce({}) // INSERT admin_reversals
          .mockResolvedValueOnce({}), // COMMIT
        release: vi.fn(),
      };
      pool.connect.mockResolvedValueOnce(mockClient);

      const res = await request(app)
        .post('/api/admin/transactions/1/reverse')
        .set('Authorization', 'Bearer valid-token')
        .send({ reason: 'Fraudulent deposit' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      // Verify reversal ledger entry was created (call 2 = INSERT ledger)
      const ledgerCall = mockClient.query.mock.calls[2];
      expect(ledgerCall[0]).toContain('INSERT INTO ledger');
      expect(ledgerCall[1][2]).toBe(-50); // negated amount

      // Verify admin_reversals record (call 4 = INSERT admin_reversals)
      const reversalCall = mockClient.query.mock.calls[4];
      expect(reversalCall[0]).toContain('admin_reversals');
    });

    it('should return 404 for non-existent transaction', async () => {
      const mockClient = {
        query: vi.fn()
          .mockResolvedValueOnce({}) // BEGIN
          .mockResolvedValueOnce({ rows: [] }) // SELECT - not found
          .mockResolvedValueOnce({}), // ROLLBACK
        release: vi.fn(),
      };
      pool.connect.mockResolvedValueOnce(mockClient);

      const res = await request(app)
        .post('/api/admin/transactions/999/reverse')
        .set('Authorization', 'Bearer valid-token')
        .send({ reason: 'test' });

      expect(res.status).toBe(404);
    });

    it('should rollback on database error', async () => {
      const mockClient = {
        query: vi.fn()
          .mockResolvedValueOnce({}) // BEGIN
          .mockRejectedValueOnce(new Error('DB crash')), // SELECT throws
        release: vi.fn(),
      };
      pool.connect.mockResolvedValueOnce(mockClient);

      const res = await request(app)
        .post('/api/admin/transactions/1/reverse')
        .set('Authorization', 'Bearer valid-token')
        .send({ reason: 'test' });

      expect(res.status).toBe(500);
      expect(mockClient.release).toHaveBeenCalled();
    });
  });
});
