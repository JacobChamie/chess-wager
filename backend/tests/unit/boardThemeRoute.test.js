import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// Mock DB pool
vi.mock('../../src/config/db.js', () => ({
  pool: {
    query: vi.fn(),
  },
}));

// Mock authService
vi.mock('../../src/auth/authService.js', () => ({
  verifyToken: vi.fn(),
  hashPassword: vi.fn(),
  comparePassword: vi.fn(),
  generateToken: vi.fn(),
}));

// Mock emailService
vi.mock('../../src/email/emailService.js', () => ({
  sendVerificationEmail: vi.fn(),
  sendPasswordResetEmail: vi.fn(),
}));

import { pool } from '../../src/config/db.js';
import { verifyToken } from '../../src/auth/authService.js';

describe('Board Theme in Auth Routes', () => {
  let app;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Dynamically import to get fresh module
    const { default: authRouter } = await import('../../src/auth/authRoutes.js');
    app = express();
    app.use(express.json());
    app.use('/api/auth', authRouter);
  });

  describe('PUT /profile board_theme', () => {
    it('should accept valid board theme', async () => {
      verifyToken.mockReturnValue({ id: 'user-1' });
      pool.query.mockResolvedValueOnce({
        rows: [{ id: 'user-1', username: 'alice', board_theme: 'dark' }],
      });

      const res = await request(app)
        .put('/api/auth/profile')
        .set('Authorization', 'Bearer token')
        .send({ username: 'alice', board_theme: 'dark' });

      expect(res.status).toBe(200);
      // Verify that the query included board_theme
      const updateCall = pool.query.mock.calls[0];
      expect(updateCall[0]).toContain('board_theme');
      expect(updateCall[1]).toContain('dark');
    });

    it('should reject invalid board theme', async () => {
      verifyToken.mockReturnValue({ id: 'user-1' });

      const res = await request(app)
        .put('/api/auth/profile')
        .set('Authorization', 'Bearer token')
        .send({ username: 'alice', board_theme: 'rainbow' });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/invalid.*theme/i);
    });
  });
});
