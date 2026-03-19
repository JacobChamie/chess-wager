import { createRequire } from 'module';
import { fork } from 'child_process';

/**
 * Stockfish wrapper configured for full-strength MultiPV analysis.
 * Used by the fair-play system to evaluate positions, NOT for bot play.
 */
export class AnalysisEngine {
  constructor() {
    this._process = null;
    this._ready = false;
    this._queue = [];
    this._busy = false;
    this._currentResolve = null;
    this._currentReject = null;
    this._buffer = '';
    this._infoLines = [];
  }

  async init() {
    return new Promise((resolve, reject) => {
      const require = createRequire(import.meta.url);
      const sfPath = require.resolve('stockfish/bin/stockfish.js');

      this._process = fork(sfPath, [], {
        stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
        silent: true,
      });

      this._process.stdout.setEncoding('utf8');
      this._process.stdout.on('data', (data) => this._onData(data));
      this._process.stderr.on('data', () => {});

      this._process.on('error', (err) => {
        console.error('[AnalysisEngine] Process error:', err.message);
        if (!this._ready) reject(err);
      });

      this._process.on('exit', (code) => {
        console.log(`[AnalysisEngine] Process exited with code ${code}`);
        this._ready = false;
      });

      this._waitFor('uciok').then(() => {
        // Configure for full-strength analysis
        this._send('setoption name UCI_LimitStrength value false');
        this._send('setoption name Hash value 64');
        this._send('setoption name Threads value 1');
        this._send('isready');
        return this._waitFor('readyok');
      }).then(() => {
        this._ready = true;
        console.log('[AnalysisEngine] Initialized (full-strength analysis mode)');
        resolve();
      }).catch(reject);

      this._send('uci');
    });
  }

  /**
   * Analyze a position and return the top N moves with evaluations.
   * @param {string} fen
   * @param {number} depth - Search depth (default 20)
   * @param {number} multiPV - Number of lines to return (default 3)
   * @returns {Promise<{moves: Array<{uci: string, cp: number, mate: number|null}>, depth: number, bestMove: string}>}
   */
  async analyzePosition(fen, depth = 20, multiPV = 3) {
    return new Promise((resolve, reject) => {
      this._queue.push({ fen, depth, multiPV, resolve, reject });
      this._processQueue();
    });
  }

  /**
   * Quick single-line evaluation at lower depth for screening.
   */
  async quickEval(fen, depth = 12) {
    return this.analyzePosition(fen, depth, 1);
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
    this._buffer = lines.pop();

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      // Resolve _waitFor
      if (this._waitResolve && trimmed.includes(this._waitTarget)) {
        const r = this._waitResolve;
        this._waitResolve = null;
        this._waitTarget = null;
        r(trimmed);
        continue;
      }

      // Collect info lines during search
      if (trimmed.startsWith('info') && trimmed.includes('multipv') && trimmed.includes(' pv ')) {
        this._infoLines.push(trimmed);
      }

      // bestmove signals completion
      if (trimmed.startsWith('bestmove') && this._currentResolve) {
        clearTimeout(this._analysisTimeout);
        const result = this._parseAnalysis(trimmed);
        this._currentResolve(result);
        this._currentResolve = null;
        this._currentReject = null;
        this._busy = false;
        this._processQueue();
      }
    }
  }

  _parseAnalysis(bestmoveLine) {
    const parts = bestmoveLine.split(/\s+/);
    const bestMove = parts[1] || '';

    // Parse info lines — get the highest-depth line for each multipv
    const pvMap = new Map(); // multipv number -> parsed info

    for (const line of this._infoLines) {
      const parsed = this._parseInfoLine(line);
      if (!parsed) continue;
      const existing = pvMap.get(parsed.multipv);
      if (!existing || parsed.depth > existing.depth) {
        pvMap.set(parsed.multipv, parsed);
      }
    }

    // Sort by multipv rank
    const moves = [];
    for (let i = 1; i <= Math.max(3, pvMap.size); i++) {
      const pv = pvMap.get(i);
      if (pv) {
        moves.push({
          uci: pv.uci,
          cp: pv.cp,
          mate: pv.mate,
        });
      }
    }

    this._infoLines = [];

    return {
      moves,
      depth: moves.length > 0 ? pvMap.get(1)?.depth || 0 : 0,
      bestMove,
    };
  }

  _parseInfoLine(line) {
    const tokens = line.split(/\s+/);
    let depth = 0, multipv = 1, cp = 0, mate = null, uci = '';

    for (let i = 0; i < tokens.length; i++) {
      switch (tokens[i]) {
        case 'depth':
          depth = parseInt(tokens[i + 1]) || 0;
          break;
        case 'multipv':
          multipv = parseInt(tokens[i + 1]) || 1;
          break;
        case 'score':
          if (tokens[i + 1] === 'cp') {
            cp = parseInt(tokens[i + 2]) || 0;
          } else if (tokens[i + 1] === 'mate') {
            mate = parseInt(tokens[i + 2]) || 0;
            // Convert mate score to centipawns for comparison
            cp = Math.sign(mate) * (30000 - Math.abs(mate));
          }
          break;
        case 'pv':
          uci = tokens[i + 1] || '';
          break;
      }
    }

    if (!uci || depth === 0) return null;

    return { depth, multipv, cp, mate, uci };
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
      }, 30000);
    });
  }

  async _processQueue() {
    if (this._busy || this._queue.length === 0) return;
    this._busy = true;

    const { fen, depth, multiPV, resolve, reject } = this._queue.shift();
    this._currentResolve = resolve;
    this._currentReject = reject;
    this._infoLines = [];

    const timeoutMs = depth * 5000 + 30000;
    this._analysisTimeout = setTimeout(() => {
      if (this._currentResolve === resolve) {
        console.warn(`[AnalysisEngine] Analysis timeout after ${timeoutMs}ms`);
        this._currentResolve = null;
        this._currentReject = null;
        this._busy = false;
        try { this._send('stop'); } catch {}
        resolve({ moves: [], depth: 0, bestMove: '' });
        this._processQueue();
      }
    }, timeoutMs);

    try {
      this._send(`setoption name MultiPV value ${multiPV}`);
      this._send('isready');
      await this._waitFor('readyok');
      this._send(`position fen ${fen}`);
      this._send(`go depth ${depth}`);
    } catch (err) {
      clearTimeout(this._analysisTimeout);
      this._currentResolve = null;
      this._currentReject = null;
      this._busy = false;
      reject(err);
      this._processQueue();
    }
  }
}
