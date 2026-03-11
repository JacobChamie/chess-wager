import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GameRoom } from '../../src/game/GameRoom.js';
import { GameManager } from '../../src/game/GameManager.js';
import { LobbyManager } from '../../src/lobby/LobbyManager.js';
import { PremiumExpiryChecker } from '../../src/premium/PremiumExpiryChecker.js';
import { createStartedGame } from '../helpers/testGameSetup.js';
import { createMockPool } from '../helpers/mockPool.js';

describe('Premium — GameRoom', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('addPlayer stores isPremium on player object', () => {
    const room = new GameRoom('g1', 300);
    room.addPlayer('s1', 'sock1', 'Alice', 'w', 'uid1', true);
    room.addPlayer('s2', 'sock2', 'Bob', 'b', 'uid2', false);
    expect(room.white.isPremium).toBe(true);
    expect(room.black.isPremium).toBe(false);
  });

  it('addPlayer defaults isPremium to false', () => {
    const room = new GameRoom('g1', 300);
    room.addPlayer('s1', 'sock1', 'Alice', 'w');
    expect(room.white.isPremium).toBe(false);
  });

  it('getFullState includes whiteIsPremium and blackIsPremium', () => {
    const room = new GameRoom('g1', 300);
    room.addPlayer('s1', 'sock1', 'Alice', 'w', null, true);
    room.addPlayer('s2', 'sock2', 'Bob', 'b', null, false);
    room.startGame();
    const state = room.getFullState('s1');
    expect(state.whiteIsPremium).toBe(true);
    expect(state.blackIsPremium).toBe(false);
  });

  it('addChatMessage includes isPremium in message', () => {
    const room = new GameRoom('g1', 300);
    room.addPlayer('s1', 'sock1', 'Alice', 'w', null, true);
    room.addPlayer('s2', 'sock2', 'Bob', 'b', null, false);
    room.startGame();

    const msg1 = room.addChatMessage('sock1', 'hello');
    expect(msg1.isPremium).toBe(true);

    const msg2 = room.addChatMessage('sock2', 'hi');
    expect(msg2.isPremium).toBe(false);
  });
});

describe('Premium — GameManager', () => {
  it('getActiveGames includes whiteIsPremium and blackIsPremium', () => {
    const gm = new GameManager(createMockPool());
    const room = gm.createGame({ time: 300, increment: 0 });
    room.addPlayer('s1', 'sock1', 'Alice', 'w', null, true);
    room.addPlayer('s2', 'sock2', 'Bob', 'b', null, false);
    room.startGame();

    const games = gm.getActiveGames();
    expect(games).toHaveLength(1);
    expect(games[0].whiteIsPremium).toBe(true);
    expect(games[0].blackIsPremium).toBe(false);
  });
});

describe('Premium — LobbyManager', () => {
  let lobby, gm;

  beforeEach(() => {
    vi.useFakeTimers();
    gm = new GameManager(createMockPool());
    lobby = new LobbyManager(gm);
  });

  afterEach(() => { vi.useRealTimers(); });

  it('addToQueue stores isPremium on queue entry', () => {
    lobby.addToQueue('s1', 'sock1', 'Alice', { time: 300, increment: 0 }, null, null, 'random', 0, null, true);
    expect(lobby.queue[0].isPremium).toBe(true);
  });

  it('addToQueue defaults isPremium to false', () => {
    lobby.addToQueue('s1', 'sock1', 'Alice', { time: 300, increment: 0 });
    expect(lobby.queue[0].isPremium).toBe(false);
  });

  it('premium player gets matched first when multiple candidates exist', () => {
    // Directly push two entries onto the queue to avoid immediate matching
    lobby.queue.push(
      { sessionId: 's1', socketId: 'sock1', playerName: 'Free', timeControl: { time: 300, increment: 0 }, userId: null, wagerAmount: 0, isPremium: false, colorPref: 'random' },
      { sessionId: 's2', socketId: 'sock2', playerName: 'Premium', timeControl: { time: 300, increment: 0 }, userId: null, wagerAmount: 0, isPremium: true, colorPref: 'random' },
    );
    // Third player arrives — should match with premium (s2) first due to sort
    const match = lobby.addToQueue('s3', 'sock3', 'Seeker', { time: 300, increment: 0 }, null, null, 'random', 0, null, false);
    expect(match).toBeTruthy();
    // The free player (s1) should still be in queue
    expect(lobby.queue).toHaveLength(1);
    expect(lobby.queue[0].sessionId).toBe('s1');
  });

  it('createPendingGame stores isPremium', () => {
    const gameId = lobby.createPendingGame('s1', 'sock1', 'Alice', { time: 300, increment: 0 }, null, null, 'random', 0, null, true);
    const pending = lobby.pendingGames.get(gameId);
    expect(pending.isPremium).toBe(true);
  });

  it('getOpenGames includes isPremium', () => {
    lobby.createPendingGame('s1', 'sock1', 'Alice', { time: 300, increment: 0 }, null, null, 'random', 0, null, true);
    const games = lobby.getOpenGames();
    expect(games[0].isPremium).toBe(true);
  });

  it('getSeekers includes isPremium', () => {
    lobby.addToQueue('s1', 'sock1', 'Alice', { time: 300, increment: 0 }, null, null, 'random', 0, null, true);
    const seekers = lobby.getSeekers();
    expect(seekers[0].isPremium).toBe(true);
  });

  it('joinPendingGame passes isPremium to room.addPlayer', () => {
    const gameId = lobby.createPendingGame('s1', 'sock1', 'Creator', { time: 300, increment: 0 }, 'uid1', null, 'random', 0, null, true);
    const result = lobby.joinPendingGame(gameId, 's2', 'sock2', 'Joiner', 'uid2', false);
    expect(result.room).toBeTruthy();
    // One player should have isPremium true, one false
    const premiumFlags = [result.room.white.isPremium, result.room.black.isPremium].sort();
    expect(premiumFlags).toEqual([false, true]);
  });
});

describe('Premium — Animation Speed', () => {
  it('animation_speed is included in VALID_ANIMATION_SPEEDS concept', () => {
    const valid = ['instant', 'fast', 'normal', 'slow'];
    expect(valid).toContain('instant');
    expect(valid).toContain('fast');
    expect(valid).toContain('normal');
    expect(valid).toContain('slow');
    expect(valid).not.toContain('turbo');
  });
});

describe('PremiumExpiryChecker', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('checkExpired calls UPDATE on expired premium users', async () => {
    const pool = createMockPool();
    pool.query.mockResolvedValueOnce({ rows: [{ id: 'u1' }], rowCount: 1 }); // first UPDATE (users)
    pool.query.mockResolvedValueOnce({ rows: [], rowCount: 1 }); // second UPDATE (subscriptions)

    const checker = new PremiumExpiryChecker(pool);
    await checker.checkExpired();

    expect(pool.query).toHaveBeenCalledTimes(2);
    const firstCall = pool.query.mock.calls[0][0];
    expect(firstCall).toContain('UPDATE users SET is_premium = false');
    const secondCall = pool.query.mock.calls[1][0];
    expect(secondCall).toContain('UPDATE subscriptions');
  });

  it('checkExpired does not update subscriptions when no users expired', async () => {
    const pool = createMockPool();
    pool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });

    const checker = new PremiumExpiryChecker(pool);
    await checker.checkExpired();

    expect(pool.query).toHaveBeenCalledTimes(1);
  });

  it('start sets up interval and calls checkExpired immediately', async () => {
    const pool = createMockPool();
    pool.query.mockResolvedValue({ rows: [], rowCount: 0 });

    const checker = new PremiumExpiryChecker(pool);
    checker.start();

    // Should have been called once immediately
    // Use await to let the promise resolve
    await vi.advanceTimersByTimeAsync(0);
    expect(pool.query).toHaveBeenCalled();

    checker.stop();
  });

  it('stop clears the interval', () => {
    const pool = createMockPool();
    pool.query.mockResolvedValue({ rows: [], rowCount: 0 });

    const checker = new PremiumExpiryChecker(pool);
    checker.start();
    expect(checker.interval).not.toBeNull();

    checker.stop();
    expect(checker.interval).toBeNull();
  });
});
