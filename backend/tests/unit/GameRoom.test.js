import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GameRoom } from '../../src/game/GameRoom.js';
import { createStartedGame, playMoves } from '../helpers/testGameSetup.js';

describe('GameRoom', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('constructor starts in waiting status with initial position', () => {
    const room = new GameRoom('g1', 300);
    expect(room.status).toBe('waiting');
    expect(room.chess.fen()).toBe('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
  });

  it('addPlayer + isFull', () => {
    const room = new GameRoom('g1', 300);
    expect(room.isFull()).toBe(false);
    room.addPlayer('s1', 'sock1', 'Alice', 'w');
    expect(room.isFull()).toBe(false);
    room.addPlayer('s2', 'sock2', 'Bob', 'b');
    expect(room.isFull()).toBe(true);
  });

  it('startGame transitions to active and creates clock', () => {
    const room = new GameRoom('g1', 300);
    room.addPlayer('s1', 'sock1', 'Alice', 'w');
    room.addPlayer('s2', 'sock2', 'Bob', 'b');
    const started = room.startGame();
    expect(started).toBe(true);
    expect(room.status).toBe('active');
    expect(room.clock).toBeTruthy();
  });

  it('startGame returns false if not full', () => {
    const room = new GameRoom('g1', 300);
    room.addPlayer('s1', 'sock1', 'Alice', 'w');
    expect(room.startGame()).toBe(false);
    expect(room.status).toBe('waiting');
  });

  it('getPlayerColor returns correct color by sessionId', () => {
    const { room } = createStartedGame();
    expect(room.getPlayerColor('white-session')).toBe('w');
    expect(room.getPlayerColor('black-session')).toBe('b');
  });

  it('getPlayerColor returns null for unknown id', () => {
    const { room } = createStartedGame();
    expect(room.getPlayerColor('unknown')).toBeNull();
  });

  it('tryMove accepts valid e2-e4 opening', () => {
    const { room, whiteSession } = createStartedGame();
    const result = room.tryMove(whiteSession, { from: 'e2', to: 'e4' });
    expect(result.valid).toBe(true);
    expect(result.san).toBe('e4');
    expect(result.turn).toBe('b');
  });

  it('tryMove rejects when game not active', () => {
    const room = new GameRoom('g1', 300);
    room.addPlayer('s1', 'sock1', 'Alice', 'w');
    room.addPlayer('s2', 'sock2', 'Bob', 'b');
    // Don't start
    const result = room.tryMove('s1', { from: 'e2', to: 'e4' });
    expect(result.valid).toBe(false);
    expect(result.message).toMatch(/not active/i);
  });

  it('tryMove rejects from non-player', () => {
    const { room } = createStartedGame();
    const result = room.tryMove('stranger', { from: 'e2', to: 'e4' });
    expect(result.valid).toBe(false);
    expect(result.message).toMatch(/not a player/i);
  });

  it('tryMove rejects when not your turn', () => {
    const { room, blackSession } = createStartedGame();
    const result = room.tryMove(blackSession, { from: 'e7', to: 'e5' });
    expect(result.valid).toBe(false);
    expect(result.message).toMatch(/not your turn/i);
  });

  it('tryMove rejects illegal move (e2-e5)', () => {
    const { room, whiteSession } = createStartedGame();
    const result = room.tryMove(whiteSession, { from: 'e2', to: 'e5' });
    expect(result.valid).toBe(false);
    expect(result.message).toMatch(/illegal/i);
  });

  it('tryMove updates moveHistory correctly', () => {
    const { room, whiteSession, blackSession } = createStartedGame();
    room.tryMove(whiteSession, { from: 'e2', to: 'e4' });
    room.tryMove(blackSession, { from: 'e7', to: 'e5' });
    expect(room.moveHistory).toHaveLength(1);
    expect(room.moveHistory[0].white.san).toBe('e4');
    expect(room.moveHistory[0].black.san).toBe('e5');
    expect(room.moveHistory[0].moveNumber).toBe(1);
  });

  it('tryMove clears draw offer on move', () => {
    const { room, whiteSession, blackSession } = createStartedGame();
    room.offerDraw(whiteSession);
    expect(room.drawOffer).toBe('w');
    room.tryMove(whiteSession, { from: 'e2', to: 'e4' });
    expect(room.drawOffer).toBeNull();
  });

  it('tryMove detects Scholar\'s Mate (checkmate)', () => {
    const { room, whiteSession, blackSession } = createStartedGame();
    const moves = [
      { from: 'e2', to: 'e4' },  // 1. e4
      { from: 'e7', to: 'e5' },  // 1... e5
      { from: 'f1', to: 'c4' },  // 2. Bc4
      { from: 'b8', to: 'c6' },  // 2... Nc6
      { from: 'd1', to: 'h5' },  // 3. Qh5
      { from: 'g8', to: 'f6' },  // 3... Nf6??
      { from: 'h5', to: 'f7' },  // 4. Qxf7#
    ];

    const results = playMoves(room, whiteSession, blackSession, moves);
    const last = results[results.length - 1];
    expect(last.valid).toBe(true);
    expect(last.gameOver).toBeTruthy();
    expect(last.gameOver.result).toBe('1-0');
    expect(last.gameOver.reason).toBe('checkmate');
    expect(room.status).toBe('completed');
  });

  it('resign ends game with opponent winning', () => {
    const { room, whiteSession } = createStartedGame();
    const result = room.resign(whiteSession);
    expect(result.result).toBe('0-1');
    expect(result.reason).toBe('resign');
    expect(result.winner).toBe('b');
    expect(room.status).toBe('completed');
  });

  it('resign returns null when not active', () => {
    const room = new GameRoom('g1', 300);
    expect(room.resign('s1')).toBeNull();
  });

  it('offerDraw + respondDraw(accept) results in draw', () => {
    const { room, whiteSession, blackSession } = createStartedGame();
    room.offerDraw(whiteSession);
    expect(room.drawOffer).toBe('w');
    const result = room.respondDraw(blackSession, true);
    expect(result.result).toBe('1/2-1/2');
    expect(result.reason).toBe('draw_agreement');
    expect(room.status).toBe('completed');
  });

  it('respondDraw(decline) clears draw offer', () => {
    const { room, whiteSession, blackSession } = createStartedGame();
    room.offerDraw(whiteSession);
    const result = room.respondDraw(blackSession, false);
    expect(result.declined).toBe(true);
    expect(room.drawOffer).toBeNull();
  });

  it('addChatMessage sanitizes HTML and truncates', () => {
    const { room, whiteSession } = createStartedGame();
    const msg = room.addChatMessage(whiteSession, '<script>alert("xss")</script>');
    expect(msg.message).toBe('&lt;script&gt;alert("xss")&lt;/script&gt;');
    expect(msg.senderName).toBe('Alice');

    // Truncation test
    const longMsg = room.addChatMessage(whiteSession, 'a'.repeat(600));
    expect(longMsg.message.length).toBe(500);
  });

  it('handleDisconnect starts timer, handleReconnect clears it', () => {
    const { room, whiteSession } = createStartedGame();
    room.onGameOver = vi.fn();

    room.handleDisconnect(whiteSession);
    expect(room.disconnectTimers[whiteSession]).toBeDefined();

    room.handleReconnect(whiteSession, 'new-socket');
    expect(room.disconnectTimers[whiteSession]).toBeUndefined();

    // Advance past timeout — should NOT fire since we reconnected
    vi.advanceTimersByTime(70_000);
    expect(room.onGameOver).not.toHaveBeenCalled();
  });
});
