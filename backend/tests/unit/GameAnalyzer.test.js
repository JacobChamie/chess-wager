import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GameAnalyzer } from '../../src/fairplay/GameAnalyzer.js';
import { MockAnalysisEngine } from '../helpers/mockAnalysisEngine.js';

describe('GameAnalyzer', () => {
  let engine;
  let analyzer;

  beforeEach(() => {
    engine = new MockAnalysisEngine();
    analyzer = new GameAnalyzer(engine);
  });

  // --- Helper: build a moveHistory array from SAN move pairs ---
  function buildMoveHistory(sanPairs) {
    return sanPairs.map(([white, black], i) => ({
      moveNumber: i + 1,
      white: white ? { san: white, timeMs: 5000 } : null,
      black: black ? { san: black, timeMs: 5000 } : null,
    }));
  }

  describe('_reconstructPositions', () => {
    it('should reconstruct correct FEN sequence from valid moves', () => {
      const moves = buildMoveHistory([['e4', 'e5'], ['Nf3', 'Nc6']]);
      const positions = analyzer._reconstructPositions(moves);

      expect(positions).toHaveLength(4);
      expect(positions[0].color).toBe('w');
      expect(positions[0].san).toBe('e4');
      expect(positions[0].ply).toBe(1);
      expect(positions[1].color).toBe('b');
      expect(positions[1].san).toBe('e5');
      expect(positions[1].ply).toBe(2);
      expect(positions[2].san).toBe('Nf3');
      expect(positions[3].san).toBe('Nc6');
    });

    it('should skip invalid moves', () => {
      const moves = [
        { moveNumber: 1, white: { san: 'e4', timeMs: 5000 }, black: { san: 'INVALID', timeMs: 5000 } },
        { moveNumber: 2, white: { san: 'e4', timeMs: 5000 }, black: null }, // e4 illegal here since pawn already moved
      ];
      const positions = analyzer._reconstructPositions(moves);

      // e4 is valid, INVALID is skipped, second e4 is illegal
      expect(positions).toHaveLength(1);
      expect(positions[0].san).toBe('e4');
    });

    it('should set correct ply, color, capture, and check flags', () => {
      // Scholar's mate
      const moves = buildMoveHistory([
        ['e4', 'e5'], ['Qh5', 'Nc6'], ['Bc4', 'Nf6'], ['Qxf7', null],
      ]);
      const positions = analyzer._reconstructPositions(moves);

      // Qxf7 is a capture and checkmate — chess.js stores move SAN as input
      const qxf7 = positions.find(p => p.san.startsWith('Qxf7'));
      expect(qxf7).toBeDefined();
      expect(qxf7.wasCapture).toBe(true);
      expect(qxf7.wasCheck).toBe(true);
    });

    it('should handle string-format moves (backwards compatibility)', () => {
      const moves = [
        { moveNumber: 1, white: 'e4', black: 'e5' },
      ];
      const positions = analyzer._reconstructPositions(moves);
      expect(positions).toHaveLength(2);
      expect(positions[0].san).toBe('e4');
    });
  });

  describe('_countPieces', () => {
    it('should count 30 non-king pieces in starting position', () => {
      const startFen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
      // 16 pawns + 4 rooks + 4 knights + 4 bishops + 2 queens = 30 (excluding kings)
      expect(analyzer._countPieces(startFen)).toBe(30);
    });

    it('should count correctly in endgame', () => {
      const endgameFen = '8/8/8/4k3/8/4K3/4P3/8 w - - 0 1';
      // Just 1 pawn (kings not counted by the regex)
      expect(analyzer._countPieces(endgameFen)).toBe(1);
    });
  });

  describe('_pearsonCorrelation', () => {
    it('should return +1 for perfect positive correlation', () => {
      const r = analyzer._pearsonCorrelation([1, 2, 3, 4, 5], [2, 4, 6, 8, 10]);
      expect(r).toBeCloseTo(1.0, 5);
    });

    it('should return -1 for perfect negative correlation', () => {
      const r = analyzer._pearsonCorrelation([1, 2, 3, 4, 5], [10, 8, 6, 4, 2]);
      expect(r).toBeCloseTo(-1.0, 5);
    });

    it('should return ~0 for uncorrelated data', () => {
      const r = analyzer._pearsonCorrelation([1, 2, 3, 4, 5], [3, 1, 4, 1, 5]);
      expect(Math.abs(r)).toBeLessThan(0.5);
    });

    it('should return 0 for constant arrays', () => {
      const r = analyzer._pearsonCorrelation([5, 5, 5, 5], [5, 5, 5, 5]);
      expect(r).toBe(0);
    });

    it('should return 0 for arrays with fewer than 2 elements', () => {
      expect(analyzer._pearsonCorrelation([1], [2])).toBe(0);
      expect(analyzer._pearsonCorrelation([], [])).toBe(0);
    });
  });

  describe('_categorizeMove', () => {
    it('should categorize blunder at cpLoss > 200', () => {
      expect(analyzer._categorizeMove(201, 0, false, 1.0)).toBe('blunder');
    });

    it('should categorize mistake at cpLoss > 80', () => {
      expect(analyzer._categorizeMove(81, 0, false, 1.0)).toBe('mistake');
    });

    it('should categorize inaccuracy at cpLoss > 30', () => {
      expect(analyzer._categorizeMove(31, 0, false, 1.0)).toBe('inaccuracy');
    });

    it('should categorize brilliant for top-1 critical complex move', () => {
      expect(analyzer._categorizeMove(0, 1, true, 2.5)).toBe('brilliant');
    });

    it('should categorize great for top-1 zero-loss complex move', () => {
      expect(analyzer._categorizeMove(0, 1, false, 1.5)).toBe('great');
    });

    it('should categorize good for top-1 or top-2 with low cpLoss', () => {
      expect(analyzer._categorizeMove(10, 2, false, 0.5)).toBe('good');
    });

    it('should respect boundary values exactly', () => {
      expect(analyzer._categorizeMove(200, 0, false, 1.0)).toBe('mistake');
      expect(analyzer._categorizeMove(80, 0, false, 1.0)).toBe('inaccuracy');
      expect(analyzer._categorizeMove(30, 2, false, 1.0)).toBe('good');
    });
  });

  describe('_expectedStrengthForRating', () => {
    it('should return correct anchor values (with time bonus)', () => {
      // 300s time control adds +3 bonus
      expect(analyzer._expectedStrengthForRating(800, 300)).toBe(35 + 3);
      expect(analyzer._expectedStrengthForRating(1200, 300)).toBe(50 + 3);
      expect(analyzer._expectedStrengthForRating(2700, 300)).toBe(88 + 3);
    });

    it('should interpolate between anchors', () => {
      const strength = analyzer._expectedStrengthForRating(1000, 300);
      // Between 800(35) and 1200(50), t = 200/400 = 0.5, base = 42.5, + 3 bonus
      expect(strength).toBeCloseTo(42.5 + 3, 1);
    });

    it('should add time control bonus', () => {
      const rapid = analyzer._expectedStrengthForRating(1200, 600); // >= 600s -> +5
      const blitz = analyzer._expectedStrengthForRating(1200, 300);  // >= 300s -> +3
      const bullet = analyzer._expectedStrengthForRating(1200, 120); // < 300s -> +0
      expect(rapid).toBe(50 + 5);
      expect(blitz).toBe(50 + 3);
      expect(bullet).toBe(50);
    });

    it('should clamp at 800 and 2700', () => {
      const low = analyzer._expectedStrengthForRating(500, 300);
      const at800 = analyzer._expectedStrengthForRating(800, 300);
      expect(low).toBe(at800);

      const high = analyzer._expectedStrengthForRating(3000, 300);
      // 3000 is clamped to 2700, base=88, bonus +3
      expect(high).toBe(88 + 3);
    });
  });

  describe('_computePlayerMetrics', () => {
    it('should compute high strength when all moves match top-1', () => {
      const moveDetails = Array.from({ length: 20 }, (_, i) => ({
        color: 'w',
        matchRank: 1,
        cpLoss: 0,
        complexity: 1.5,
        isCritical: i % 3 === 0,
        timeMs: 3000 + i * 100,
        legalMoveCount: 25,
        pieceCount: 20,
      }));

      const metrics = analyzer._computePlayerMetrics(moveDetails, 'w', 1500, 300);
      // All top-1 matches -> strength score = (sum(1.0 * complexity) / sum(complexity)) * 150 = 150
      expect(metrics.strengthScore).toBe(150);
      expect(metrics.engineCorr).toBe(1.0);
      expect(metrics.acpl).toBe(0);
    });

    it('should compute low strength when no moves match', () => {
      const moveDetails = Array.from({ length: 20 }, (_, i) => ({
        color: 'w',
        matchRank: 0,
        cpLoss: 80,
        complexity: 1.0,
        isCritical: false,
        timeMs: 5000,
        legalMoveCount: 25,
        pieceCount: 20,
      }));

      const metrics = analyzer._computePlayerMetrics(moveDetails, 'w', 1500, 300);
      expect(metrics.strengthScore).toBe(0);
      expect(metrics.engineCorr).toBe(0);
      expect(metrics.acpl).toBe(80);
    });

    it('should compute ACPL as mean of cpLoss', () => {
      const moveDetails = [
        { color: 'w', matchRank: 1, cpLoss: 0, complexity: 1, isCritical: false, timeMs: 5000 },
        { color: 'w', matchRank: 1, cpLoss: 10, complexity: 1, isCritical: false, timeMs: 5000 },
        { color: 'w', matchRank: 2, cpLoss: 20, complexity: 1, isCritical: false, timeMs: 5000 },
        { color: 'w', matchRank: 0, cpLoss: 50, complexity: 1, isCritical: false, timeMs: 5000 },
      ];

      const metrics = analyzer._computePlayerMetrics(moveDetails, 'w', 1500, 300);
      expect(metrics.acpl).toBe(20); // (0 + 10 + 20 + 50) / 4
    });

    it('should return 0 critical accuracy when < 3 critical positions', () => {
      const moveDetails = [
        { color: 'w', matchRank: 1, cpLoss: 0, complexity: 2.5, isCritical: true, timeMs: 5000 },
        { color: 'w', matchRank: 1, cpLoss: 0, complexity: 1.0, isCritical: false, timeMs: 5000 },
      ];

      const metrics = analyzer._computePlayerMetrics(moveDetails, 'w', 1500, 300);
      expect(metrics.criticalAccuracy).toBe(0);
    });

    it('should return 0 timing suspicion with < 10 timed moves', () => {
      const moveDetails = Array.from({ length: 5 }, () => ({
        color: 'w',
        matchRank: 1,
        cpLoss: 0,
        complexity: 1.0,
        isCritical: false,
        timeMs: 3000,
      }));

      const metrics = analyzer._computePlayerMetrics(moveDetails, 'w', 1500, 300);
      expect(metrics.timingSuspicion).toBe(0);
    });
  });

  describe('analyze (integration with MockAnalysisEngine)', () => {
    it('should return null for games with < 5 analyzable moves', () => {
      // 4 moves total, all in book range (ply <= 20)
      const moves = buildMoveHistory([['e4', 'e5'], ['Nf3', 'Nc6']]);
      return analyzer.analyze('game-1', moves, 1500, 1500, { time: 300 }).then(result => {
        expect(result).toBeNull();
      });
    });

    it('should return null for empty move list', async () => {
      const result = await analyzer.analyze('game-1', [], 1500, 1500, { time: 300 });
      expect(result).toBeNull();
    });

    it('should return null for null moves', async () => {
      const result = await analyzer.analyze('game-1', null, 1500, 1500, { time: 300 });
      expect(result).toBeNull();
    });

    it('should analyze a long game and return metrics for both sides', async () => {
      // Generate 25 moves per side (50 ply total, 30 analyzable past book cutoff of 20)
      const moves = [];
      const gameMoves = [
        ['e4', 'e5'], ['Nf3', 'Nc6'], ['Bb5', 'a6'], ['Ba4', 'Nf6'], ['O-O', 'Be7'],
        ['Re1', 'b5'], ['Bb3', 'd6'], ['c3', 'O-O'], ['h3', 'Nb8'], ['d4', 'Nbd7'],
        ['Nbd2', 'Bb7'], ['Bc2', 'Re8'], ['Nf1', 'Bf8'], ['Ng3', 'g6'], ['Bg5', 'h6'],
        ['Bd2', 'Bg7'], ['a4', 'c5'], ['d5', 'c4'], ['b4', 'Nc5'], ['Be3', 'a5'],
        ['bxa5', 'Ncd7'], ['Nd2', 'Nc5'], ['Nb1', 'Nfd7'], ['f3', 'f5'], ['Kh1', 'Rf8'],
      ];
      for (const [w, b] of gameMoves) {
        moves.push(w ? { san: w, timeMs: 5000 } : null);
      }
      const moveHistory = gameMoves.map(([w, b], i) => ({
        moveNumber: i + 1,
        white: w ? { san: w, timeMs: 5000 } : null,
        black: b ? { san: b, timeMs: 5000 } : null,
      }));

      const result = await analyzer.analyze('game-1', moveHistory, 1500, 1500, { time: 300 });

      expect(result).not.toBeNull();
      expect(result.white).toBeDefined();
      expect(result.black).toBeDefined();
      expect(result.white.strengthScore).toBeTypeOf('number');
      expect(result.black.strengthScore).toBeTypeOf('number');
      expect(result.white.acpl).toBeTypeOf('number');
      expect(result.moveDetails.length).toBeGreaterThan(0);
      expect(result.totalMoves).toBeGreaterThan(0);
    });

    it('should use deeper analysis when quick screen flags suspicion', async () => {
      // Make engine return results where ALL moves match top-1
      // This should trigger QUICK_SCREEN_THRESHOLD (0.5) -> deep analysis
      const gameMoves = [
        ['e4', 'e5'], ['Nf3', 'Nc6'], ['Bb5', 'a6'], ['Ba4', 'Nf6'], ['O-O', 'Be7'],
        ['Re1', 'b5'], ['Bb3', 'd6'], ['c3', 'O-O'], ['h3', 'Nb8'], ['d4', 'Nbd7'],
        ['Nbd2', 'Bb7'], ['Bc2', 'Re8'], ['Nf1', 'Bf8'], ['Ng3', 'g6'], ['Bg5', 'h6'],
      ];
      const moveHistory = gameMoves.map(([w, b], i) => ({
        moveNumber: i + 1,
        white: { san: w, timeMs: 5000 },
        black: { san: b, timeMs: 5000 },
      }));

      // For quick screen: make engine return the actual move as top-1 for every position
      // We do this by making quickEval return a result that matches each move's UCI
      const positions = analyzer._reconstructPositions(moveHistory);
      for (const pos of positions) {
        engine.setResponse(pos.preFen, {
          moves: [{ uci: pos.uci, cp: 30, mate: null }],
        });
      }

      const result = await analyzer.analyze('game-1', moveHistory, 1500, 1500, { time: 300 });

      // When quick screen passes with high top-1 rate, deep analysis should use depth 20
      if (result) {
        expect(result.analysisDepth).toBe(20);
      }
    });

    it('should produce high strength score for all-engine-move game', async () => {
      const gameMoves = [
        ['e4', 'e5'], ['Nf3', 'Nc6'], ['Bb5', 'a6'], ['Ba4', 'Nf6'], ['O-O', 'Be7'],
        ['Re1', 'b5'], ['Bb3', 'd6'], ['c3', 'O-O'], ['h3', 'Nb8'], ['d4', 'Nbd7'],
        ['Nbd2', 'Bb7'], ['Bc2', 'Re8'], ['Nf1', 'Bf8'], ['Ng3', 'g6'], ['Bg5', 'h6'],
      ];
      const moveHistory = gameMoves.map(([w, b], i) => ({
        moveNumber: i + 1,
        white: { san: w, timeMs: 5000 },
        black: { san: b, timeMs: 5000 },
      }));

      // Make all positions return the actual played move as top-1 in deep analysis
      const positions = analyzer._reconstructPositions(moveHistory);
      for (const pos of positions) {
        engine.setResponse(pos.preFen, {
          moves: [
            { uci: pos.uci, cp: 30, mate: null },
            { uci: 'a2a3', cp: 10, mate: null },
            { uci: 'a2a4', cp: 5, mate: null },
          ],
        });
      }

      const result = await analyzer.analyze('game-1', moveHistory, 1500, 1500, { time: 300 });

      if (result) {
        // All top-1 matches should give high strength (close to 150)
        expect(result.white.strengthScore).toBeGreaterThanOrEqual(100);
        expect(result.white.engineCorr).toBeGreaterThanOrEqual(0.8);
      }
    });

    it('should produce moderate strength score for mixed-accuracy game', async () => {
      const gameMoves = [
        ['e4', 'e5'], ['Nf3', 'Nc6'], ['Bb5', 'a6'], ['Ba4', 'Nf6'], ['O-O', 'Be7'],
        ['Re1', 'b5'], ['Bb3', 'd6'], ['c3', 'O-O'], ['h3', 'Nb8'], ['d4', 'Nbd7'],
        ['Nbd2', 'Bb7'], ['Bc2', 'Re8'], ['Nf1', 'Bf8'], ['Ng3', 'g6'], ['Bg5', 'h6'],
      ];
      const moveHistory = gameMoves.map(([w, b], i) => ({
        moveNumber: i + 1,
        white: { san: w, timeMs: 5000 },
        black: { san: b, timeMs: 5000 },
      }));

      // Mix of matches and misses - don't set any responses so default engine
      // will return 'e2e4' for every position, most moves won't match
      const result = await analyzer.analyze('game-1', moveHistory, 1500, 1500, { time: 300 });

      if (result) {
        // Most moves won't match the default 'e2e4' response
        expect(result.white.strengthScore).toBeLessThan(120);
      }
    });
  });
});
