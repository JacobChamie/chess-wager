import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the pool
vi.mock('../../src/config/db.js', () => ({
  pool: {
    query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
  },
}));

import { BehaviorTracker } from '../../src/fairplay/BehaviorTracker.js';
import { pool } from '../../src/config/db.js';

describe('BehaviorTracker', () => {
  let tracker;

  beforeEach(() => {
    vi.clearAllMocks();
    tracker = new BehaviorTracker();
  });

  describe('calcMouseEntropy', () => {
    it('should return 0 for identical positions', () => {
      const positions = [
        { x: 100, y: 200 },
        { x: 100, y: 200 },
        { x: 100, y: 200 },
      ];
      expect(tracker.calcMouseEntropy(positions)).toBe(0);
    });

    it('should return positive value for varied positions', () => {
      const positions = [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 100 },
        { x: 200, y: 50 },
        { x: 300, y: 200 },
      ];
      expect(tracker.calcMouseEntropy(positions)).toBeGreaterThan(0);
    });

    it('should return 0 for fewer than 2 positions', () => {
      expect(tracker.calcMouseEntropy([])).toBe(0);
      expect(tracker.calcMouseEntropy([{ x: 1, y: 2 }])).toBe(0);
    });

    it('should return 0 for exactly 2 identical positions (single displacement)', () => {
      // 2 positions -> 1 displacement -> displacements.length < 2 -> 0
      const positions = [{ x: 0, y: 0 }, { x: 10, y: 10 }];
      expect(tracker.calcMouseEntropy(positions)).toBe(0);
    });

    it('should use sample variance (n-1 divisor)', () => {
      // 3 positions -> 2 displacements
      // d1 = sqrt(100^2 + 0^2) = 100
      // d2 = sqrt(0^2 + 100^2) = 100
      // mean = 100, all same -> variance = 0
      const positions = [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 100 },
      ];
      expect(tracker.calcMouseEntropy(positions)).toBe(0);

      // Verify different displacements produce non-zero
      // d1 = sqrt(10^2 + 0^2) = 10, d2 = sqrt(100^2 + 0^2) = 100
      // mean = 55, sample variance = ((10-55)^2 + (100-55)^2) / 1 = 4050
      // std = sqrt(4050) ≈ 63.640
      const positions2 = [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 110, y: 0 },
      ];
      const entropy = tracker.calcMouseEntropy(positions2);
      expect(entropy).toBeCloseTo(63.640, 1);
    });
  });

  describe('saveBehavior', () => {
    it('should insert valid data into DB', async () => {
      await tracker.saveBehavior('game-1', 'user-1', {
        tabSwitches: 2,
        focusLosses: 1,
        copyEvents: 0,
        pasteEvents: 0,
        mousePositions: [
          { x: 0, y: 0 }, { x: 10, y: 10 }, { x: 20, y: 20 },
          { x: 30, y: 30 }, { x: 40, y: 40 },
        ],
      });

      expect(pool.query).toHaveBeenCalledTimes(1);
      const [sql, params] = pool.query.mock.calls[0];
      expect(sql).toContain('INSERT INTO game_behavior');
      expect(params[0]).toBe('game-1');
      expect(params[1]).toBe('user-1');
      expect(params[2]).toBe(2); // tabSwitches
      expect(params[3]).toBe(1); // focusLosses
      expect(params[6]).toBeTypeOf('number'); // mouseEntropy
    });

    it('should no-op when missing required fields', async () => {
      await tracker.saveBehavior(null, 'user-1', {});
      await tracker.saveBehavior('game-1', null, {});
      await tracker.saveBehavior('game-1', 'user-1', null);
      expect(pool.query).not.toHaveBeenCalled();
    });

    it('should clamp negative numbers to 0', async () => {
      await tracker.saveBehavior('game-1', 'user-1', {
        tabSwitches: -5,
        focusLosses: -3,
        copyEvents: -1,
        pasteEvents: -2,
      });

      const params = pool.query.mock.calls[0][1];
      expect(params[2]).toBe(0); // tabSwitches
      expect(params[3]).toBe(0); // focusLosses
      expect(params[4]).toBe(0); // copyEvents
      expect(params[5]).toBe(0); // pasteEvents
    });

    it('should set mouseEntropy to null when fewer than 5 mouse samples', async () => {
      await tracker.saveBehavior('game-1', 'user-1', {
        tabSwitches: 0,
        focusLosses: 0,
        copyEvents: 0,
        pasteEvents: 0,
        mousePositions: [{ x: 0, y: 0 }, { x: 1, y: 1 }],
      });

      const params = pool.query.mock.calls[0][1];
      expect(params[6]).toBeNull(); // mouseEntropy
    });

    it('should catch DB errors silently', async () => {
      pool.query.mockRejectedValueOnce(new Error('DB down'));
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      await tracker.saveBehavior('game-1', 'user-1', {
        tabSwitches: 1,
        focusLosses: 0,
        copyEvents: 0,
        pasteEvents: 0,
      });

      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });
});
