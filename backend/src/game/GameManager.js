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

  getActiveGames() {
    const active = [];
    for (const [gameId, room] of this.games) {
      if (room.status === 'active' && !room.isPrivate) {
        active.push({
          gameId,
          whiteName: room.white?.name || 'Player 1',
          blackName: room.black?.name || 'Player 2',
          timeControl: room.timeControl,
          spectatorCount: room.getSpectatorCount(),
          moveCount: room.chess.history().length,
          isBotGame: room.isBotGame || false,
          botPersonality: room.botPersonality ? room.botPersonality.name : null,
          wagerAmount: room.wagerAmount || 0,
          whiteIsPremium: room.white?.isPremium || false,
          blackIsPremium: room.black?.isPremium || false,
        });
      }
    }
    return active;
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
          white_time_remaining, black_time_remaining, started_at, ended_at,
          white_user_id, black_user_id, is_bot_game, bot_personality,
          wager_amount, is_wager_game, wager_status)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)
        ON CONFLICT (id) DO UPDATE SET
          status = $2, fen = $8, moves = $9, result = $10, result_reason = $11,
          white_time_remaining = $12, black_time_remaining = $13, ended_at = $15,
          white_user_id = $16, black_user_id = $17, is_bot_game = $18, bot_personality = $19,
          wager_amount = $20, is_wager_game = $21, wager_status = $22`,
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
          room.white?.userId || null,
          room.black?.userId || null,
          room.isBotGame || false,
          room.botPersonality?.id || null,
          room.wagerAmount || 0,
          room.isWagerGame || false,
          room.isWagerGame ? (room.status === 'completed' ? 'settled' : 'locked') : null,
        ]
      );

      // Update ELO ratings if both players are registered users (skip bot games)
      if (room.status === 'completed' && !room.isBotGame && room.white?.userId && room.black?.userId) {
        await this._updateRatings(room);
      }

      // Schedule cleanup of completed games after 5 minutes
      if (room.status === 'completed') {
        setTimeout(() => this.cleanupGame(gameId), 5 * 60 * 1000);
      }
    } catch (err) {
      console.error(`Failed to persist game ${gameId}:`, err.message);
    }
  }

  async _updateRatings(room) {
    const K = 32;
    try {
      const res = await this.pool.query(
        'SELECT id, rating FROM users WHERE id = $1 OR id = $2',
        [room.white.userId, room.black.userId]
      );
      const ratings = {};
      for (const row of res.rows) {
        ratings[row.id] = row.rating;
      }
      const whiteRating = ratings[room.white.userId];
      const blackRating = ratings[room.black.userId];
      if (whiteRating == null || blackRating == null) return;

      // Determine actual scores
      let whiteScore, blackScore;
      if (room._result === '1-0') {
        whiteScore = 1; blackScore = 0;
      } else if (room._result === '0-1') {
        whiteScore = 0; blackScore = 1;
      } else {
        whiteScore = 0.5; blackScore = 0.5;
      }

      const expectedWhite = 1 / (1 + Math.pow(10, (blackRating - whiteRating) / 400));
      const expectedBlack = 1 / (1 + Math.pow(10, (whiteRating - blackRating) / 400));

      const newWhiteRating = Math.round(whiteRating + K * (whiteScore - expectedWhite));
      const newBlackRating = Math.round(blackRating + K * (blackScore - expectedBlack));

      await this.pool.query('UPDATE users SET rating = $1 WHERE id = $2', [newWhiteRating, room.white.userId]);
      await this.pool.query('UPDATE users SET rating = $1 WHERE id = $2', [newBlackRating, room.black.userId]);
    } catch (err) {
      console.error('Failed to update ratings:', err.message);
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
