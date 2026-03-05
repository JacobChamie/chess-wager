import { createRequire } from 'module';
import { fork } from 'child_process';
import path from 'path';

/**
 * Wraps Stockfish WASM as a child process with UCI protocol.
 * Queues concurrent requests so only one evaluation runs at a time.
 */
export class StockfishEngine {
  constructor() {
    this._process = null;
    this._ready = false;
    this._queue = [];     // Pending getBestMove requests
    this._busy = false;
    this._currentResolve = null;
    this._buffer = '';
  }

  async init() {
    return new Promise((resolve, reject) => {
      // Fork the stockfish CLI script as a child process
      const require = createRequire(import.meta.url);
      const sfPath = require.resolve('stockfish/bin/stockfish.js');

      this._process = fork(sfPath, [], {
        stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
        silent: true,
      });

      this._process.stdout.setEncoding('utf8');
      this._process.stdout.on('data', (data) => this._onData(data));
      this._process.stderr.on('data', (data) => {
        // Stockfish WASM may emit benign warnings on stderr
      });

      this._process.on('error', (err) => {
        console.error('[StockfishEngine] Process error:', err.message);
        if (!this._ready) reject(err);
      });

      this._process.on('exit', (code) => {
        console.log(`[StockfishEngine] Process exited with code ${code}`);
        this._ready = false;
      });

      // Send UCI init and wait for 'uciok'
      this._waitFor('uciok').then(() => {
        this._ready = true;
        console.log('[StockfishEngine] Initialized');
        resolve();
      }).catch(reject);

      this._send('uci');
    });
  }

  /**
   * Get best move for a position.
   * @param {string} fen - FEN string
   * @param {{ uciElo: number, moveTimeMs: number }} options
   * @returns {Promise<{ from: string, to: string, promotion: string|undefined }>}
   */
  async getBestMove(fen, { uciElo = 1400, moveTimeMs = 1000 } = {}) {
    return new Promise((resolve, reject) => {
      this._queue.push({ fen, uciElo, moveTimeMs, resolve, reject });
      this._processQueue();
    });
  }

  destroy() {
    if (this._process) {
      try { this._send('quit'); } catch {}
      this._process.kill();
      this._process = null;
    }
    this._ready = false;
  }

  // --- Internal ---

  _send(cmd) {
    if (this._process?.stdin?.writable) {
      this._process.stdin.write(cmd + '\n');
    }
  }

  _onData(data) {
    this._buffer += data;
    const lines = this._buffer.split('\n');
    this._buffer = lines.pop(); // Keep incomplete line

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      // Resolve any pending _waitFor
      if (this._waitResolve && trimmed.includes(this._waitTarget)) {
        const r = this._waitResolve;
        this._waitResolve = null;
        this._waitTarget = null;
        r(trimmed);
        continue;
      }

      // Parse bestmove response
      if (trimmed.startsWith('bestmove') && this._currentResolve) {
        const parts = trimmed.split(/\s+/);
        const moveStr = parts[1];
        if (!moveStr || moveStr === '(none)') {
          this._currentResolve(null);
        } else {
          this._currentResolve(this._parseMove(moveStr));
        }
        this._currentResolve = null;
        this._busy = false;
        this._processQueue();
      }
    }
  }

  _parseMove(moveStr) {
    // UCI format: e2e4 or e7e8q (with promotion)
    return {
      from: moveStr.slice(0, 2),
      to: moveStr.slice(2, 4),
      promotion: moveStr.length > 4 ? moveStr[4] : undefined,
    };
  }

  _waitFor(target) {
    return new Promise((resolve, reject) => {
      this._waitTarget = target;
      this._waitResolve = resolve;
      setTimeout(() => {
        if (this._waitResolve === resolve) {
          this._waitResolve = null;
          reject(new Error(`Timeout waiting for ${target}`));
        }
      }, 10000);
    });
  }

  async _processQueue() {
    if (this._busy || this._queue.length === 0) return;
    this._busy = true;

    const { fen, uciElo, moveTimeMs, resolve, reject } = this._queue.shift();
    this._currentResolve = resolve;

    try {
      // Use UCI_LimitStrength + UCI_Elo for accurate strength control
      const clampedElo = Math.max(1320, Math.min(3190, uciElo));
      this._send('setoption name UCI_LimitStrength value true');
      this._send(`setoption name UCI_Elo value ${clampedElo}`);
      this._send('isready');
      await this._waitFor('readyok');

      // Set position and search (no depth cap — let UCI_Elo handle strength)
      this._send(`position fen ${fen}`);
      this._send(`go movetime ${moveTimeMs}`);
    } catch (err) {
      this._currentResolve = null;
      this._busy = false;
      reject(err);
      this._processQueue();
    }
  }
}
