import { Chess } from 'chess.js';

/**
 * Plays as a bot in a GameRoom.
 * Calls GameRoom.tryMove() directly — no Socket.IO connection needed.
 */
export class BotPlayer {
  constructor(gameRoom, botColor, personality, engine) {
    this.room = gameRoom;
    this.botColor = botColor; // 'w' or 'b'
    this.personality = personality;
    this.engine = engine;
    this.botSessionId = null; // Set by BotGameManager
    this._moveTimer = null;
    this._destroyed = false;
  }

  start() {
    // If bot plays white, schedule first move
    if (this.botColor === 'w' && this.room.status === 'active') {
      this._scheduleMove();
    }
  }

  /**
   * Called by BotGameManager when the human makes a move.
   * Checks if it's now the bot's turn and schedules a move.
   */
  onHumanMove(moveResult) {
    if (this._destroyed) return;
    if (moveResult.gameOver) return;

    // It's the bot's turn if the current turn matches the bot's color
    if (moveResult.turn === this.botColor) {
      this._scheduleMove();
    }
  }

  _scheduleMove() {
    if (this._destroyed || this.room.status !== 'active') return;

    const { min, max } = this.personality.thinkTime;
    const delay = min + Math.random() * (max - min);

    this._moveTimer = setTimeout(() => this._makeMove(), delay);
  }

  async _makeMove() {
    if (this._destroyed || this.room.status !== 'active') return;

    // Verify it's still the bot's turn
    if (this.room.chess.turn() !== this.botColor) return;

    try {
      const fen = this.room.chess.fen();
      const blunderPct = this.personality.stockfish.randomBlunderPct || 0;
      let move;

      // For weak bots: occasionally play a random legal move instead of engine move
      if (blunderPct > 0 && Math.random() * 100 < blunderPct) {
        const tmpChess = new Chess(fen);
        const legalMoves = tmpChess.moves({ verbose: true });
        if (legalMoves.length > 0) {
          const pick = legalMoves[Math.floor(Math.random() * legalMoves.length)];
          move = { from: pick.from, to: pick.to, promotion: pick.promotion };
        }
      }

      if (!move) {
        move = await this.engine.getBestMove(fen, this.personality.stockfish);
      }

      if (this._destroyed || this.room.status !== 'active') return;

      // Engine returned null (timeout or no legal moves) — fall back to random
      if (!move) {
        const tmpChess = new Chess(fen);
        const legalMoves = tmpChess.moves({ verbose: true });
        if (legalMoves.length > 0) {
          const pick = legalMoves[Math.floor(Math.random() * legalMoves.length)];
          move = { from: pick.from, to: pick.to, promotion: pick.promotion };
        } else {
          return; // No legal moves (game should be over)
        }
      }

      const result = this.room.tryMove(this.botSessionId, move);

      if (result.valid && this._onMoveCallback) {
        this._onMoveCallback(result);
      } else if (!result.valid) {
        // Move was invalid — retry after short delay
        console.warn(`[BotPlayer] Invalid move ${move.from}${move.to}, retrying`);
        setTimeout(() => this._makeMove(), 500);
      }
    } catch (err) {
      console.error(`[BotPlayer] Error making move:`, err.message);
      // Retry after delay instead of giving up
      if (!this._destroyed && this.room.status === 'active') {
        setTimeout(() => this._makeMove(), 2000);
      }
    }
  }

  /**
   * Set callback for when bot makes a move.
   * BotGameManager uses this to broadcast the move via Socket.IO.
   */
  onMove(callback) {
    this._onMoveCallback = callback;
  }

  destroy() {
    this._destroyed = true;
    if (this._moveTimer) {
      clearTimeout(this._moveTimer);
      this._moveTimer = null;
    }
  }
}
