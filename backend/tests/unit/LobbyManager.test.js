import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { LobbyManager } from '../../src/lobby/LobbyManager.js';
import { GameManager } from '../../src/game/GameManager.js';
import { createMockPool } from '../helpers/mockPool.js';

describe('LobbyManager', () => {
  let lobby;
  let gm;

  beforeEach(() => {
    vi.useFakeTimers();
    gm = new GameManager(createMockPool());
    lobby = new LobbyManager(gm);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('addToQueue returns null when no match', () => {
    const result = lobby.addToQueue('s1', 'sock1', 'Alice', { time: 300, increment: 0 });
    expect(result).toBeNull();
    expect(lobby.queue).toHaveLength(1);
  });

  it('addToQueue matches two players with same time control', () => {
    lobby.addToQueue('s1', 'sock1', 'Alice', { time: 300, increment: 0 });
    const result = lobby.addToQueue('s2', 'sock2', 'Bob', { time: 300, increment: 0 });
    expect(result).toBeTruthy();
    expect(result.room).toBeTruthy();
    expect(result.room.status).toBe('active');
    expect(lobby.queue).toHaveLength(0);
  });

  it('addToQueue does not match different time controls', () => {
    lobby.addToQueue('s1', 'sock1', 'Alice', { time: 300, increment: 0 });
    const result = lobby.addToQueue('s2', 'sock2', 'Bob', { time: 180, increment: 0 });
    expect(result).toBeNull();
    expect(lobby.queue).toHaveLength(2);
  });

  it('addToQueue prevents duplicate entries for same socket', () => {
    lobby.addToQueue('s1', 'sock1', 'Alice', { time: 300, increment: 0 });
    lobby.addToQueue('s1', 'sock1', 'Alice', { time: 180, increment: 0 });
    expect(lobby.queue).toHaveLength(1);
    expect(lobby.queue[0].timeControl.time).toBe(180);
  });

  it('removeFromQueue removes by sessionId', () => {
    lobby.addToQueue('s1', 'sock1', 'Alice', { time: 300, increment: 0 });
    lobby.removeFromQueue('s1');
    expect(lobby.queue).toHaveLength(0);
  });

  it('createPendingGame returns gameId', () => {
    const gameId = lobby.createPendingGame('s1', 'sock1', 'Alice', { time: 300, increment: 0 });
    expect(typeof gameId).toBe('string');
    expect(lobby.pendingGames.has(gameId)).toBe(true);
  });

  it('joinPendingGame starts the game', () => {
    const gameId = lobby.createPendingGame('s1', 'sock1', 'Alice', { time: 300, increment: 0 });
    const result = lobby.joinPendingGame(gameId, 's2', 'sock2', 'Bob');
    expect(result.room).toBeTruthy();
    expect(result.room.status).toBe('active');
    expect(result.creator).toBeTruthy();
    expect(result.joiner).toBeTruthy();
  });

  it('joinPendingGame rejects joining your own game', () => {
    const gameId = lobby.createPendingGame('s1', 'sock1', 'Alice', { time: 300, increment: 0 });
    const result = lobby.joinPendingGame(gameId, 's1', 'sock1b', 'Alice');
    expect(result.error).toMatch(/own game/i);
  });

  it('joinPendingGame returns error for nonexistent game', () => {
    const result = lobby.joinPendingGame('nonexistent', 's2', 'sock2', 'Bob');
    expect(result.error).toBeTruthy();
  });
});
