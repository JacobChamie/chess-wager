import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import createFairplayRoutes from '../../src/fairplay/fairplayRoutes.js';

// Mock the verifyToken function
vi.mock('../../src/auth/authService.js', () => ({
  verifyToken: vi.fn(),
}));

import { verifyToken } from '../../src/auth/authService.js';

function createApp(mockService) {
  const app = express();
  app.use(express.json());
  app.use('/api/fairplay', createFairplayRoutes(mockService));
  return app;
}

describe('Fairplay Routes', () => {
  let app;
  let mockService;

  beforeEach(() => {
    vi.clearAllMocks();

    mockService = {
      submitReport: vi.fn().mockResolvedValue({ id: 'report-1' }),
      getReports: vi.fn().mockResolvedValue({ reports: [], total: 0, page: 1, limit: 20 }),
      resolveReport: vi.fn().mockResolvedValue({ id: 'r1' }),
      getFlaggedUsers: vi.fn().mockResolvedValue([]),
      getUserProfile: vi.fn().mockResolvedValue({ user: { id: 'u1' }, fairPlayScore: null }),
      getGameAnalysis: vi.fn().mockResolvedValue({ game_id: 'g1' }),
      takeAction: vi.fn().mockResolvedValue({ success: true }),
    };

    app = createApp(mockService);
  });

  describe('Auth enforcement', () => {
    it('should return 401 without token', async () => {
      const res = await request(app).post('/api/fairplay/report').send({});
      expect(res.status).toBe(401);
    });

    it('should return 401 with invalid token', async () => {
      verifyToken.mockReturnValue(null);
      const res = await request(app)
        .post('/api/fairplay/report')
        .set('Authorization', 'Bearer invalid')
        .send({});
      expect(res.status).toBe(401);
    });

    it('should return 403 for non-admin on admin routes', async () => {
      verifyToken.mockReturnValue({ id: 'user-1', is_admin: false });
      const res = await request(app)
        .get('/api/fairplay/admin/reports')
        .set('Authorization', 'Bearer valid');
      expect(res.status).toBe(403);
    });
  });

  describe('POST /report', () => {
    beforeEach(() => {
      verifyToken.mockReturnValue({ id: 'user-1' });
    });

    it('should return 200 on valid report', async () => {
      const res = await request(app)
        .post('/api/fairplay/report')
        .set('Authorization', 'Bearer valid')
        .send({ reportedId: 'u2', gameId: 'g1', reason: 'engine_use', details: 'suspicious' });

      expect(res.status).toBe(200);
      expect(res.body.id).toBe('report-1');
      expect(mockService.submitReport).toHaveBeenCalledWith('user-1', 'u2', 'g1', 'engine_use', 'suspicious');
    });

    it('should return 429 on rate limit', async () => {
      mockService.submitReport.mockRejectedValue(new Error('Report limit reached (3 per 24 hours)'));

      const res = await request(app)
        .post('/api/fairplay/report')
        .set('Authorization', 'Bearer valid')
        .send({ reportedId: 'u2', reason: 'engine_use' });

      expect(res.status).toBe(429);
    });

    it('should return 400 on validation error', async () => {
      mockService.submitReport.mockRejectedValue(new Error('Missing required fields'));

      const res = await request(app)
        .post('/api/fairplay/report')
        .set('Authorization', 'Bearer valid')
        .send({});

      expect(res.status).toBe(400);
    });
  });

  describe('Admin routes', () => {
    beforeEach(() => {
      verifyToken.mockReturnValue({ id: 'admin-1', is_admin: true });
    });

    it('GET /admin/reports should list reports', async () => {
      const res = await request(app)
        .get('/api/fairplay/admin/reports')
        .set('Authorization', 'Bearer valid');

      expect(res.status).toBe(200);
      expect(mockService.getReports).toHaveBeenCalled();
    });

    it('PUT /admin/reports/:id should update report', async () => {
      const res = await request(app)
        .put('/api/fairplay/admin/reports/r1')
        .set('Authorization', 'Bearer valid')
        .send({ status: 'resolved', note: 'confirmed cheating' });

      expect(res.status).toBe(200);
      expect(mockService.resolveReport).toHaveBeenCalledWith('r1', 'admin-1', 'resolved', 'confirmed cheating');
    });

    it('GET /admin/flagged should return flagged users', async () => {
      const res = await request(app)
        .get('/api/fairplay/admin/flagged')
        .set('Authorization', 'Bearer valid');

      expect(res.status).toBe(200);
      expect(res.body.users).toBeDefined();
    });

    it('GET /admin/user/:id should return user profile', async () => {
      const res = await request(app)
        .get('/api/fairplay/admin/user/u1')
        .set('Authorization', 'Bearer valid');

      expect(res.status).toBe(200);
      expect(mockService.getUserProfile).toHaveBeenCalledWith('u1');
    });

    it('GET /admin/game/:id should return game analysis', async () => {
      const res = await request(app)
        .get('/api/fairplay/admin/game/g1')
        .set('Authorization', 'Bearer valid');

      expect(res.status).toBe(200);
      expect(mockService.getGameAnalysis).toHaveBeenCalledWith('g1');
    });

    it('POST /admin/action should execute action', async () => {
      const res = await request(app)
        .post('/api/fairplay/admin/action')
        .set('Authorization', 'Bearer valid')
        .send({ userId: 'u1', action: 'ban', note: 'confirmed cheater' });

      expect(res.status).toBe(200);
      expect(mockService.takeAction).toHaveBeenCalledWith('admin-1', 'u1', 'ban', 'confirmed cheater');
    });

    it('GET /admin/game/:id should return 404 when not found', async () => {
      mockService.getGameAnalysis.mockRejectedValue(new Error('Analysis not found'));

      const res = await request(app)
        .get('/api/fairplay/admin/game/bad-id')
        .set('Authorization', 'Bearer valid');

      expect(res.status).toBe(404);
    });
  });
});
