import { vi } from 'vitest';

/**
 * Returns predetermined analysis results for known FENs.
 * Used by GameAnalyzer tests to avoid needing real Stockfish.
 */
export class MockAnalysisEngine {
  constructor(responses = {}) {
    this.responses = responses;
    this.analyzePosition = vi.fn().mockImplementation((fen, depth, multiPV) => {
      if (this.responses[fen]) {
        return Promise.resolve(this.responses[fen]);
      }
      // Default: return a generic result with the first legal move
      return Promise.resolve({
        moves: [
          { uci: 'e2e4', cp: 30, mate: null },
          { uci: 'd2d4', cp: 20, mate: null },
          { uci: 'g1f3', cp: 15, mate: null },
        ],
      });
    });

    this.quickEval = vi.fn().mockImplementation((fen, depth) => {
      if (this.responses[fen]) {
        return Promise.resolve(this.responses[fen]);
      }
      // Default: return a single-line eval
      return Promise.resolve({
        moves: [{ uci: 'e2e4', cp: 25, mate: null }],
      });
    });
  }

  /**
   * Set a specific response for a FEN position.
   */
  setResponse(fen, result) {
    this.responses[fen] = result;
  }
}
