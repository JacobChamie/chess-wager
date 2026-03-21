import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the pool
vi.mock('../../src/config/db.js', () => ({
  pool: {
    query: vi.fn(),
  },
}));

import { FairPlayService } from '../../src/fairplay/FairPlayService.js';
import { pool } from '../../src/config/db.js';

describe('FairPlayService', () => {
  let service;
  let mockEngine;

  beforeEach(() => {
    vi.clearAllMocks();
    pool.query.mockResolvedValue({ rows: [], rowCount: 0 });
    mockEngine = {
      analyzePosition: vi.fn().mockResolvedValue({ moves: [] }),
      quickEval: vi.fn().mockResolvedValue({ moves: [] }),
    };
    service = new FairPlayService(mockEngine);
  });

  describe('submitReport', () => {
    it('should throw on missing required fields', async () => {
      await expect(service.submitReport(null, 'u2', 'g1', 'engine_use')).rejects.toThrow('Missing required fields');
      await expect(service.submitReport('u1', null, 'g1', 'engine_use')).rejects.toThrow('Missing required fields');
      await expect(service.submitReport('u1', 'u2', 'g1', null)).rejects.toThrow('Missing required fields');
    });

    it('should throw when reporting yourself', async () => {
      await expect(service.submitReport('u1', 'u1', 'g1', 'engine_use')).rejects.toThrow('Cannot report yourself');
    });

    it('should throw on invalid reason', async () => {
      await expect(service.submitReport('u1', 'u2', 'g1', 'bad_reason')).rejects.toThrow('Invalid report reason');
    });

    it('should enforce rate limit of 3 per 24 hours', async () => {
      pool.query.mockResolvedValueOnce({ rows: [{ count: '3' }] }); // rate limit check
      await expect(service.submitReport('u1', 'u2', 'g1', 'engine_use')).rejects.toThrow('Report limit reached');
    });

    it('should succeed with valid input', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [{ count: '0' }] }) // rate limit
        .mockResolvedValueOnce({ rows: [{ id: 'report-123' }] }) // insert
        .mockResolvedValueOnce({ rows: [] }); // increment count

      const result = await service.submitReport('u1', 'u2', 'g1', 'engine_use', 'details');
      expect(result).toEqual({ id: 'report-123' });
    });

    it('should truncate details to 500 characters', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [{ count: '0' }] })
        .mockResolvedValueOnce({ rows: [{ id: 'report-1' }] })
        .mockResolvedValueOnce({ rows: [] });

      const longDetails = 'a'.repeat(600);
      await service.submitReport('u1', 'u2', 'g1', 'engine_use', longDetails);

      const insertCall = pool.query.mock.calls[1];
      expect(insertCall[1][4]).toHaveLength(500);
    });
  });

  describe('updateFairPlayScore', () => {
    function setupScoreQueryMocks(overrides = {}) {
      const defaults = {
        analyses: [{ strength: 70, corr: 0.6, acpl: 25, timing: 0.3 }],
        totalTabs: 2,
        totalReports: 0,
        rating: 1500,
        accountAge: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
        linkedAccounts: [],
      };
      const opts = { ...defaults, ...overrides };

      pool.query
        .mockResolvedValueOnce({ rows: opts.analyses }) // analyses
        .mockResolvedValueOnce({ rows: [{ total_tabs: String(opts.totalTabs) }] }) // behavior
        .mockResolvedValueOnce({ rows: [{ count: String(opts.totalReports) }] }) // reports
        .mockResolvedValueOnce({ rows: [{ rating: opts.rating, created_at: opts.accountAge }] }) // user
        .mockResolvedValueOnce({ rows: opts.linkedAccounts }) // linked accounts
        .mockResolvedValueOnce({ rows: [] }); // upsert
    }

    it('should not deduct for normal play', async () => {
      setupScoreQueryMocks({ analyses: [{ strength: 55, corr: 0.4, acpl: 35, timing: 0.2 }] });
      await service.updateFairPlayScore('u1');

      const upsertCall = pool.query.mock.calls[5];
      const trustScore = upsertCall[1][1];
      expect(trustScore).toBeGreaterThanOrEqual(90);
    });

    it('should penalize high z-score (> 2.0)', async () => {
      // Expected strength for 1500 is ~63, deviation of 37 gives z-score ~3.08
      setupScoreQueryMocks({ analyses: [{ strength: 100, corr: 0.9, acpl: 5, timing: 0.1 }] });
      await service.updateFairPlayScore('u1');

      const upsertCall = pool.query.mock.calls[5];
      const trustScore = upsertCall[1][1];
      expect(trustScore).toBeLessThanOrEqual(70);
    });

    it('should penalize high timing suspicion', async () => {
      setupScoreQueryMocks({ analyses: [{ strength: 55, corr: 0.4, acpl: 35, timing: 0.8 }] });
      await service.updateFairPlayScore('u1');

      const upsertCall = pool.query.mock.calls[5];
      const trustScore = upsertCall[1][1];
      expect(trustScore).toBeLessThanOrEqual(90);
    });

    it('should penalize excessive tab switches', async () => {
      setupScoreQueryMocks({ totalTabs: 10 });
      await service.updateFairPlayScore('u1');

      const upsertCall = pool.query.mock.calls[5];
      const trustScore = upsertCall[1][1];
      expect(trustScore).toBeLessThanOrEqual(90);
    });

    it('should penalize many reports', async () => {
      setupScoreQueryMocks({ totalReports: 5 });
      await service.updateFairPlayScore('u1');

      const upsertCall = pool.query.mock.calls[5];
      const trustScore = upsertCall[1][1];
      expect(trustScore).toBeLessThanOrEqual(90);
    });

    it('should penalize cross-platform rating discrepancy', async () => {
      setupScoreQueryMocks({
        rating: 2000,
        linkedAccounts: [{
          platform: 'lichess',
          ratings: JSON.stringify({ blitz: 1500, rapid: 1600 }),
        }],
      });
      await service.updateFairPlayScore('u1');

      const upsertCall = pool.query.mock.calls[5];
      const trustScore = upsertCall[1][1];
      expect(trustScore).toBeLessThanOrEqual(92);
    });

    it('should penalize new accounts without external validation', async () => {
      setupScoreQueryMocks({
        accountAge: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000), // 3 days old
      });
      await service.updateFairPlayScore('u1');

      const upsertCall = pool.query.mock.calls[5];
      const trustScore = upsertCall[1][1];
      expect(trustScore).toBeLessThanOrEqual(95);
    });

    it('should clamp trust score between 0 and 100', async () => {
      // Extreme penalty scenario
      setupScoreQueryMocks({
        analyses: [{ strength: 130, corr: 0.95, acpl: 2, timing: 0.9 }],
        totalTabs: 20,
        totalReports: 10,
        rating: 2500,
        linkedAccounts: [{
          platform: 'lichess',
          ratings: JSON.stringify({ blitz: 1800 }),
        }],
      });
      await service.updateFairPlayScore('u1');

      const upsertCall = pool.query.mock.calls[5];
      const trustScore = upsertCall[1][1];
      expect(trustScore).toBeGreaterThanOrEqual(0);
      expect(trustScore).toBeLessThanOrEqual(100);
    });

    it('should flag when trust score < 60', async () => {
      setupScoreQueryMocks({
        analyses: [{ strength: 130, corr: 0.95, acpl: 2, timing: 0.9 }],
        totalTabs: 20,
        totalReports: 10,
        rating: 2500,
        linkedAccounts: [{
          platform: 'lichess',
          ratings: JSON.stringify({ blitz: 1800 }),
        }],
      });
      await service.updateFairPlayScore('u1');

      const upsertCall = pool.query.mock.calls[5];
      const isFlagged = upsertCall[1][11];
      expect(isFlagged).toBe(true);
    });
  });

  describe('resolveReport', () => {
    it('should throw on invalid status', async () => {
      await expect(service.resolveReport('r1', 'admin1', 'invalid', 'note')).rejects.toThrow('Invalid status');
    });

    it('should throw when report not found', async () => {
      pool.query.mockResolvedValueOnce({ rows: [] });
      await expect(service.resolveReport('r1', 'admin1', 'resolved', 'note')).rejects.toThrow('Report not found');
    });

    it('should succeed with valid status', async () => {
      pool.query.mockResolvedValueOnce({ rows: [{ id: 'r1' }] });
      const result = await service.resolveReport('r1', 'admin1', 'resolved', 'looks clean');
      expect(result).toEqual({ id: 'r1' });
    });
  });

  describe('takeAction', () => {
    it('should throw on invalid action', async () => {
      await expect(service.takeAction('admin1', 'u1', 'invalid_action')).rejects.toThrow('Invalid action');
    });

    it('should ban user', async () => {
      pool.query.mockResolvedValue({ rows: [] });
      await service.takeAction('admin1', 'u1', 'ban', 'cheating');

      // Should have: 1. log action, 2. update is_banned
      expect(pool.query).toHaveBeenCalledTimes(2);
      const banCall = pool.query.mock.calls[1];
      expect(banCall[0]).toContain('is_banned = true');
    });

    it('should clear flag', async () => {
      pool.query.mockResolvedValue({ rows: [] });
      await service.takeAction('admin1', 'u1', 'clear_flag');

      expect(pool.query).toHaveBeenCalledTimes(2);
      const clearCall = pool.query.mock.calls[1];
      expect(clearCall[0]).toContain('is_flagged = false');
    });

    it('should log action without side effect for warn/watchlist', async () => {
      pool.query.mockResolvedValue({ rows: [] });
      await service.takeAction('admin1', 'u1', 'warn', 'first warning');

      expect(pool.query).toHaveBeenCalledTimes(1); // only log, no update
    });
  });

  describe('getReports', () => {
    it('should query with pagination', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [{ count: '5' }] })
        .mockResolvedValueOnce({ rows: [{ id: 'r1' }] });

      const result = await service.getReports('all', 1, 20);
      expect(result.total).toBe(5);
      expect(result.reports).toHaveLength(1);
      expect(result.page).toBe(1);
    });

    it('should filter by status', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [{ count: '2' }] })
        .mockResolvedValueOnce({ rows: [] });

      await service.getReports('pending', 1, 20);

      const countCall = pool.query.mock.calls[0];
      expect(countCall[0]).toContain('status = $1');
    });
  });

  describe('getFlaggedUsers', () => {
    it('should query flagged users ordered by trust score', async () => {
      pool.query.mockResolvedValueOnce({
        rows: [{ user_id: 'u1', trust_score: 30 }],
      });

      const result = await service.getFlaggedUsers();
      expect(result).toHaveLength(1);
      expect(pool.query.mock.calls[0][0]).toContain('is_flagged = true');
    });
  });

  describe('getUserProfile', () => {
    it('should throw when user not found', async () => {
      pool.query.mockResolvedValueOnce({ rows: [] });
      await expect(service.getUserProfile('bad-id')).rejects.toThrow('User not found');
    });

    it('should return full profile', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [{ id: 'u1', username: 'alice' }] }) // user
        .mockResolvedValueOnce({ rows: [{ trust_score: 85 }] }) // score
        .mockResolvedValueOnce({ rows: [] }) // analyses
        .mockResolvedValueOnce({ rows: [] }) // behavior
        .mockResolvedValueOnce({ rows: [] }) // reports
        .mockResolvedValueOnce({ rows: [] }); // actions

      const profile = await service.getUserProfile('u1');
      expect(profile.user.username).toBe('alice');
      expect(profile.fairPlayScore.trust_score).toBe(85);
    });
  });
});
