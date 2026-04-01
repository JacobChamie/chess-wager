import { pool } from '../config/db.js';

const BOOK_CUTOFF_PLY = 20;      // Skip first 10 full moves (20 ply)
const LIVE_ANALYSIS_DEPTH = 12;  // Quick-screen depth — same as GameAnalyzer's first pass
const ROLLING_WINDOW = 20;       // Rolling history length per player

// Flagging thresholds
const CONSECUTIVE_THRESHOLD = 6;        // 6 best moves in a row
const RATE_MIN_MOVES = 15;             // Minimum analyzed moves for rate-based flag
const RATE_THRESHOLD = 0.85;           // 85% top-1 rate over RATE_MIN_MOVES
const TIMING_MIN_MOVES = 10;           // Minimum analyzed moves for timing+rate flag
const TIMING_CV_THRESHOLD = 0.15;      // CV below this = suspiciously uniform
const TIMING_RATE_THRESHOLD = 0.70;    // Top-1 rate threshold when combined with timing

/**
 * Per-move live cheat detection.
 *
 * Runs lightweight Stockfish analysis (depth 12) asynchronously after every move
 * and tracks rolling metrics per player. When suspicious thresholds are exceeded,
 * it inserts a live_cheat_flags row and puts the wager on hold.
 *
 * All public methods are safe to fire-and-forget — errors are caught internally.
 */
export class LiveCheatDetector {
  constructor(engine) {
    this._engine = engine;
    // gameId -> { white: PlayerState, black: PlayerState }
    this._games = new Map();
  }

  /**
   * Analyze one move and check live thresholds.
   * @param {string} gameId
   * @param {string} userId
   * @param {string} preFen  - FEN *before* the move was applied
   * @param {string} uci     - Move in UCI format, e.g. 'e2e4' or 'g7g8q'
   * @param {number} timeMs  - Milliseconds the player spent on this move
   * @param {'w'|'b'} color
   * @param {number} plyNumber - 1-based ply count after the move (used to skip book)
   * @returns {Promise<object|null>} Flag object if flagged, null otherwise
   */
  async checkMove(gameId, userId, preFen, uci, timeMs, color, plyNumber) {
    // Skip book moves
    if (plyNumber <= BOOK_CUTOFF_PLY) return null;

    // Initialize game state on first non-book move
    if (!this._games.has(gameId)) {
      this._games.set(gameId, {
        white: this._newState(),
        black: this._newState(),
      });
    }

    const gameState = this._games.get(gameId);
    const side = color === 'w' ? 'white' : 'black';
    const state = gameState[side];

    // Already flagged — skip analysis but remain idempotent
    if (state.flagged) return null;

    // Run quick Stockfish analysis at depth 12 (non-blocking from handler)
    let engineResult;
    try {
      engineResult = await this._engine.analyzePosition(preFen, LIVE_ANALYSIS_DEPTH, 3);
    } catch {
      return null; // Engine unavailable — fail open (don't flag on error)
    }

    const topMoves = engineResult?.moves ?? [];
    const matchRank = this._matchRank(uci, topMoves);

    // Update rolling state
    state.matchRanks.push(matchRank);
    if (state.matchRanks.length > ROLLING_WINDOW) state.matchRanks.shift();

    if (timeMs > 0) {
      state.timings.push(timeMs);
      if (state.timings.length > ROLLING_WINDOW) state.timings.shift();
    }

    if (matchRank === 1) {
      state.consecutiveCount++;
    } else {
      state.consecutiveCount = 0;
    }

    state.analyzedMoves++;

    // Check thresholds
    const flag = this._checkThresholds(state);
    if (!flag) return null;

    // Mark flagged to prevent duplicate DB writes
    state.flagged = true;

    const metrics = {
      consecutiveCount: state.consecutiveCount,
      topOneRate: this._topOneRate(state.matchRanks),
      timingCV: this._timingCV(state.timings),
      analyzedMoves: state.analyzedMoves,
    };

    // Persist flag and hold wager (best-effort — failure logs but doesn't throw)
    try {
      await pool.query(
        `INSERT INTO live_cheat_flags (game_id, user_id, reason, metrics)
         VALUES ($1, $2, $3, $4)`,
        [gameId, userId, flag.reason, JSON.stringify(metrics)]
      );

      // Hold the wager only if it hasn't already been settled or held
      await pool.query(
        `UPDATE games SET wager_status = 'held'
         WHERE id = $1 AND wager_status = 'locked'`,
        [gameId]
      );
    } catch (err) {
      console.error(`[LiveCheatDetector] DB error for game ${gameId}:`, err.message);
    }

    console.log(`[LiveCheatDetector] Flagged ${color} player in game ${gameId} — ${flag.reason}`);

    return { gameId, userId, color, reason: flag.reason, metrics };
  }

  /**
   * Free in-memory state for a completed game.
   * Call this after analyzeGame() finishes.
   */
  cleanup(gameId) {
    this._games.delete(gameId);
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  _newState() {
    return {
      matchRanks: [],       // last N match ranks (1 = top move)
      timings: [],          // last N think times in ms
      consecutiveCount: 0,  // current consecutive top-1 streak
      analyzedMoves: 0,     // total non-book moves processed
      flagged: false,
    };
  }

  /**
   * Return 1-based rank of the played move among engine's top moves.
   * Returns topMoves.length + 1 if not found.
   */
  _matchRank(uci, topMoves) {
    for (let i = 0; i < topMoves.length; i++) {
      if (topMoves[i].uci === uci) return i + 1;
    }
    return topMoves.length + 1;
  }

  _topOneRate(ranks) {
    if (ranks.length === 0) return 0;
    return ranks.filter(r => r === 1).length / ranks.length;
  }

  /** Coefficient of variation = stddev / mean. Returns null for < 2 samples. */
  _timingCV(timings) {
    if (timings.length < 2) return null;
    const mean = timings.reduce((a, b) => a + b, 0) / timings.length;
    if (mean === 0) return null;
    const variance = timings.reduce((a, b) => a + (b - mean) ** 2, 0) / timings.length;
    return Math.sqrt(variance) / mean;
  }

  /** Check all thresholds. Returns { reason } if any fires, else null. */
  _checkThresholds(state) {
    // 1. Consecutive top-1 moves
    if (state.consecutiveCount >= CONSECUTIVE_THRESHOLD) {
      return { reason: 'consecutive_engine_moves' };
    }

    const topOneRate = this._topOneRate(state.matchRanks);

    // 2. High sustained engine correlation
    if (state.analyzedMoves >= RATE_MIN_MOVES && topOneRate > RATE_THRESHOLD) {
      return { reason: 'high_engine_corr' };
    }

    // 3. Uniform timing + moderate engine rate
    if (state.analyzedMoves >= TIMING_MIN_MOVES && topOneRate > TIMING_RATE_THRESHOLD) {
      const cv = this._timingCV(state.timings);
      if (cv !== null && cv < TIMING_CV_THRESHOLD) {
        return { reason: 'flat_timing_corr' };
      }
    }

    return null;
  }
}
