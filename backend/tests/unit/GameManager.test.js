import { describe, it, expect, vi } from 'vitest';
import { GameManager } from '../../src/game/GameManager.js';
import { createMockPool } from '../helpers/mockPool.js';

describe('GameManager', () => {
  it('createGame and getGame', () => {
    const gm = new GameManager(createMockPool());
    const room = gm.createGame({ time: 300, increment: 0 });
    expect(room).toBeTruthy();
    expect(gm.getGame(room.gameId)).toBe(room);
  });

  it('trackSession and getActiveGameForSession', () => {
    const gm = new GameManager(createMockPool());
    const room = gm.createGame({ time: 300, increment: 0 });
    gm.trackSession('session1', room.gameId);
    expect(gm.getActiveGameForSession('session1')).toBe(room);
  });

  it('getActiveGameForSession returns null for untracked', () => {
    const gm = new GameManager(createMockPool());
    expect(gm.getActiveGameForSession('unknown')).toBeNull();
  });

  it('persistGame calls pool.query with INSERT', async () => {
    const pool = createMockPool();
    const gm = new GameManager(pool);
    const room = gm.createGame({ time: 300, increment: 0 });
    room.addPlayer('s1', 'sock1', 'Alice', 'w');
    room.addPlayer('s2', 'sock2', 'Bob', 'b');
    room.startGame();
    room._endGame('1-0', 'checkmate', 'w');

    await gm.persistGame(room.gameId);
    expect(pool.query).toHaveBeenCalled();
    const callArgs = pool.query.mock.calls[0];
    expect(callArgs[0]).toContain('INSERT INTO games');
  });

  it('cleanupGame removes game and untracks sessions', async () => {
    const gm = new GameManager(createMockPool());
    const room = gm.createGame({ time: 300, increment: 0 });
    room.addPlayer('s1', 'sock1', 'Alice', 'w');
    room.addPlayer('s2', 'sock2', 'Bob', 'b');
    gm.trackSession('s1', room.gameId);
    gm.trackSession('s2', room.gameId);

    await gm.cleanupGame(room.gameId);
    expect(gm.getGame(room.gameId)).toBeNull();
    expect(gm.getActiveGameForSession('s1')).toBeNull();
    expect(gm.getActiveGameForSession('s2')).toBeNull();
  });
});
