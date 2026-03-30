/**
 * Unit tests for the new anti-cheat metrics added in GameAnalyzer and FairPlayService.
 *
 * Tests cover:
 *   - flatTimingCV (suspicious if < 0.4: bot-like uniform think times)
 *   - cpLossComplexityCorr (negative = selective cheating on hard moves)
 *   - _pearsonCorrelation helper
 *   - _computeTabMoveCorr in FairPlayService
 *   - Full _computePlayerMetrics with cheating vs normal synthetic datasets
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../src/config/db.js', () => ({
  pool: { query: vi.fn().mockResolvedValue({ rows: [] }) },
}));
vi.mock('../../src/email/emailService.js', () => ({ sendEngineFlagAlert: vi.fn() }));

import { GameAnalyzer } from '../../src/fairplay/GameAnalyzer.js';
import { FairPlayService } from '../../src/fairplay/FairPlayService.js';
import { pool } from '../../src/config/db.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a synthetic array of analysed move objects for _computePlayerMetrics.
 * @param {Array<object>} overrides - per-move property overrides (length = move count)
 */
function makeMoveDetails(overrides, color = 'w') {
  return overrides.map((o, i) => ({
    ply: i * 2 + (color === 'w' ? 1 : 2),
    color,
    san: 'e4',
    uci: 'e2e4',
    matchRank: 2,
    cpLoss: 25,
    timeMs: 5000,
    complexity: 1.5,
    wasCapture: false,
    wasCheck: false,
    isCritical: false,
    legalMoveCount: 25,
    pieceCount: 20,
    engineTop3: [],
    ...o,
  }));
}

/** Repeats a factory function n times. */
function repeat(n, fn) {
  return Array.from({ length: n }, (_, i) => fn(i));
}

// ---------------------------------------------------------------------------
// GameAnalyzer — Pearson correlation
// ---------------------------------------------------------------------------

describe('GameAnalyzer._pearsonCorrelation', () => {
  let analyzer;
  beforeEach(() => { analyzer = new GameAnalyzer(null); });

  it('returns 0 for identical series (no variation)', () => {
    const x = [5, 5, 5, 5, 5];
    const y = [3, 3, 3, 3, 3];
    expect(analyzer._pearsonCorrelation(x, y)).toBe(0);
  });

  it('returns 1 for perfectly correlated series', () => {
    const x = [1, 2, 3, 4, 5];
    const y = [2, 4, 6, 8, 10];
    expect(analyzer._pearsonCorrelation(x, y)).toBeCloseTo(1.0, 5);
  });

  it('returns -1 for perfectly inversely correlated series', () => {
    const x = [1, 2, 3, 4, 5];
    const y = [10, 8, 6, 4, 2];
    expect(analyzer._pearsonCorrelation(x, y)).toBeCloseTo(-1.0, 5);
  });

  it('returns 0 for single element (n < 2)', () => {
    expect(analyzer._pearsonCorrelation([5], [3])).toBe(0);
    expect(analyzer._pearsonCorrelation([], [])).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// GameAnalyzer — flatTimingCV
// ---------------------------------------------------------------------------

describe('GameAnalyzer _computePlayerMetrics — flatTimingCV', () => {
  let analyzer;
  beforeEach(() => { analyzer = new GameAnalyzer(null); });

  it('returns null when fewer than 8 thinking moves (>1500ms)', () => {
    // 5 moves all 2000ms — below the 8-move minimum
    const moves = makeMoveDetails(repeat(5, () => ({ timeMs: 2000 })));
    const result = analyzer._computePlayerMetrics(moves, 'w', 1500, 300);
    expect(result.flatTimingCV).toBeNull();
  });

  it('returns null when all moves are fast (recaptures / forced)', () => {
    // 20 moves but all ≤ 1500ms — they won't be counted as thinking moves
    const moves = makeMoveDetails(repeat(20, () => ({ timeMs: 800 })));
    const result = analyzer._computePlayerMetrics(moves, 'w', 1500, 300);
    expect(result.flatTimingCV).toBeNull();
  });

  it('returns null for forced recaptures / check evasions even if >1500ms', () => {
    const moves = makeMoveDetails(
      repeat(20, () => ({ timeMs: 2000, wasCapture: true }))
    );
    const result = analyzer._computePlayerMetrics(moves, 'w', 1500, 300);
    expect(result.flatTimingCV).toBeNull();
  });

  it('returns near-zero CV for bot-like flat think times (suspicious)', () => {
    // 15 moves all exactly 4000ms — CV = 0
    const moves = makeMoveDetails(repeat(15, () => ({ timeMs: 4000 })));
    const result = analyzer._computePlayerMetrics(moves, 'w', 1500, 300);
    expect(result.flatTimingCV).not.toBeNull();
    expect(result.flatTimingCV).toBeLessThan(0.1);
  });

  it('returns low CV for slightly varied bot times (still suspicious)', () => {
    // Variation ≈ 5% of mean → CV ≈ 0.05
    const times = [3900, 4000, 3950, 4100, 3800, 4050, 4000, 3950, 4100, 3900];
    const moves = makeMoveDetails(times.map(t => ({ timeMs: t })));
    const result = analyzer._computePlayerMetrics(moves, 'w', 1500, 300);
    expect(result.flatTimingCV).not.toBeNull();
    expect(result.flatTimingCV).toBeLessThan(0.25);
  });

  it('returns high CV for human-like variable think times (not suspicious)', () => {
    // Human times: fast for easy moves, slow for hard ones
    const times = [800, 12000, 1700, 25000, 900, 18000, 3000, 45000, 2000, 8000,
                   1600, 30000, 4000, 15000, 2500];
    const moves = makeMoveDetails(times.map(t => ({ timeMs: t })));
    const result = analyzer._computePlayerMetrics(moves, 'w', 1500, 300);
    expect(result.flatTimingCV).not.toBeNull();
    expect(result.flatTimingCV).toBeGreaterThan(0.6);
  });
});

// ---------------------------------------------------------------------------
// GameAnalyzer — cpLossComplexityCorr
// ---------------------------------------------------------------------------

describe('GameAnalyzer _computePlayerMetrics — cpLossComplexityCorr', () => {
  let analyzer;
  beforeEach(() => { analyzer = new GameAnalyzer(null); });

  it('returns null when fewer than 10 moves', () => {
    const moves = makeMoveDetails(repeat(8, () => ({})));
    const result = analyzer._computePlayerMetrics(moves, 'w', 1500, 300);
    expect(result.cpLossComplexityCorr).toBeNull();
  });

  it('returns strong positive correlation for normal players (harder = more cp loss)', () => {
    // cpLoss tracks complexity: simple positions → low loss, complex → high loss
    const data = [
      { cpLoss: 5,  complexity: 0.4 },
      { cpLoss: 10, complexity: 0.6 },
      { cpLoss: 8,  complexity: 0.5 },
      { cpLoss: 45, complexity: 2.2 },
      { cpLoss: 60, complexity: 2.8 },
      { cpLoss: 15, complexity: 0.8 },
      { cpLoss: 80, complexity: 2.9 },
      { cpLoss: 12, complexity: 0.7 },
      { cpLoss: 55, complexity: 2.5 },
      { cpLoss: 70, complexity: 2.7 },
      { cpLoss: 20, complexity: 1.0 },
      { cpLoss: 35, complexity: 1.8 },
    ];
    const moves = makeMoveDetails(data);
    const result = analyzer._computePlayerMetrics(moves, 'w', 1500, 300);
    expect(result.cpLossComplexityCorr).not.toBeNull();
    expect(result.cpLossComplexityCorr).toBeGreaterThan(0.8);
  });

  it('returns strong negative correlation for selective cheaters (harder = less cp loss)', () => {
    // Cheater uses engine only on complex positions → low loss on hard, higher on easy
    const data = [
      { cpLoss: 50, complexity: 0.4 },  // easy: blundered
      { cpLoss: 40, complexity: 0.5 },
      { cpLoss: 45, complexity: 0.6 },
      { cpLoss: 0,  complexity: 2.8 },  // complex: perfect engine move
      { cpLoss: 0,  complexity: 2.5 },
      { cpLoss: 0,  complexity: 2.9 },
      { cpLoss: 55, complexity: 0.3 },  // easy: blundered again
      { cpLoss: 0,  complexity: 2.6 },  // complex: engine again
      { cpLoss: 48, complexity: 0.4 },
      { cpLoss: 0,  complexity: 2.7 },
      { cpLoss: 52, complexity: 0.5 },
      { cpLoss: 0,  complexity: 2.4 },
    ];
    const moves = makeMoveDetails(data);
    const result = analyzer._computePlayerMetrics(moves, 'w', 1500, 300);
    expect(result.cpLossComplexityCorr).not.toBeNull();
    expect(result.cpLossComplexityCorr).toBeLessThan(-0.7);
  });

  it('returns near-zero correlation for full-game engine use (same accuracy everywhere)', () => {
    // Consistent engine use: near-zero cpLoss at every complexity level.
    // Alternating 1 and 2 cp loss across varying complexity → very low correlation.
    const data = repeat(16, i => ({
      cpLoss: i % 2 === 0 ? 1 : 2,       // deterministic tiny variation
      complexity: 0.4 + (i % 8) * 0.35,  // 8-value cycle across all complexities
    }));
    const moves = makeMoveDetails(data);
    const result = analyzer._computePlayerMetrics(moves, 'w', 1500, 300);
    expect(result.cpLossComplexityCorr).not.toBeNull();
    expect(Math.abs(result.cpLossComplexityCorr)).toBeLessThan(0.4);
  });
});

// ---------------------------------------------------------------------------
// GameAnalyzer — full _computePlayerMetrics comparison
// ---------------------------------------------------------------------------

describe('GameAnalyzer _computePlayerMetrics — cheating vs normal comparison', () => {
  let analyzer;
  beforeEach(() => { analyzer = new GameAnalyzer(null); });

  function makeCheatMoves(n = 30) {
    return makeMoveDetails(repeat(n, i => ({
      matchRank: 1,                  // always engine top-1
      cpLoss: Math.random() * 3,     // near-zero loss
      timeMs: 3500 + (Math.random() - 0.5) * 400, // flat ~3.5s (CV ≈ 0.06)
      complexity: 0.5 + (i % 5) * 0.4,
      isCritical: i % 5 === 0,
    })));
  }

  function makeNormalMoves(n = 30) {
    return makeMoveDetails(repeat(n, i => ({
      matchRank: i % 5 === 0 ? 1 : i % 3 === 0 ? 2 : 3,
      cpLoss: 20 + Math.random() * 40,
      // log-normal-ish: very fast for easy, slow for hard
      timeMs: [1200, 18000, 2500, 35000, 5000, 12000][i % 6],
      complexity: 0.4 + (i % 7) * 0.35,
      isCritical: i % 8 === 0,
    })));
  }

  it('cheating player has significantly higher engineCorr', () => {
    const cheat = analyzer._computePlayerMetrics(makeCheatMoves(), 'w', 1500, 300);
    const normal = analyzer._computePlayerMetrics(makeNormalMoves(), 'w', 1500, 300);
    expect(cheat.engineCorr).toBeGreaterThan(0.8);
    expect(normal.engineCorr).toBeLessThan(0.5);
  });

  it('cheating player has significantly lower ACPL', () => {
    const cheat = analyzer._computePlayerMetrics(makeCheatMoves(), 'w', 1500, 300);
    const normal = analyzer._computePlayerMetrics(makeNormalMoves(), 'w', 1500, 300);
    expect(cheat.acpl).toBeLessThan(5);
    expect(normal.acpl).toBeGreaterThan(20);
  });

  it('cheating player has significantly lower flatTimingCV', () => {
    const cheat = analyzer._computePlayerMetrics(makeCheatMoves(), 'w', 1500, 300);
    const normal = analyzer._computePlayerMetrics(makeNormalMoves(), 'w', 1500, 300);
    expect(cheat.flatTimingCV).not.toBeNull();
    expect(normal.flatTimingCV).not.toBeNull();
    expect(cheat.flatTimingCV).toBeLessThan(0.25);
    expect(normal.flatTimingCV).toBeGreaterThan(0.5);
  });

  it('cheating player has higher strengthScore', () => {
    const cheat = analyzer._computePlayerMetrics(makeCheatMoves(), 'w', 1500, 300);
    const normal = analyzer._computePlayerMetrics(makeNormalMoves(), 'w', 1500, 300);
    expect(cheat.strengthScore).toBeGreaterThan(normal.strengthScore);
  });

  it('selective cheater has negative cpLoss-complexity correlation', () => {
    const selective = makeMoveDetails(repeat(20, i => ({
      matchRank: i % 3 === 0 ? 1 : 3,          // engine only on every 3rd move
      cpLoss: i % 3 === 0 ? 0 : 50,            // blunders otherwise
      complexity: i % 3 === 0 ? 2.5 : 0.4,     // cheats on complex, blunders on simple
      timeMs: 4000,
      isCritical: i % 3 === 0,
    })));
    const result = analyzer._computePlayerMetrics(selective, 'w', 1500, 300);
    expect(result.cpLossComplexityCorr).not.toBeNull();
    expect(result.cpLossComplexityCorr).toBeLessThan(-0.5);
  });
});

// ---------------------------------------------------------------------------
// FairPlayService._computeTabMoveCorr
// ---------------------------------------------------------------------------

describe('FairPlayService._computeTabMoveCorr', () => {
  let service;
  beforeEach(() => { service = new FairPlayService(); });

  const GAME_START = new Date('2024-01-01T12:00:00Z').toISOString();

  /**
   * Build a minimal analysisRow object with timing data.
   * @param {number[]} tabSwitchOffsets  - offsets from GAME_START in ms
   * @param {Array<{color, timeMs, matchRank}>} moveSeq
   */
  function makeRow(tabSwitchOffsets, moveSeq, color = 'w') {
    const rawEvents = { tabSwitchTimestamps: tabSwitchOffsets.map(o => new Date(GAME_START).getTime() + o) };

    // Build move_details with cumulative absolute times
    const details = moveSeq.map((m, i) => ({
      ply: i + 1,
      color: m.color || (i % 2 === 0 ? 'w' : 'b'),
      timeMs: m.timeMs || 4000,
      matchRank: m.matchRank ?? 2,
      san: 'e4',
      cpLoss: 10,
      complexity: 1.5,
    }));

    return {
      move_details: JSON.stringify(details),
      raw_events: JSON.stringify(rawEvents),
      started_at: GAME_START,
      player_color: color,
    };
  }

  it('returns null when no tab switches', () => {
    const row = makeRow([], [{ color: 'w', timeMs: 4000, matchRank: 1 }]);
    expect(service._computeTabMoveCorr(row)).toBeNull();
  });

  it('returns null when move_details is missing', () => {
    const row = makeRow([5000], []);
    row.move_details = null;
    expect(service._computeTabMoveCorr(row)).toBeNull();
  });

  it('returns null when fewer than 2 post-tab moves found', () => {
    // Only 1 move total, 1 tab switch → 1 post-tab move → null
    const row = makeRow([5000], [{ color: 'w', timeMs: 6000, matchRank: 1 }]);
    expect(service._computeTabMoveCorr(row)).toBeNull();
  });

  it('returns high correlation when post-tab moves are all engine top-1', () => {
    // 6 white moves spaced 5s apart, tab switch before moves 2 and 4
    // moves accumulate: 5000, 10000, 15000, 20000, 25000, 30000 ms from start
    const moves = [
      { color: 'w', timeMs: 5000, matchRank: 2 },  // 5000ms: not post-tab
      { color: 'w', timeMs: 5000, matchRank: 1 },  // 10000ms: after tab @ 8000 ✓
      { color: 'w', timeMs: 5000, matchRank: 2 },  // 15000ms: not post-tab
      { color: 'w', timeMs: 5000, matchRank: 1 },  // 20000ms: after tab @ 17000 ✓
      { color: 'w', timeMs: 5000, matchRank: 2 },  // 25000ms: not post-tab
      { color: 'w', timeMs: 5000, matchRank: 1 },  // 30000ms: after tab @ 27000 ✓
    ];
    const row = makeRow([8000, 17000, 27000], moves);
    const corr = service._computeTabMoveCorr(row);
    expect(corr).not.toBeNull();
    expect(corr).toBeGreaterThanOrEqual(0.9);
  });

  it('returns low correlation when post-tab moves are not engine top-1', () => {
    // Tab switch before every move, but moves are rank 3
    const moves = repeat(8, () => ({ color: 'w', timeMs: 5000, matchRank: 3 }));
    // Tab switches 1000ms before each cumulative move time
    const tabOffsets = [4000, 9000, 14000, 19000, 24000, 29000, 34000, 39000];
    const row = makeRow(tabOffsets, moves);
    const corr = service._computeTabMoveCorr(row);
    expect(corr).not.toBeNull();
    expect(corr).toBeLessThan(0.2);
  });

  it('ignores tab switches more than 60s before the next move (stale)', () => {
    // Tab switch 90s before the first move → outside 60s window → not counted
    const moves = repeat(4, () => ({ color: 'w', timeMs: 5000, matchRank: 1 }));
    const tabOffsets = [-85000]; // 85s before game start = 85s before first move
    const row = makeRow(tabOffsets, moves);
    // Should return null (no post-tab moves found within window)
    expect(service._computeTabMoveCorr(row)).toBeNull();
  });

  it('correctly handles malformed raw_events JSON', () => {
    const row = makeRow([5000], [{ color: 'w', timeMs: 6000, matchRank: 1 }]);
    row.raw_events = '{not valid json}';
    expect(service._computeTabMoveCorr(row)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// FairPlayService — Bayesian confirmation logic
// ---------------------------------------------------------------------------

describe('FairPlayService — Bayesian confirmation (updateFairPlayScore)', () => {
  let service;

  const makeAnalysisRow = (o = {}) => ({
    game_id: 'g1', move_details: null, raw_events: null,
    tab_switches: 0, started_at: null, player_color: 'w',
    strength: 70, corr: 0.6, acpl: 25, timing: 0.3,
    epr: 1500, flat_timing_cv: null,
    ...o,
  });

  beforeEach(() => {
    vi.clearAllMocks();
    service = new FairPlayService();
  });

  function setupMocks(analyses, { rating = 1200, linkedAccounts = [] } = {}) {
    pool.query
      .mockResolvedValueOnce({ rows: analyses })
      // Promise.all: behavior, reports, user
      .mockResolvedValueOnce({ rows: [{ total_tabs: '0' }] })
      .mockResolvedValueOnce({ rows: [{ count: '0' }] })
      .mockResolvedValueOnce({ rows: [{ rating, created_at: new Date(Date.now() - 60 * 86400000) }] })
      // linked accounts
      .mockResolvedValueOnce({ rows: linkedAccounts })
      // prevScore
      .mockResolvedValueOnce({ rows: [{ is_flagged: false, confirmed_flag: false }] })
      // upsert
      .mockResolvedValueOnce({ rows: [] });
  }

  it('confirmed_flag is false for a suspicious 19-game sample (needs 20)', async () => {
    // z-score will be high, but n = 19 < 20 so confirmed_flag should be false
    const analyses = repeat(19, () => makeAnalysisRow({ strength: 145, epr: 2100 }));
    setupMocks(analyses, { rating: 1200 });
    await service.updateFairPlayScore('u1');

    const upsertParams = pool.query.mock.calls[6][1];
    const confirmedFlag = upsertParams[17]; // $18 → index 17
    expect(confirmedFlag).toBe(false);
  });

  it('confirmed_flag is true when z >= 4.5 with 20+ games', async () => {
    // 25 games with high strength and small variance → t-stat will be enormous.
    // strength 140-149.6, expected for 1200-rated ≈ 53 → deviation ≈ 92 points above expected.
    const analyses = repeat(25, (i) => makeAnalysisRow({ strength: 140 + i * 0.4, epr: 2200 }));
    setupMocks(analyses, { rating: 1200 });
    await service.updateFairPlayScore('u1');

    const upsertParams = pool.query.mock.calls[6][1];
    const confirmedFlag = upsertParams[17];
    expect(confirmedFlag).toBe(true);
  });

  it('confirmed_flag is true when IPR > Elo+400 with 50 games', async () => {
    // EPR = 1800 for a 1200-rated player: discrepancy = 600 > 400
    const analyses = repeat(50, () => makeAnalysisRow({ strength: 70, epr: 1800 }));
    setupMocks(analyses, { rating: 1200 });
    await service.updateFairPlayScore('u1');

    const upsertParams = pool.query.mock.calls[6][1];
    const iprDiscrepancy = upsertParams[11];  // $12 → index 11
    const confirmedFlag  = upsertParams[17];  // $18 → index 17
    expect(iprDiscrepancy).toBeGreaterThan(400);
    expect(confirmedFlag).toBe(true);
  });

  it('confirmed_flag is false when IPR > 400 but sample < 50 games', async () => {
    // Only 30 games, not enough for IPR confirmation (needs 50)
    const analyses = repeat(30, () => makeAnalysisRow({ strength: 70, epr: 1800 }));
    setupMocks(analyses, { rating: 1200 });
    await service.updateFairPlayScore('u1');

    const upsertParams = pool.query.mock.calls[6][1];
    // z-score may flag it, but IPR-based confirmed needs 50 games
    // z-score in 30 games won't be >= 4.5 either if strength=70 is near expected
    const confirmedFlag = upsertParams[17];
    expect(confirmedFlag).toBe(false);
  });

  it('avg_tab_move_corr and avg_flat_timing_cv are persisted to DB', async () => {
    const gameStart = new Date(Date.now() - 600000).toISOString();
    const gs = new Date(gameStart).getTime();

    // 5 white moves, each 4000ms apart (cumulative times: 4000, 8000, 12000, 16000, 20000).
    // Plies: 1, 3, 5, 7, 9.
    // Tab switches placed 1ms before ply 3 (8000ms) and ply 9 (20000ms).
    // Those two post-tab moves must be matchRank=1 for corr=1.0.
    const moves = [
      { ply: 1, color: 'w', timeMs: 4000, matchRank: 2 }, // cumMs=4000 — NOT post-tab
      { ply: 3, color: 'w', timeMs: 4000, matchRank: 1 }, // cumMs=8000 — post tab @7999 ✓
      { ply: 5, color: 'w', timeMs: 4000, matchRank: 2 }, // cumMs=12000
      { ply: 7, color: 'w', timeMs: 4000, matchRank: 2 }, // cumMs=16000
      { ply: 9, color: 'w', timeMs: 4000, matchRank: 1 }, // cumMs=20000 — post tab @19999 ✓
    ].map(m => ({ ...m, san: 'e4', cpLoss: 5, complexity: 1.5 }));

    const tabTs = [gs + 7999, gs + 19999]; // just before cumMs 8000 and 20000
    const raw = JSON.stringify({ tabSwitchTimestamps: tabTs });
    const analyses = [makeAnalysisRow({
      move_details: JSON.stringify(moves),
      raw_events: raw,
      started_at: gameStart,
      flat_timing_cv: 0.08,
    })];
    setupMocks(analyses, { rating: 1500 });
    await service.updateFairPlayScore('u1');

    const upsertParams = pool.query.mock.calls[6][1];
    const avgFlatTimingCV = upsertParams[12]; // $13 → index 12
    const avgTabMoveCorr  = upsertParams[13]; // $14 → index 13
    expect(avgFlatTimingCV).toBe(0.08);
    // Both post-tab moves are rank 1 → corr = 1.0
    expect(avgTabMoveCorr).toBeCloseTo(1.0, 1);
  });
});
