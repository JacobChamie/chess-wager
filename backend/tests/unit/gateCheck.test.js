import { describe, it, expect, vi, beforeEach } from 'vitest';
import { checkWagerGates } from '../../src/wager/gateCheck.js';

function createMockPool(queryResults = {}) {
  return {
    query: vi.fn().mockImplementation((sql) => {
      if (sql.includes('linked_accounts')) {
        return Promise.resolve(queryResults.accounts || { rows: [] });
      }
      return Promise.resolve({ rows: [] });
    }),
  };
}

describe('checkWagerGates', () => {
  it('should pass when no gates are set', async () => {
    const pool = createMockPool();
    const result = await checkWagerGates(pool, 'user-1', null);
    expect(result.pass).toBe(true);
  });

  it('should pass when gates is empty object', async () => {
    const pool = createMockPool();
    const result = await checkWagerGates(pool, 'user-1', {});
    expect(result.pass).toBe(true);
  });

  it('should fail when user is not logged in and gates require verified', async () => {
    const pool = createMockPool();
    const result = await checkWagerGates(pool, null, { requireVerified: true });
    expect(result.pass).toBe(false);
    expect(result.reason).toMatch(/logged in/);
  });

  it('should fail when requireVerified but no verified accounts exist', async () => {
    const pool = createMockPool({ accounts: { rows: [] } });
    const result = await checkWagerGates(pool, 'user-1', { requireVerified: true });
    expect(result.pass).toBe(false);
    expect(result.reason).toMatch(/verified.*account.*required/i);
  });

  it('should fail when requireVerified but verified account has < 100 games', async () => {
    const pool = createMockPool({
      accounts: {
        rows: [{
          platform: 'chess.com',
          is_verified: true,
          ratings: {
            blitz: { rating: 1500, games: 30 },
            rapid: { rating: 1600, games: 40 },
          },
        }],
      },
    });
    const result = await checkWagerGates(pool, 'user-1', { requireVerified: true });
    expect(result.pass).toBe(false);
    expect(result.reason).toMatch(/100 games/);
  });

  it('should pass when requireVerified and verified account has >= 100 games', async () => {
    const pool = createMockPool({
      accounts: {
        rows: [{
          platform: 'chess.com',
          is_verified: true,
          ratings: {
            blitz: { rating: 1500, games: 60 },
            rapid: { rating: 1600, games: 50 },
          },
        }],
      },
    });
    const result = await checkWagerGates(pool, 'user-1', { requireVerified: true });
    expect(result.pass).toBe(true);
  });

  it('should fail when minExternalRating but no matching platform', async () => {
    const pool = createMockPool({
      accounts: {
        rows: [{
          platform: 'chess.com',
          is_verified: true,
          ratings: { blitz: { rating: 1500, games: 200 } },
        }],
      },
    });
    const result = await checkWagerGates(pool, 'user-1', {
      minExternalRating: 1400,
      minExternalPlatform: 'lichess',
      minExternalTimeControl: 'blitz',
    });
    expect(result.pass).toBe(false);
    expect(result.reason).toMatch(/lichess.*account.*required/i);
  });

  it('should fail when minExternalRating but rating is too low', async () => {
    const pool = createMockPool({
      accounts: {
        rows: [{
          platform: 'lichess',
          is_verified: true,
          ratings: { rapid: { rating: 1200, games: 150 } },
        }],
      },
    });
    const result = await checkWagerGates(pool, 'user-1', {
      minExternalRating: 1500,
      minExternalPlatform: 'lichess',
      minExternalTimeControl: 'rapid',
    });
    expect(result.pass).toBe(false);
    expect(result.reason).toMatch(/1500.*lichess.*rapid/i);
  });

  it('should pass when minExternalRating is met', async () => {
    const pool = createMockPool({
      accounts: {
        rows: [{
          platform: 'lichess',
          is_verified: true,
          ratings: { rapid: { rating: 1800, games: 200 } },
        }],
      },
    });
    const result = await checkWagerGates(pool, 'user-1', {
      minExternalRating: 1500,
      minExternalPlatform: 'lichess',
      minExternalTimeControl: 'rapid',
    });
    expect(result.pass).toBe(true);
  });

  it('should handle accounts with null ratings gracefully', async () => {
    const pool = createMockPool({
      accounts: {
        rows: [{
          platform: 'chess.com',
          is_verified: true,
          ratings: null,
        }],
      },
    });
    const result = await checkWagerGates(pool, 'user-1', { requireVerified: true });
    expect(result.pass).toBe(false);
    expect(result.reason).toMatch(/100 games/);
  });

  it('should count games across multiple verified accounts', async () => {
    const pool = createMockPool({
      accounts: {
        rows: [
          {
            platform: 'chess.com',
            is_verified: true,
            ratings: { blitz: { rating: 1200, games: 60 } },
          },
          {
            platform: 'lichess',
            is_verified: true,
            ratings: { rapid: { rating: 1500, games: 50 } },
          },
        ],
      },
    });
    const result = await checkWagerGates(pool, 'user-1', { requireVerified: true });
    expect(result.pass).toBe(true);
  });

  it('should ignore unverified accounts when counting games', async () => {
    const pool = createMockPool({
      accounts: {
        rows: [
          {
            platform: 'chess.com',
            is_verified: false,
            ratings: { blitz: { rating: 1200, games: 500 } },
          },
        ],
      },
    });
    const result = await checkWagerGates(pool, 'user-1', { requireVerified: true });
    expect(result.pass).toBe(false);
  });
});
