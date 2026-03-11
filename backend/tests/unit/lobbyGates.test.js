import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LobbyManager } from '../../src/lobby/LobbyManager.js';

function createMockGameManager() {
  return {
    createGame: vi.fn().mockImplementation((tc) => ({
      gameId: `game-${Date.now()}-${Math.random()}`,
      timeControl: tc,
      chess: { fen: () => 'startpos' },
      addPlayer: vi.fn(),
      startGame: vi.fn(),
      wagerAmount: 0,
      isWagerGame: false,
    })),
    trackSession: vi.fn(),
    getActiveGames: vi.fn().mockReturnValue([]),
    cleanupGame: vi.fn(),
    getGame: vi.fn(),
  };
}

describe('LobbyManager — Gates', () => {
  let lm;
  let gm;

  beforeEach(() => {
    gm = createMockGameManager();
    lm = new LobbyManager(gm);
  });

  it('should store gates on queue entry', () => {
    const gates = { requireVerified: true };
    lm.addToQueue('s1', 'sock1', 'Alice', 300, 'u1', 1200, 'random', 10, gates);
    const seekers = lm.getSeekers();
    expect(seekers[0].gates).toEqual(gates);
  });

  it('should store null gates when not provided', () => {
    lm.addToQueue('s1', 'sock1', 'Alice', 300, 'u1', 1200, 'random', 10);
    const seekers = lm.getSeekers();
    expect(seekers[0].gates).toBeNull();
  });

  it('should store gates on pending game', () => {
    const gates = { requireVerified: true, minExternalRating: 1500 };
    lm.createPendingGame('s1', 'sock1', 'Alice', 300, 'u1', 1200, 'random', 25, gates);
    const games = lm.getOpenGames();
    expect(games[0].gates).toEqual(gates);
  });

  it('should include gates in getOpenGames()', () => {
    const gates = { requireVerified: true };
    lm.createPendingGame('s1', 'sock1', 'Alice', 300, 'u1', 1200, 'random', 10, gates);
    const games = lm.getOpenGames();
    expect(games).toHaveLength(1);
    expect(games[0].gates).toEqual(gates);
    expect(games[0].wagerAmount).toBe(10);
  });

  it('should include null gates in getSeekers() when no gates provided', () => {
    lm.addToQueue('s1', 'sock1', 'Alice', 300, 'u1', 1200, 'random', 5);
    const seekers = lm.getSeekers();
    expect(seekers[0].gates).toBeNull();
  });

  it('should pass gates through in queue match result', () => {
    const gates1 = { requireVerified: true };
    lm.addToQueue('s1', 'sock1', 'Alice', 300, 'u1', 1200, 'random', 10, gates1);

    const gates2 = { minExternalRating: 1500 };
    const match = lm.addToQueue('s2', 'sock2', 'Bob', 300, 'u2', 1300, 'random', 10, gates2);

    // Match should exist (same time control + wager)
    expect(match).not.toBeNull();
  });

  it('should store pending game gates and include in getOpenGames', () => {
    const gates = {
      requireVerified: true,
      minExternalRating: 1400,
      minExternalPlatform: 'lichess',
      minExternalTimeControl: 'rapid',
    };
    lm.createPendingGame('s1', 'sock1', 'Alice', 300, 'u1', 1200, 'random', 50, gates);

    const games = lm.getOpenGames();
    expect(games[0].gates.requireVerified).toBe(true);
    expect(games[0].gates.minExternalRating).toBe(1400);
    expect(games[0].gates.minExternalPlatform).toBe('lichess');
    expect(games[0].gates.minExternalTimeControl).toBe('rapid');
  });
});
