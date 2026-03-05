import { Chess } from 'chess.js';
import { ClockManager } from './ClockManager.js';

export class GameRoom {
  constructor(gameId, timeControl) {
    this.gameId = gameId;
    // Normalize: store as { time, increment } object
    this.timeControl = typeof timeControl === 'object'
      ? { time: timeControl.time || 300, increment: timeControl.increment || 0 }
      : { time: timeControl || 300, increment: 0 };
    this.chess = new Chess();
    this.status = 'waiting'; // waiting | active | completed

    // Players: { sessionId, socketId, name }
    this.white = null;
    this.black = null;

    this.clock = null; // created when game starts
    this.clockInterval = null;

    this.drawOffer = null; // 'w' | 'b' | null — who offered
    this.rematchOffer = null; // 'w' | 'b' | null

    this.chatMessages = [];
    this.spectatorChatMessages = [];
    this.moveHistory = []; // [{ moveNumber, white, black }]

    // Spectators: sessionId -> { socketId, name }
    this.spectators = new Map();

    // Disconnect handling
    this.disconnectTimers = {}; // sessionId -> timeout handle

    // Callbacks set by GameManager
    this.onGameOver = null;
    this.onClockUpdate = null;
  }

  addPlayer(sessionId, socketId, name, color, userId = null) {
    const player = { sessionId, socketId, name, userId };
    if (color === 'w') {
      this.white = player;
    } else {
      this.black = player;
    }
  }

  isFull() {
    return this.white !== null && this.black !== null;
  }

  startGame() {
    if (!this.isFull()) return false;

    this.status = 'active';
    this.clock = new ClockManager(this.timeControl, (flaggedSide) => {
      this._handleTimeout(flaggedSide);
    });
    this.clock.start('w');

    // Broadcast clock every second
    this.clockInterval = setInterval(() => {
      this.onClockUpdate?.(this.clock.getTimesMs());
    }, 1000);

    return true;
  }

  getPlayerColor(id) {
    if (this.white?.sessionId === id || this.white?.socketId === id) return 'w';
    if (this.black?.sessionId === id || this.black?.socketId === id) return 'b';
    return null;
  }

  getPlayerBySession(id) {
    if (this.white?.sessionId === id || this.white?.socketId === id) return this.white;
    if (this.black?.sessionId === id || this.black?.socketId === id) return this.black;
    return null;
  }

  getOpponentOf(id) {
    if (this.white?.sessionId === id || this.white?.socketId === id) return this.black;
    if (this.black?.sessionId === id || this.black?.socketId === id) return this.white;
    return null;
  }

  updateSocketId(sessionId, newSocketId) {
    if (this.white?.sessionId === sessionId) {
      this.white.socketId = newSocketId;
    } else if (this.black?.sessionId === sessionId) {
      this.black.socketId = newSocketId;
    }
  }

  tryMove(socketOrSessionId, { from, to, promotion }) {
    if (this.status !== 'active') {
      return { valid: false, message: 'Game is not active' };
    }

    const color = this.getPlayerColor(socketOrSessionId);
    if (!color) {
      console.log(`[tryMove] Player not found: id=${socketOrSessionId}, white=${this.white?.socketId}/${this.white?.sessionId}, black=${this.black?.socketId}/${this.black?.sessionId}`);
      return { valid: false, message: 'Not a player in this game' };
    }

    if (this.chess.turn() !== color) {
      console.log(`[tryMove] Not your turn: color=${color}, turn=${this.chess.turn()}`);
      return { valid: false, message: 'Not your turn' };
    }

    let move;
    try {
      move = this.chess.move({ from, to, promotion: promotion || 'q' });
    } catch {
      return { valid: false, message: 'Illegal move' };
    }
    if (!move) {
      return { valid: false, message: 'Illegal move' };
    }

    // Switch clock
    this.clock.switchTurn();

    // Clear any pending draw offer (a move implicitly declines)
    this.drawOffer = null;

    // Update move history
    this._updateMoveHistory(move);

    const times = this.clock.getTimesMs();

    // Check game over
    const gameOver = this._checkGameOver();

    return {
      valid: true,
      san: move.san,
      from: move.from,
      to: move.to,
      fen: this.chess.fen(),
      turn: this.chess.turn(),
      whiteTime: times.whiteTime,
      blackTime: times.blackTime,
      moves: this.moveHistory,
      gameOver,
    };
  }

  resign(sessionId) {
    if (this.status !== 'active') return null;

    const color = this.getPlayerColor(sessionId);
    if (!color) return null;

    const winnerColor = color === 'w' ? 'b' : 'w';
    return this._endGame(
      winnerColor === 'w' ? '1-0' : '0-1',
      'resign',
      winnerColor
    );
  }

  offerDraw(sessionId) {
    if (this.status !== 'active') return null;

    const color = this.getPlayerColor(sessionId);
    if (!color) return null;

    // Can't offer draw if there's already a pending offer
    if (this.drawOffer) return null;

    this.drawOffer = color;
    return { offeredBy: color };
  }

  respondDraw(sessionId, accept) {
    if (this.status !== 'active') return null;

    const color = this.getPlayerColor(sessionId);
    if (!color) return null;

    // Only the non-offering player can respond
    if (this.drawOffer === color) return null;
    if (!this.drawOffer) return null;

    if (accept) {
      return this._endGame('1/2-1/2', 'draw_agreement', null);
    }

    this.drawOffer = null;
    return { declined: true };
  }

  requestRematch(sessionId) {
    if (this.status !== 'completed') return null;

    const color = this.getPlayerColor(sessionId);
    if (!color) return null;

    if (this.rematchOffer) return null;

    this.rematchOffer = color;
    return { offeredBy: color };
  }

  respondRematch(sessionId, accept) {
    if (this.status !== 'completed') return null;

    const color = this.getPlayerColor(sessionId);
    if (!color) return null;

    if (this.rematchOffer === color) return null;
    if (!this.rematchOffer) return null;

    if (accept) {
      return { accepted: true };
    }

    this.rematchOffer = null;
    return { declined: true };
  }

  addChatMessage(sessionId, message) {
    const player = this.getPlayerBySession(sessionId);
    if (!player) return null;

    const sanitized = message.slice(0, 500).replace(/</g, '&lt;').replace(/>/g, '&gt;');

    const msg = {
      sender: sessionId,
      senderName: player.name,
      message: sanitized,
      timestamp: Date.now(),
    };
    this.chatMessages.push(msg);
    return msg;
  }

  addSpectator(sessionId, socketId, name) {
    this.spectators.set(sessionId, { socketId, name });
  }

  removeSpectator(sessionId) {
    this.spectators.delete(sessionId);
  }

  isSpectator(sessionId) {
    return this.spectators.has(sessionId);
  }

  getSpectatorCount() {
    return this.spectators.size;
  }

  addSpectatorChatMessage(sessionId, message) {
    const spec = this.spectators.get(sessionId);
    if (!spec) return null;

    const sanitized = message.slice(0, 500).replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const msg = {
      sender: sessionId,
      senderName: spec.name,
      message: sanitized,
      timestamp: Date.now(),
    };
    this.spectatorChatMessages.push(msg);
    return msg;
  }

  handleDisconnect(sessionId) {
    if (this.status !== 'active') return;

    // Start 60-second forfeit timer
    this.disconnectTimers[sessionId] = setTimeout(() => {
      const color = this.getPlayerColor(sessionId);
      if (color && this.status === 'active') {
        const winnerColor = color === 'w' ? 'b' : 'w';
        const result = this._endGame(
          winnerColor === 'w' ? '1-0' : '0-1',
          'abandonment',
          winnerColor
        );
        this.onGameOver?.(result);
      }
    }, 60_000);
  }

  handleReconnect(sessionId, newSocketId) {
    this.updateSocketId(sessionId, newSocketId);
    if (this.disconnectTimers[sessionId]) {
      clearTimeout(this.disconnectTimers[sessionId]);
      delete this.disconnectTimers[sessionId];
    }
  }

  getFullState(sessionId) {
    const color = this.getPlayerColor(sessionId);
    const isSpec = this.isSpectator(sessionId);
    const baseTimeMs = this.timeControl.time * 1000;
    const times = this.clock ? this.clock.getTimesMs() : {
      whiteTime: baseTimeMs,
      blackTime: baseTimeMs,
    };

    return {
      gameId: this.gameId,
      status: this.status,
      fen: this.chess.fen(),
      turn: this.chess.turn(),
      myColor: color, // null for spectators
      whiteName: this.white?.name || 'Player 1',
      blackName: this.black?.name || 'Player 2',
      timeControl: this.timeControl,
      whiteTime: times.whiteTime,
      blackTime: times.blackTime,
      moves: this.moveHistory,
      result: this._result,
      reason: this._resultReason,
      winner: this._winner,
      drawOffer: this.drawOffer,
      chatMessages: isSpec ? [] : this.chatMessages,
      spectatorChatMessages: this.spectatorChatMessages,
      spectatorCount: this.getSpectatorCount(),
    };
  }

  destroy() {
    if (this.clock) this.clock.destroy();
    if (this.clockInterval) clearInterval(this.clockInterval);
    Object.values(this.disconnectTimers).forEach(clearTimeout);
  }

  // --- Private ---

  _updateMoveHistory(move) {
    const history = this.chess.history({ verbose: true });
    const rows = [];
    for (let i = 0; i < history.length; i += 2) {
      rows.push({
        moveNumber: i / 2 + 1,
        white: history[i]?.san || '',
        black: history[i + 1]?.san || '',
      });
    }
    this.moveHistory = rows;
  }

  _checkGameOver() {
    if (!this.chess.isGameOver()) return null;

    let result, reason, winnerColor;

    if (this.chess.isCheckmate()) {
      reason = 'checkmate';
      const loser = this.chess.turn();
      winnerColor = loser === 'w' ? 'b' : 'w';
      result = winnerColor === 'w' ? '1-0' : '0-1';
    } else if (this.chess.isStalemate()) {
      reason = 'stalemate';
      result = '1/2-1/2';
      winnerColor = null;
    } else if (this.chess.isThreefoldRepetition()) {
      reason = 'threefold_repetition';
      result = '1/2-1/2';
      winnerColor = null;
    } else if (this.chess.isInsufficientMaterial()) {
      reason = 'insufficient_material';
      result = '1/2-1/2';
      winnerColor = null;
    } else if (this.chess.isDraw()) {
      reason = 'draw';
      result = '1/2-1/2';
      winnerColor = null;
    } else {
      reason = 'game_over';
      result = '1/2-1/2';
      winnerColor = null;
    }

    return this._endGame(result, reason, winnerColor);
  }

  _endGame(result, reason, winnerColor) {
    this.status = 'completed';
    this._result = result;
    this._resultReason = reason;
    this._winner = winnerColor;

    if (this.clock) this.clock.pause();
    if (this.clockInterval) {
      clearInterval(this.clockInterval);
      this.clockInterval = null;
    }

    const times = this.clock
      ? this.clock.getTimesMs()
      : { whiteTime: 0, blackTime: 0 };

    return {
      result,
      reason,
      winner: winnerColor,
      whiteTime: times.whiteTime,
      blackTime: times.blackTime,
    };
  }

  _handleTimeout(flaggedSide) {
    if (this.status !== 'active') return;

    const winnerColor = flaggedSide === 'w' ? 'b' : 'w';
    const gameOverResult = this._endGame(
      winnerColor === 'w' ? '1-0' : '0-1',
      'timeout',
      winnerColor
    );
    this.onGameOver?.(gameOverResult);
  }
}
