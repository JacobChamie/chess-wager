import { pool } from '../config/db.js';
import { GameAnalyzer } from './GameAnalyzer.js';
import { BehaviorTracker } from './BehaviorTracker.js';
import { LiveCheatDetector } from './LiveCheatDetector.js';
import { sendEngineFlagAlert } from '../email/emailService.js';

/**
 * Orchestrates fair-play analysis: reports, game analysis, scoring, flagging.
 */
export class FairPlayService {
  constructor(analysisEngine) {
    this.analyzer = new GameAnalyzer(analysisEngine);
    this.behaviorTracker = new BehaviorTracker();
    this.liveDetector = new LiveCheatDetector(analysisEngine);
  }

  // --- Reports ---

  /**
   * Submit a player report. Rate-limited to 3 per 24 hours per reporter.
   */
  async submitReport(reporterId, reportedId, gameId, reason, details) {
    if (!reporterId || !reportedId || !reason) {
      throw new Error('Missing required fields');
    }
    if (reporterId === reportedId) {
      throw new Error('Cannot report yourself');
    }

    const validReasons = ['engine_use', 'stalling', 'harassment', 'other'];
    if (!validReasons.includes(reason)) {
      throw new Error('Invalid report reason');
    }

    // Rate limit: 3 reports per 24 hours
    const recent = await pool.query(
      `SELECT COUNT(*) FROM player_reports WHERE reporter_id = $1 AND created_at > NOW() - INTERVAL '24 hours'`,
      [reporterId]
    );
    if (parseInt(recent.rows[0].count) >= 3) {
      throw new Error('Report limit reached (3 per 24 hours)');
    }

    const result = await pool.query(
      `INSERT INTO player_reports (reporter_id, reported_id, game_id, reason, details)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [reporterId, reportedId, gameId || null, reason, (details || '').slice(0, 500)]
    );

    // Increment report count in fair play scores
    await pool.query(`
      INSERT INTO fair_play_scores (user_id, total_reports)
      VALUES ($1, 1)
      ON CONFLICT (user_id) DO UPDATE SET
        total_reports = fair_play_scores.total_reports + 1,
        last_updated = NOW()
    `, [reportedId]);

    return { id: result.rows[0].id };
  }

  // --- Game Analysis ---

  /**
   * Analyze a completed game. Called asynchronously after game ends.
   */
  async analyzeGame(gameId) {
    // Load game data
    const gameResult = await pool.query(
      `SELECT id, moves, white_user_id, black_user_id, time_control FROM games WHERE id = $1`,
      [gameId]
    );
    if (!gameResult.rows[0]) {
      console.warn(`[FairPlay] Game ${gameId} not found for analysis`);
      return;
    }

    const game = gameResult.rows[0];
    let moves;
    try {
      moves = typeof game.moves === 'string' ? JSON.parse(game.moves) : game.moves;
    } catch {
      console.warn(`[FairPlay] Could not parse moves for game ${gameId}`);
      return;
    }

    if (!moves || moves.length < 5) return; // Too short to analyze

    // Get player ratings
    let whiteRating = 1200, blackRating = 1200;
    if (game.white_user_id) {
      const r = await pool.query('SELECT rating FROM users WHERE id = $1', [game.white_user_id]);
      if (r.rows[0]) whiteRating = r.rows[0].rating;
    }
    if (game.black_user_id) {
      const r = await pool.query('SELECT rating FROM users WHERE id = $1', [game.black_user_id]);
      if (r.rows[0]) blackRating = r.rows[0].rating;
    }

    let timeControl = { time: 300, increment: 0 };
    try {
      timeControl = typeof game.time_control === 'string'
        ? JSON.parse(game.time_control)
        : game.time_control || timeControl;
    } catch {}

    console.log(`[FairPlay] Analyzing game ${gameId}...`);
    const analysis = await this.analyzer.analyze(gameId, moves, whiteRating, blackRating, timeControl);

    if (!analysis) {
      console.log(`[FairPlay] Game ${gameId} too short or invalid for analysis`);
      return;
    }

    // Store results
    await pool.query(`
      INSERT INTO game_analysis (
        game_id, white_user_id, black_user_id,
        white_strength_score, black_strength_score,
        white_engine_corr, black_engine_corr,
        white_acpl, black_acpl,
        white_critical_accuracy, black_critical_accuracy,
        white_timing_suspicion, black_timing_suspicion,
        white_epr, black_epr,
        white_flat_timing_cv, black_flat_timing_cv,
        white_cploss_complexity_corr, black_cploss_complexity_corr,
        move_details, analysis_depth, total_moves, book_cutoff
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)
      ON CONFLICT (game_id) DO UPDATE SET
        white_strength_score=$4, black_strength_score=$5,
        white_engine_corr=$6, black_engine_corr=$7,
        white_acpl=$8, black_acpl=$9,
        white_critical_accuracy=$10, black_critical_accuracy=$11,
        white_timing_suspicion=$12, black_timing_suspicion=$13,
        white_epr=$14, black_epr=$15,
        white_flat_timing_cv=$16, black_flat_timing_cv=$17,
        white_cploss_complexity_corr=$18, black_cploss_complexity_corr=$19,
        move_details=$20, analysis_depth=$21, total_moves=$22, book_cutoff=$23
    `, [
      gameId, game.white_user_id, game.black_user_id,
      analysis.white.strengthScore, analysis.black.strengthScore,
      analysis.white.engineCorr, analysis.black.engineCorr,
      analysis.white.acpl, analysis.black.acpl,
      analysis.white.criticalAccuracy, analysis.black.criticalAccuracy,
      analysis.white.timingSuspicion, analysis.black.timingSuspicion,
      analysis.white.epr, analysis.black.epr,
      analysis.white.flatTimingCV, analysis.black.flatTimingCV,
      analysis.white.cpLossComplexityCorr, analysis.black.cpLossComplexityCorr,
      JSON.stringify(analysis.moveDetails), analysis.analysisDepth,
      analysis.totalMoves, analysis.bookCutoff,
    ]);

    console.log(`[FairPlay] Game ${gameId} analyzed — White: ${analysis.white.strengthScore}, Black: ${analysis.black.strengthScore}`);

    // Update aggregate scores for both players
    if (game.white_user_id) {
      await this.updateFairPlayScore(game.white_user_id, gameId);
    }
    if (game.black_user_id) {
      await this.updateFairPlayScore(game.black_user_id, gameId);
    }

    // Resolve any live flag raised during this game now that deep analysis is done
    await this._resolveLiveFlag(gameId, game.white_user_id, game.black_user_id);
  }

  /**
   * Resolve live cheat flags for a game after post-game deep analysis completes.
   * If both players' trust scores are clean (≥ 60), mark flags as 'cleared'.
   * Otherwise mark as 'confirmed' so the wager stays held for admin review.
   */
  async _resolveLiveFlag(gameId, whiteUserId, blackUserId) {
    // Check whether a live flag exists for this game
    const flagRes = await pool.query(
      `SELECT id FROM live_cheat_flags WHERE game_id = $1 AND resolved = false LIMIT 1`,
      [gameId]
    );
    if (flagRes.rows.length === 0) return; // No active flag — nothing to do

    // Read both players' freshly-computed trust scores
    const userIds = [whiteUserId, blackUserId].filter(Boolean);
    const scoreRes = await pool.query(
      `SELECT user_id, trust_score, is_flagged FROM fair_play_scores WHERE user_id = ANY($1)`,
      [userIds]
    );

    const anyFlagged = scoreRes.rows.some(r => r.is_flagged || r.trust_score < 60);
    const resolution = anyFlagged ? 'confirmed' : 'cleared';

    await pool.query(
      `UPDATE live_cheat_flags
       SET resolved = true, resolved_at = NOW(), resolution = $1
       WHERE game_id = $2 AND resolved = false`,
      [resolution, gameId]
    );

    // If analysis cleared the flag, release the wager hold so handlers.js can settle it
    if (resolution === 'cleared') {
      await pool.query(
        `UPDATE games SET wager_status = 'locked' WHERE id = $1 AND wager_status = 'held'`,
        [gameId]
      );
    }

    console.log(`[FairPlay] Live flag for game ${gameId} resolved as '${resolution}'`);
  }

  /**
   * Returns the resolution of any live flag for a game.
   * Called by handlers.js after analyzeGame() to decide whether to settle or hold.
   * @returns {'cleared'|'confirmed'|'pending'|null}
   */
  async getGameLiveFlagResolution(gameId) {
    const res = await pool.query(
      `SELECT resolved, resolution FROM live_cheat_flags
       WHERE game_id = $1
       ORDER BY flagged_at DESC LIMIT 1`,
      [gameId]
    );
    if (res.rows.length === 0) return null;
    const { resolved, resolution } = res.rows[0];
    if (!resolved) return 'pending';
    return resolution; // 'cleared' | 'confirmed' | 'admin_review'
  }

  /**
   * Aggregate fair play score from last 50 analyses + behavior + reports.
   * Implements Bayesian confirmation: z-score >= 4.5 over 20+ games OR IPR > Elo+400.
   */
  async updateFairPlayScore(userId, triggeringGameId = null) {
    // Get last 50 game analyses with behavior data for tab-move correlation
    const analyses = await pool.query(`
      SELECT
        ga.game_id,
        ga.move_details,
        CASE WHEN ga.white_user_id = $1 THEN ga.white_strength_score ELSE ga.black_strength_score END AS strength,
        CASE WHEN ga.white_user_id = $1 THEN ga.white_engine_corr   ELSE ga.black_engine_corr   END AS corr,
        CASE WHEN ga.white_user_id = $1 THEN ga.white_acpl          ELSE ga.black_acpl          END AS acpl,
        CASE WHEN ga.white_user_id = $1 THEN ga.white_timing_suspicion ELSE ga.black_timing_suspicion END AS timing,
        CASE WHEN ga.white_user_id = $1 THEN ga.white_epr           ELSE ga.black_epr           END AS epr,
        CASE WHEN ga.white_user_id = $1 THEN ga.white_flat_timing_cv ELSE ga.black_flat_timing_cv END AS flat_timing_cv,
        CASE WHEN ga.white_user_id = $1 THEN 'w' ELSE 'b' END AS player_color,
        gb.raw_events,
        gb.tab_switches,
        g.started_at
      FROM game_analysis ga
      JOIN games g ON g.id = ga.game_id
      LEFT JOIN game_behavior gb ON gb.game_id = ga.game_id AND gb.user_id = $1
      WHERE ga.white_user_id = $1 OR ga.black_user_id = $1
      ORDER BY ga.created_at DESC LIMIT 50
    `, [userId]);

    const gamesAnalyzed = analyses.rows.length;
    if (gamesAnalyzed === 0) return;

    const strengthScores = analyses.rows.map(r => parseFloat(r.strength || 0));
    const avgStrength = strengthScores.reduce((a, b) => a + b, 0) / gamesAnalyzed;
    const avgCorr = analyses.rows.reduce((s, r) => s + parseFloat(r.corr || 0), 0) / gamesAnalyzed;
    const avgACPL = analyses.rows.reduce((s, r) => s + parseFloat(r.acpl || 0), 0) / gamesAnalyzed;
    const avgTiming = analyses.rows.reduce((s, r) => s + parseFloat(r.timing || 0), 0) / gamesAnalyzed;
    const avgEpr = analyses.rows.reduce((s, r) => s + parseFloat(r.epr || 0), 0) / gamesAnalyzed;

    const flatTimingRows = analyses.rows.filter(r => r.flat_timing_cv != null);
    const avgFlatTimingCV = flatTimingRows.length > 0
      ? flatTimingRows.reduce((s, r) => s + parseFloat(r.flat_timing_cv), 0) / flatTimingRows.length
      : null;

    // Tab-move correlation: for each game, compute engine match rate of moves
    // made immediately after a tab switch. High correlation = engine assisted on tab-switch cues.
    const tabMoveCorrValues = [];
    for (const row of analyses.rows) {
      const corr = this._computeTabMoveCorr(row);
      if (corr !== null) tabMoveCorrValues.push(corr);
    }
    const avgTabMoveCorr = tabMoveCorrValues.length > 0
      ? tabMoveCorrValues.reduce((a, b) => a + b, 0) / tabMoveCorrValues.length
      : null;

    // Get behavior totals, report count, and user profile in parallel
    const [behavior, reports, userResult] = await Promise.all([
      pool.query('SELECT COALESCE(SUM(tab_switches), 0) AS total_tabs FROM game_behavior WHERE user_id = $1', [userId]),
      pool.query('SELECT COUNT(*) FROM player_reports WHERE reported_id = $1', [userId]),
      pool.query('SELECT rating, created_at FROM users WHERE id = $1', [userId]),
    ]);
    const totalTabSwitches = parseInt(behavior.rows[0].total_tabs) || 0;
    const totalReports = parseInt(reports.rows[0].count) || 0;
    const userRating = userResult.rows[0]?.rating || 1200;
    const accountAge = userResult.rows[0]?.created_at
      ? (Date.now() - new Date(userResult.rows[0].created_at).getTime()) / (1000 * 60 * 60 * 24)
      : 30;

    // IPR discrepancy: how far does average EPR exceed current rating?
    const iprDiscrepancy = Math.round(avgEpr - userRating);

    // Compute z-score.
    // For small samples (< 3 games): use assumed population stddev of 12 for initial flagging.
    // For larger samples: use the sample t-statistic (mean vs expected, scaled by SE).
    // The Bayesian confirmation threshold (z >= 4.5) only applies with 20+ games.
    const expectedStrengthForZ = this._expectedStrength(userRating);
    let zScore = 0;
    if (gamesAnalyzed >= 3) {
      const variance = strengthScores.reduce((a, v) => a + (v - avgStrength) ** 2, 0) / (gamesAnalyzed - 1);
      const sampleStddev = Math.sqrt(variance);
      zScore = sampleStddev > 0
        ? (avgStrength - expectedStrengthForZ) / (sampleStddev / Math.sqrt(gamesAnalyzed))
        : 0;
    } else {
      zScore = (avgStrength - expectedStrengthForZ) / 12;
    }

    // Get linked account ratings
    let externalRating = null;
    let externalPlatform = null;
    const linked = await pool.query(
      `SELECT platform, ratings FROM linked_accounts WHERE user_id = $1 AND is_verified = true`,
      [userId]
    );
    for (const acct of linked.rows) {
      const ratings = typeof acct.ratings === 'string' ? JSON.parse(acct.ratings) : acct.ratings;
      if (ratings) {
        const bestRating = Math.max(
          ratings.bullet || 0, ratings.blitz || 0, ratings.rapid || 0, ratings.classical || 0
        );
        if (bestRating > (externalRating || 0)) {
          externalRating = bestRating;
          externalPlatform = acct.platform;
        }
      }
    }

    // --- Trust score calculation ---
    let trustScore = 100;
    const expectedStrength = this._expectedStrength(userRating);

    // Strength-based suspicion using z-score.
    // Single-game flag triggers at z > 2.0; Bayesian confirmation at z >= 4.5 (1-in-300k).
    if (zScore > 4.5) trustScore -= 35;
    else if (zScore > 3.0) trustScore -= 30;
    else if (zScore > 2.5) trustScore -= 20;
    else if (zScore > 2.0) trustScore -= 10;

    // Timing suspicion (low correlation between think time and position complexity)
    if (avgTiming > 0.7) trustScore -= 10;
    else if (avgTiming > 0.5) trustScore -= 5;

    // Flat timing penalty (suspiciously uniform move times, low CV).
    // CV < 0.10 is effectively constant timing — a strong bot indicator.
    // CV < 0.15 is very uniform — still highly suspicious.
    if (avgFlatTimingCV !== null) {
      if (avgFlatTimingCV < 0.10) trustScore -= 45;
      else if (avgFlatTimingCV < 0.15) trustScore -= 45;
      else if (avgFlatTimingCV < 0.25) trustScore -= 15;
      else if (avgFlatTimingCV < 0.40) trustScore -= 8;
    }

    // Tab-move correlation: high engine match rate on moves after tab switches
    if (avgTabMoveCorr !== null) {
      if (avgTabMoveCorr > 0.85) trustScore -= 15;
      else if (avgTabMoveCorr > 0.70) trustScore -= 8;
    }

    // IPR discrepancy: performance rating far above established Elo
    if (iprDiscrepancy > 400) trustScore -= 20;
    else if (iprDiscrepancy > 250) trustScore -= 10;
    else if (iprDiscrepancy > 150) trustScore -= 5;

    // Behavioral penalties
    const avgTabsPerGame = gamesAnalyzed > 0 ? totalTabSwitches / gamesAnalyzed : 0;
    if (avgTabsPerGame > 5) trustScore -= 10;
    else if (avgTabsPerGame > 3) trustScore -= 5;

    // Report penalties
    if (totalReports >= 5) trustScore -= 10;
    else if (totalReports >= 3) trustScore -= 5;

    // Cross-platform discrepancy
    const ratingDiscrepancy = externalRating ? userRating - externalRating : 0;
    if (externalRating) {
      if (ratingDiscrepancy > 300) trustScore -= 15;
      else if (ratingDiscrepancy > 200) trustScore -= 8;
    } else if (accountAge < 7) {
      trustScore -= 5; // New account, no external validation
    }

    trustScore = Math.max(0, Math.min(100, trustScore));

    // Bayesian confirmation: requires strong statistical evidence over sufficient sample.
    // z >= 4.5 (1-in-300k probability naturally) with 20+ games,
    // OR IPR exceeds established Elo by >400 over 50-game sample.
    const isConfirmed = (zScore >= 4.5 && gamesAnalyzed >= 20) ||
                        (iprDiscrepancy > 400 && gamesAnalyzed >= 50);

    // Flag if trust score is low
    const isFlagged = trustScore < 60;
    const flagReason = isFlagged
      ? `Trust score ${trustScore.toFixed(1)} — avg strength ${avgStrength.toFixed(1)}, z-score ${zScore.toFixed(2)}, IPR+${iprDiscrepancy}, reports ${totalReports}`
      : null;

    // Check previous flag/confirm state
    let wasAlreadyFlagged = false;
    let wasAlreadyConfirmed = false;
    const prevScore = await pool.query(
      'SELECT is_flagged, confirmed_flag FROM fair_play_scores WHERE user_id = $1',
      [userId]
    );
    if (prevScore.rows[0]) {
      wasAlreadyFlagged = prevScore.rows[0].is_flagged;
      wasAlreadyConfirmed = prevScore.rows[0].confirmed_flag;
    }

    await pool.query(`
      INSERT INTO fair_play_scores (
        user_id, trust_score, games_analyzed, avg_strength, avg_engine_corr, avg_acpl,
        total_tab_switches, total_reports, external_rating, external_platform,
        rating_discrepancy, ipr_discrepancy, avg_flat_timing_cv, avg_tab_move_corr,
        is_flagged, flagged_at, flag_reason,
        confirmed_flag, confirmed_at, last_updated
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,NOW())
      ON CONFLICT (user_id) DO UPDATE SET
        trust_score=$2, games_analyzed=$3, avg_strength=$4, avg_engine_corr=$5, avg_acpl=$6,
        total_tab_switches=$7, total_reports=$8, external_rating=$9, external_platform=$10,
        rating_discrepancy=$11, ipr_discrepancy=$12, avg_flat_timing_cv=$13, avg_tab_move_corr=$14,
        is_flagged=$15,
        flagged_at = CASE WHEN $15 AND NOT fair_play_scores.is_flagged THEN NOW() ELSE fair_play_scores.flagged_at END,
        flag_reason=$17,
        confirmed_flag=$18,
        confirmed_at = CASE WHEN $18 AND NOT fair_play_scores.confirmed_flag THEN NOW() ELSE fair_play_scores.confirmed_at END,
        last_updated=NOW()
    `, [
      userId, trustScore, gamesAnalyzed, avgStrength, avgCorr, avgACPL,
      totalTabSwitches, totalReports, externalRating, externalPlatform,
      ratingDiscrepancy, iprDiscrepancy, avgFlatTimingCV, avgTabMoveCorr,
      isFlagged, isFlagged ? new Date() : null, flagReason,
      isConfirmed, isConfirmed ? new Date() : null,
    ]);

    // Send admin email alert for newly flagged non-admin, non-bot users
    if (isFlagged && !wasAlreadyFlagged) {
      const flaggedUser = await pool.query(
        'SELECT username, is_admin, email FROM users WHERE id = $1',
        [userId]
      );
      const u = flaggedUser.rows[0];
      if (u && !u.is_admin && !u.username.startsWith('[BOT] ') && !u.email.endsWith('@stress.test')) {
        sendEngineFlagAlert({
          username: u.username,
          userId,
          gameId: triggeringGameId,
          trustScore,
          avgStrength,
          engineCorr: avgCorr,
          acpl: avgACPL,
          zScore: parseFloat(zScore.toFixed(2)),
          iprDiscrepancy,
          isConfirmed,
          flagReason,
        }).catch(err => console.error('Engine flag alert email error:', err.message));
      }
    }
  }

  /**
   * Compute the engine match rate for moves made immediately after a tab switch.
   * High correlation (>0.8) after focus-loss events is a strong engine-use signal.
   *
   * Uses tabSwitchTimestamps from raw_events + cumulative move timeMs from game start.
   */
  _computeTabMoveCorr(analysisRow) {
    if (!analysisRow.raw_events || !analysisRow.move_details || !analysisRow.started_at) {
      return null;
    }

    let rawEvents;
    try {
      rawEvents = typeof analysisRow.raw_events === 'string'
        ? JSON.parse(analysisRow.raw_events)
        : analysisRow.raw_events;
    } catch {
      return null;
    }

    const tabTimestamps = rawEvents?.tabSwitchTimestamps;
    if (!Array.isArray(tabTimestamps) || tabTimestamps.length === 0) return null;

    let moveDetails;
    try {
      moveDetails = typeof analysisRow.move_details === 'string'
        ? JSON.parse(analysisRow.move_details)
        : analysisRow.move_details;
    } catch {
      return null;
    }
    if (!Array.isArray(moveDetails) || moveDetails.length === 0) return null;

    const playerColor = analysisRow.player_color;
    const gameStart = new Date(analysisRow.started_at).getTime();

    // Build absolute timestamps for each move using cumulative timeMs
    let cumulativeMs = 0;
    const playerMoveTimestamps = [];
    for (const move of moveDetails) {
      cumulativeMs += move.timeMs || 0;
      if (move.color === playerColor) {
        playerMoveTimestamps.push({ ply: move.ply, matchRank: move.matchRank, absoluteTime: gameStart + cumulativeMs });
      }
    }
    if (playerMoveTimestamps.length === 0) return null;

    // For each tab switch, identify the first player move that came after it.
    // Use a window of up to 60 seconds after the tab switch.
    const postTabPlies = new Set();
    for (const switchTime of tabTimestamps) {
      const postTabMove = playerMoveTimestamps.find(
        m => m.absoluteTime > switchTime && m.absoluteTime < switchTime + 60000
      );
      if (postTabMove) postTabPlies.add(postTabMove.ply);
    }

    if (postTabPlies.size < 2) return null; // Too few events to be meaningful

    const postTabMoves = playerMoveTimestamps.filter(m => postTabPlies.has(m.ply));
    const engineMatches = postTabMoves.filter(m => m.matchRank === 1).length;
    return Math.round((engineMatches / postTabMoves.length) * 1000) / 1000;
  }

  _expectedStrength(rating) {
    const anchors = [[800,35],[1200,50],[1600,60],[2000,72],[2400,82],[2700,88]];
    const clamped = Math.max(800, Math.min(2700, rating));
    for (let i = 0; i < anchors.length - 1; i++) {
      const [r1, s1] = anchors[i];
      const [r2, s2] = anchors[i + 1];
      if (clamped >= r1 && clamped <= r2) {
        return s1 + ((clamped - r1) / (r2 - r1)) * (s2 - s1);
      }
    }
    return 88;
  }

  // --- Admin Queries ---

  async getReports(status, page = 1, limit = 20) {
    const offset = (page - 1) * limit;
    let whereClause = '';
    const params = [limit, offset];

    if (status && status !== 'all') {
      whereClause = 'WHERE pr.status = $3';
      params.push(status);
    }

    const countQuery = status && status !== 'all'
      ? await pool.query('SELECT COUNT(*) FROM player_reports WHERE status = $1', [status])
      : await pool.query('SELECT COUNT(*) FROM player_reports');

    const result = await pool.query(`
      SELECT pr.*,
        reporter.username AS reporter_name,
        reported.username AS reported_name
      FROM player_reports pr
      LEFT JOIN users reporter ON reporter.id = pr.reporter_id
      LEFT JOIN users reported ON reported.id = pr.reported_id
      ${whereClause}
      ORDER BY pr.created_at DESC
      LIMIT $1 OFFSET $2
    `, params);

    return {
      reports: result.rows,
      total: parseInt(countQuery.rows[0].count),
      page,
      limit,
    };
  }

  async resolveReport(reportId, adminId, status, note) {
    const validStatuses = ['reviewed', 'resolved', 'dismissed'];
    if (!validStatuses.includes(status)) {
      throw new Error('Invalid status');
    }

    const result = await pool.query(`
      UPDATE player_reports
      SET status = $1, admin_note = $2, resolved_by = $3, resolved_at = NOW()
      WHERE id = $4 RETURNING id
    `, [status, note || null, adminId, reportId]);

    if (!result.rows[0]) throw new Error('Report not found');
    return result.rows[0];
  }

  async getFlaggedUsers() {
    const result = await pool.query(`
      SELECT fps.*, u.username, u.rating, u.is_banned, u.created_at AS user_created_at
      FROM fair_play_scores fps
      JOIN users u ON u.id = fps.user_id
      WHERE fps.is_flagged = true
      ORDER BY fps.trust_score ASC
    `);
    return result.rows;
  }

  async getUserProfile(userId) {
    const user = await pool.query(
      'SELECT id, username, rating, is_banned, created_at FROM users WHERE id = $1',
      [userId]
    );
    if (!user.rows[0]) throw new Error('User not found');

    const score = await pool.query('SELECT * FROM fair_play_scores WHERE user_id = $1', [userId]);
    const recentAnalyses = await pool.query(`
      SELECT ga.*, g.result, g.result_reason
      FROM game_analysis ga
      JOIN games g ON g.id = ga.game_id
      WHERE ga.white_user_id = $1 OR ga.black_user_id = $1
      ORDER BY ga.created_at DESC LIMIT 10
    `, [userId]);

    const behavior = await pool.query(`
      SELECT * FROM game_behavior WHERE user_id = $1 ORDER BY created_at DESC LIMIT 10
    `, [userId]);

    const reports = await pool.query(`
      SELECT * FROM player_reports WHERE reported_id = $1 ORDER BY created_at DESC LIMIT 10
    `, [userId]);

    const actions = await pool.query(`
      SELECT fpa.*, u.username AS admin_name
      FROM fair_play_actions fpa
      LEFT JOIN users u ON u.id = fpa.admin_id
      WHERE fpa.target_user_id = $1
      ORDER BY fpa.created_at DESC LIMIT 10
    `, [userId]);

    return {
      user: user.rows[0],
      fairPlayScore: score.rows[0] || null,
      recentAnalyses: recentAnalyses.rows,
      behavior: behavior.rows,
      reports: reports.rows,
      actions: actions.rows,
    };
  }

  async getGameAnalysis(gameId) {
    const result = await pool.query('SELECT * FROM game_analysis WHERE game_id = $1', [gameId]);
    if (!result.rows[0]) throw new Error('Analysis not found');
    return result.rows[0];
  }

  async takeAction(adminId, userId, action, note) {
    const validActions = ['warn', 'ban', 'clear_flag', 'watchlist'];
    if (!validActions.includes(action)) {
      throw new Error('Invalid action');
    }

    // Log the action
    await pool.query(
      `INSERT INTO fair_play_actions (admin_id, target_user_id, action, note) VALUES ($1, $2, $3, $4)`,
      [adminId, userId, action, note || null]
    );

    // Execute the action
    if (action === 'ban') {
      await pool.query('UPDATE users SET is_banned = true WHERE id = $1', [userId]);
    } else if (action === 'clear_flag') {
      await pool.query(
        'UPDATE fair_play_scores SET is_flagged = false, flag_reason = NULL WHERE user_id = $1',
        [userId]
      );
    }

    return { success: true };
  }
}
