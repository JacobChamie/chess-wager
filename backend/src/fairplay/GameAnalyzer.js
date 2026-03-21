import { Chess } from 'chess.js';

const BOOK_CUTOFF = 10; // Skip first 10 full moves (20 ply)
const QUICK_SCREEN_DEPTH = 12;
const DEEP_ANALYSIS_DEPTH = 20;
const QUICK_SCREEN_THRESHOLD = 0.5; // top-1 match rate to pass screening
const QUICK_SCREEN_ACPL_THRESHOLD = 25;

/**
 * Analyzes a completed game for fair-play metrics.
 * Implements two-pass system: quick screen at depth 12, deep at depth 20 if suspicious.
 */
export class GameAnalyzer {
  constructor(analysisEngine) {
    this.engine = analysisEngine;
  }

  /**
   * Full analysis of a game.
   * @param {string} gameId
   * @param {Array} moves - moveHistory from the game
   * @param {number} whiteRating
   * @param {number} blackRating
   * @param {object} timeControl - { time, increment }
   * @returns {Promise<{white: object, black: object, moveDetails: Array}>}
   */
  async analyze(gameId, moves, whiteRating, blackRating, timeControl) {
    if (!moves || moves.length === 0) {
      return null;
    }

    // Reconstruct pre-move FENs by replaying the game
    const positions = this._reconstructPositions(moves);
    if (positions.length === 0) return null;

    // Filter out book moves
    const analyzablePositions = positions.filter(p => p.ply > BOOK_CUTOFF * 2);
    if (analyzablePositions.length < 5) return null; // Too few moves to analyze

    // Pass 1: Quick screen
    const quickResult = await this._quickScreen(analyzablePositions);

    const whiteNeedDeep = quickResult.whiteTop1Rate >= QUICK_SCREEN_THRESHOLD ||
                          quickResult.whiteACPL < QUICK_SCREEN_ACPL_THRESHOLD;
    const blackNeedDeep = quickResult.blackTop1Rate >= QUICK_SCREEN_THRESHOLD ||
                          quickResult.blackACPL < QUICK_SCREEN_ACPL_THRESHOLD;

    // Pass 2: Deep analysis (for suspicious sides, or both if either is suspicious)
    const needDeep = whiteNeedDeep || blackNeedDeep;
    const depth = needDeep ? DEEP_ANALYSIS_DEPTH : QUICK_SCREEN_DEPTH;
    const multiPV = needDeep ? 3 : 1;

    const detailedResult = await this._deepAnalysis(analyzablePositions, depth, multiPV);

    const tcSeconds = timeControl?.time || 300;
    const white = this._computePlayerMetrics(detailedResult, 'w', whiteRating, tcSeconds);
    const black = this._computePlayerMetrics(detailedResult, 'b', blackRating, tcSeconds);

    return {
      white,
      black,
      moveDetails: detailedResult,
      analysisDepth: depth,
      totalMoves: positions.length,
      bookCutoff: BOOK_CUTOFF,
    };
  }

  /**
   * Reconstruct pre-move FENs and associate with player moves.
   */
  _reconstructPositions(moves) {
    const chess = new Chess();
    const positions = [];
    let ply = 0;

    for (const moveRow of moves) {
      // White's move
      if (moveRow.white) {
        const whiteData = typeof moveRow.white === 'object' ? moveRow.white : { san: moveRow.white };
        const preFen = chess.fen();
        const legalMoveCount = chess.moves().length;
        ply++;

        try {
          const result = chess.move(whiteData.san);
          if (result) {
            positions.push({
              ply,
              color: 'w',
              san: whiteData.san,
              uci: result.from + result.to + (result.promotion || ''),
              preFen,
              postFen: chess.fen(),
              timeMs: whiteData.timeMs || 0,
              legalMoveCount,
              moveNumber: moveRow.moveNumber,
              wasCapture: !!result.captured,
              wasCheck: chess.inCheck(),
            });
          }
        } catch {
          // Invalid move, skip
        }
      }

      // Black's move
      if (moveRow.black) {
        const blackData = typeof moveRow.black === 'object' ? moveRow.black : { san: moveRow.black };
        const preFen = chess.fen();
        const legalMoveCount = chess.moves().length;
        ply++;

        try {
          const result = chess.move(blackData.san);
          if (result) {
            positions.push({
              ply,
              color: 'b',
              san: blackData.san,
              uci: result.from + result.to + (result.promotion || ''),
              preFen,
              postFen: chess.fen(),
              timeMs: blackData.timeMs || 0,
              legalMoveCount,
              moveNumber: moveRow.moveNumber,
              wasCapture: !!result.captured,
              wasCheck: chess.inCheck(),
            });
          }
        } catch {
          // Invalid move, skip
        }
      }
    }

    return positions;
  }

  /**
   * Quick screen: depth 12, MultiPV 1, just get top-1 match rate and rough ACPL.
   */
  async _quickScreen(positions) {
    let whiteMatches = 0, whiteTotal = 0, whiteCpLossSum = 0;
    let blackMatches = 0, blackTotal = 0, blackCpLossSum = 0;

    for (const pos of positions) {
      const result = await this.engine.quickEval(pos.preFen, QUICK_SCREEN_DEPTH);
      if (!result || result.moves.length === 0) continue;

      const bestUci = result.moves[0].uci;
      const matched = pos.uci === bestUci;

      // Calculate actual cp loss for non-top-1 moves
      let cpLoss = 0;
      if (!matched && result.moves[0]) {
        const postEval = await this.engine.quickEval(pos.postFen, QUICK_SCREEN_DEPTH);
        if (postEval && postEval.moves.length > 0) {
          const playerCp = -postEval.moves[0].cp;
          cpLoss = Math.abs(result.moves[0].cp - playerCp);
        } else {
          cpLoss = 30; // fallback
        }
      }

      if (pos.color === 'w') {
        whiteTotal++;
        if (matched) whiteMatches++;
        else whiteCpLossSum += cpLoss;
      } else {
        blackTotal++;
        if (matched) blackMatches++;
        else blackCpLossSum += cpLoss;
      }
    }

    return {
      whiteTop1Rate: whiteTotal > 0 ? whiteMatches / whiteTotal : 0,
      blackTop1Rate: blackTotal > 0 ? blackMatches / blackTotal : 0,
      whiteACPL: whiteTotal > 0 ? whiteCpLossSum / whiteTotal : 50,
      blackACPL: blackTotal > 0 ? blackCpLossSum / blackTotal : 50,
    };
  }

  /**
   * Deep analysis: full MultiPV evaluation with all metrics.
   */
  async _deepAnalysis(positions, depth, multiPV) {
    const results = [];

    for (const pos of positions) {
      const analysis = await this.engine.analyzePosition(pos.preFen, depth, multiPV);
      if (!analysis || analysis.moves.length === 0) continue;

      // Find player's move in engine ranking
      let matchRank = 0;
      for (let i = 0; i < analysis.moves.length; i++) {
        if (analysis.moves[i].uci === pos.uci) {
          matchRank = i + 1;
          break;
        }
      }

      // Calculate centipawn loss
      let cpLoss = 0;
      if (matchRank > 0) {
        cpLoss = Math.abs(analysis.moves[0].cp - analysis.moves[matchRank - 1].cp);
      } else {
        // Player's move not in top N — evaluate it separately
        const playerEval = await this.engine.quickEval(pos.postFen, Math.min(depth, 16));
        if (playerEval && playerEval.moves.length > 0) {
          // Negate because position is from opponent's perspective after the move
          const playerCp = -playerEval.moves[0].cp;
          cpLoss = Math.abs(analysis.moves[0].cp - playerCp);
        } else {
          cpLoss = 100; // fallback
        }
      }
      cpLoss = Math.min(cpLoss, 500); // Cap extreme blunders

      // Calculate position complexity
      const pieceCount = this._countPieces(pos.preFen);
      const evalSpread = analysis.moves.length >= 3
        ? Math.abs(analysis.moves[0].cp - analysis.moves[2].cp)
        : analysis.moves.length >= 2
          ? Math.abs(analysis.moves[0].cp - analysis.moves[1].cp)
          : 0;

      let complexity = (pos.legalMoveCount / 30) * (1 + evalSpread / 150) * (pieceCount / 30);
      complexity = Math.max(0.2, Math.min(3.0, complexity));

      // Endgame reduction
      if (pieceCount <= 6) complexity *= 0.3;
      else if (pieceCount <= 10) complexity *= 0.6;

      // Is this a critical position?
      const isCritical = evalSpread > 150 &&
                         pos.legalMoveCount > 15 &&
                         !pos.wasCapture &&
                         !pos.wasCheck;

      // Move category
      const category = this._categorizeMove(cpLoss, matchRank, isCritical, complexity);

      results.push({
        ply: pos.ply,
        color: pos.color,
        san: pos.san,
        uci: pos.uci,
        preFen: pos.preFen,
        engineTop3: analysis.moves.slice(0, 3).map(m => ({
          uci: m.uci,
          cp: m.cp,
          mate: m.mate,
        })),
        matchRank,
        cpLoss,
        complexity,
        timeMs: pos.timeMs,
        isCritical,
        category,
        legalMoveCount: pos.legalMoveCount,
        pieceCount,
      });
    }

    return results;
  }

  /**
   * Compute aggregate metrics for a single player.
   */
  _computePlayerMetrics(moveDetails, color, rating, tcSeconds) {
    const playerMoves = moveDetails.filter(m => m.color === color);
    if (playerMoves.length === 0) {
      return { strengthScore: 0, engineCorr: 0, acpl: 0, criticalAccuracy: 0, timingSuspicion: 0, epr: rating };
    }

    // Strength score
    let totalWeightedScore = 0;
    let totalComplexity = 0;
    const cpLossArray = [];
    const timeMsArray = [];
    const complexityArray = [];

    for (const move of playerMoves) {
      let moveScore = 0;
      if (move.matchRank === 1) moveScore = 1.0 * move.complexity;
      else if (move.matchRank === 2) moveScore = 0.5 * move.complexity;
      else if (move.matchRank === 3) moveScore = 0.2 * move.complexity;

      totalWeightedScore += moveScore;
      totalComplexity += move.complexity;
      cpLossArray.push(move.cpLoss);
      if (move.timeMs > 0) {
        timeMsArray.push(move.timeMs);
        complexityArray.push(move.complexity);
      }
    }

    const strengthScore = totalComplexity > 0
      ? (totalWeightedScore / totalComplexity) * 150
      : 0;

    // Engine correlation (top-1 match rate)
    const top1Matches = playerMoves.filter(m => m.matchRank === 1).length;
    const engineCorr = playerMoves.length > 0 ? top1Matches / playerMoves.length : 0;

    // ACPL
    const acpl = cpLossArray.length > 0
      ? cpLossArray.reduce((a, b) => a + b, 0) / cpLossArray.length
      : 0;

    // Critical move accuracy
    const criticalMoves = playerMoves.filter(m => m.isCritical);
    const criticalFinds = criticalMoves.filter(m => m.matchRank === 1).length;
    const criticalAccuracy = criticalMoves.length >= 3
      ? criticalFinds / criticalMoves.length
      : 0;

    // Timing suspicion (correlation between time and complexity)
    let timingSuspicion = 0;
    if (timeMsArray.length >= 10) {
      const r = this._pearsonCorrelation(timeMsArray, complexityArray);
      timingSuspicion = Math.max(0, 0.2 - r) / 0.4;
      timingSuspicion = Math.min(1, timingSuspicion);
    }

    // Expected Performance Rating
    const expectedStrength = this._expectedStrengthForRating(rating, tcSeconds);
    const epr = Math.round(rating + (strengthScore - expectedStrength) * 15);

    return {
      strengthScore: Math.round(strengthScore * 10) / 10,
      engineCorr: Math.round(engineCorr * 1000) / 1000,
      acpl: Math.round(acpl * 10) / 10,
      criticalAccuracy: Math.round(criticalAccuracy * 1000) / 1000,
      timingSuspicion: Math.round(timingSuspicion * 1000) / 1000,
      epr,
      moveCount: playerMoves.length,
      top1Matches,
      criticalTotal: criticalMoves.length,
      criticalFinds,
    };
  }

  _expectedStrengthForRating(rating, tcSeconds) {
    const anchors = [
      [800, 35], [1200, 50], [1600, 60], [2000, 72], [2400, 82], [2700, 88],
    ];

    const clamped = Math.max(800, Math.min(2700, rating));
    for (let i = 0; i < anchors.length - 1; i++) {
      const [r1, s1] = anchors[i];
      const [r2, s2] = anchors[i + 1];
      if (clamped >= r1 && clamped <= r2) {
        const t = (clamped - r1) / (r2 - r1);
        const base = s1 + t * (s2 - s1);
        const timeBonus = tcSeconds >= 600 ? 5 : tcSeconds >= 300 ? 3 : 0;
        return base + timeBonus;
      }
    }
    return 88;
  }

  _countPieces(fen) {
    const board = fen.split(' ')[0];
    let count = 0;
    for (const ch of board) {
      if (/[pnbrqPNBRQ]/.test(ch)) count++;
    }
    return count;
  }

  _pearsonCorrelation(x, y) {
    const n = x.length;
    if (n < 2) return 0;

    const meanX = x.reduce((a, b) => a + b, 0) / n;
    const meanY = y.reduce((a, b) => a + b, 0) / n;

    let num = 0, denX = 0, denY = 0;
    for (let i = 0; i < n; i++) {
      const dx = x[i] - meanX;
      const dy = y[i] - meanY;
      num += dx * dy;
      denX += dx * dx;
      denY += dy * dy;
    }

    const den = Math.sqrt(denX * denY);
    return den === 0 ? 0 : num / den;
  }

  _categorizeMove(cpLoss, matchRank, isCritical, complexity) {
    if (cpLoss > 200) return 'blunder';
    if (cpLoss > 80) return 'mistake';
    if (cpLoss > 30) return 'inaccuracy';
    if (matchRank === 1 && isCritical && complexity > 2.0) return 'brilliant';
    if (matchRank === 1 && cpLoss === 0 && complexity > 1.0) return 'great';
    if ((matchRank === 1 || matchRank === 2) && cpLoss < 30) return 'good';
    return 'good';
  }
}
