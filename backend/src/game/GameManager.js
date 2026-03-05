import { GameRoom } from './GameRoom.js';
import { generateGameId } from '../utils/idGenerator.js';

export class GameManager {
  constructor(pool) {
    this.pool = pool;
    this.games = new Map(); // gameId -> GameRoom
    this.sessionToGame = new Map(); // sessionId -> gameId (active game)
  }

  createGame(timeControl) {
    const gameId = generateGameId();
    const room = new GameRoom(gameId, timeControl);
    this.games.set(gameId, room);
    return room;
  }

  getGame(gameId) {
    return this.games.get(gameId) || null;
  }

  getActiveGameForSession(sessionId) {
    const gameId = this.sessionToGame.get(sessionId);
    if (!gameId) return null;
    return this.games.get(gameId) || null;
  }

  trackSession(sessionId, gameId) {
    this.sessionToGame.set(sessionId, gameId);
  }

  untrackSession(sessionId) {
    this.sessionToGame.delete(sessionId);
  }

  async persistGame(gameId) {
    const room = this.games.get(gameId);
    if (!room) return;

    const baseTimeMs = (typeof room.timeControl === 'object' ? room.timeControl.time : room.timeControl) * 1000;
    const times = room.clock
      ? room.clock.getTimesMs()
      : { whiteTime: baseTimeMs, blackTime: baseTimeMs };

    try {
      await this.pool.query(
        `INSERT INTO games (id, status, white_player, black_player, white_name, black_name,
          time_control, fen, moves, result, result_reason,
          white_time_remaining, black_time_remaining, started_at, ended_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
        ON CONFLICT (id) DO UPDATE SET
          status = $2, fen = $8, moves = $9, result = $10, result_reason = $11,
          white_time_remaining = $12, black_time_remaining = $13, ended_at = $15`,
        [
          room.gameId,
          room.status,
          room.white?.sessionId || null,
          room.black?.sessionId || null,
          room.white?.name || null,
          room.black?.name || null,
          JSON.stringify(room.timeControl),
          room.chess.fen(),
          JSON.stringify(room.moveHistory),
          room._result || null,
          room._resultReason || null,
          Math.round(times.whiteTime),
          Math.round(times.blackTime),
          room.status !== 'waiting' ? new Date() : null,
          room.status === 'completed' ? new Date() : null,
        ]
      );
    } catch (err) {
      console.error(`Failed to persist game ${gameId}:`, err.message);
    }
  }

  async cleanupGame(gameId) {
    const room = this.games.get(gameId);
    if (room) {
      // Untrack players
      if (room.white) this.sessionToGame.delete(room.white.sessionId);
      if (room.black) this.sessionToGame.delete(room.black.sessionId);
      room.destroy();
      this.games.delete(gameId);
    }
  }
}
