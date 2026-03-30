import { pool } from '../config/db.js';

/**
 * Stores and processes behavioral data collected from the client during games.
 */
export class BehaviorTracker {
  /**
   * Validate and save behavioral data for a game/player.
   * @param {string} gameId
   * @param {string} userId
   * @param {object} data - { tabSwitches, focusLosses, copyEvents, pasteEvents,
   *                          mousePositions, mutationEvents, simulatedClicks, canvasFingerprint }
   */
  async saveBehavior(gameId, userId, data) {
    if (!gameId || !userId || !data) return;

    const tabSwitches     = Math.max(0, parseInt(data.tabSwitches)    || 0);
    const focusLosses     = Math.max(0, parseInt(data.focusLosses)    || 0);
    const copyEvents      = Math.max(0, parseInt(data.copyEvents)     || 0);
    const pasteEvents     = Math.max(0, parseInt(data.pasteEvents)    || 0);
    const mutationEvents  = Math.max(0, parseInt(data.mutationEvents) || 0);
    const simulatedClicks = Math.max(0, parseInt(data.simulatedClicks)|| 0);

    // Sanitise canvas fingerprint: hex string, max 64 chars
    const canvasFingerprint = typeof data.canvasFingerprint === 'string'
      ? data.canvasFingerprint.replace(/[^a-f0-9]/gi, '').slice(0, 64) || null
      : null;

    // Calculate mouse entropy from position samples
    let mouseEntropy = null;
    if (Array.isArray(data.mousePositions) && data.mousePositions.length >= 5) {
      mouseEntropy = this.calcMouseEntropy(data.mousePositions);
    }

    try {
      await pool.query(`
        INSERT INTO game_behavior (
          game_id, user_id, tab_switches, focus_losses, copy_events, paste_events,
          mouse_entropy, raw_events, mutation_events, simulated_clicks, canvas_fingerprint
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
        ON CONFLICT (game_id, user_id) DO UPDATE SET
          tab_switches=$3, focus_losses=$4, copy_events=$5, paste_events=$6,
          mouse_entropy=$7, raw_events=$8,
          mutation_events=$9, simulated_clicks=$10, canvas_fingerprint=$11
      `, [
        gameId, userId, tabSwitches, focusLosses, copyEvents, pasteEvents,
        mouseEntropy,
        JSON.stringify({ tabSwitchTimestamps: data.tabSwitchTimestamps || [] }),
        mutationEvents, simulatedClicks, canvasFingerprint,
      ]);
    } catch (err) {
      console.error(`[BehaviorTracker] Save error for game ${gameId}:`, err.message);
    }

    // Update environment fingerprint and check for banned machine reuse
    if (canvasFingerprint) {
      await this._checkEnvironmentFingerprint(userId, canvasFingerprint);
    }
  }

  /**
   * Upsert the canvas fingerprint for this user and check whether the same fingerprint
   * belongs to a banned account (same-machine ban evasion).
   */
  async _checkEnvironmentFingerprint(userId, canvasHash) {
    try {
      await pool.query(`
        INSERT INTO environment_fingerprints (user_id, canvas_hash)
        VALUES ($1, $2)
        ON CONFLICT (user_id, canvas_hash) DO UPDATE SET last_seen = NOW()
      `, [userId, canvasHash]);

      // Check if any OTHER banned user shares this fingerprint
      const bannedMatch = await pool.query(`
        SELECT ef.user_id, u.username
        FROM environment_fingerprints ef
        JOIN users u ON u.id = ef.user_id
        WHERE ef.canvas_hash = $1
          AND ef.user_id != $2
          AND u.is_banned = true
        LIMIT 1
      `, [canvasHash, userId]);

      if (bannedMatch.rows[0]) {
        console.warn(
          `[BehaviorTracker] User ${userId} shares canvas fingerprint with banned user ${bannedMatch.rows[0].user_id} (${bannedMatch.rows[0].username})`
        );
        // Lower trust score immediately by flagging in fair_play_scores
        await pool.query(`
          INSERT INTO fair_play_scores (user_id, trust_score, is_flagged, flagged_at, flag_reason, last_updated)
          VALUES ($1, 30, true, NOW(), $2, NOW())
          ON CONFLICT (user_id) DO UPDATE SET
            trust_score = LEAST(fair_play_scores.trust_score, 30),
            is_flagged = true,
            flagged_at = COALESCE(fair_play_scores.flagged_at, NOW()),
            flag_reason = $2,
            last_updated = NOW()
        `, [
          userId,
          `Canvas fingerprint matches banned user ${bannedMatch.rows[0].username} — possible ban evasion`,
        ]);
      }
    } catch (err) {
      console.error(`[BehaviorTracker] Fingerprint check error:`, err.message);
    }
  }

  /**
   * Calculate mouse entropy: standard deviation of displacement magnitudes.
   * Low entropy = bot-like (no mouse movement or perfectly regular).
   * @param {Array<{x: number, y: number}>} positions
   * @returns {number}
   */
  calcMouseEntropy(positions) {
    if (positions.length < 2) return 0;

    const displacements = [];
    for (let i = 1; i < positions.length; i++) {
      const dx = (positions[i].x || 0) - (positions[i - 1].x || 0);
      const dy = (positions[i].y || 0) - (positions[i - 1].y || 0);
      displacements.push(Math.sqrt(dx * dx + dy * dy));
    }

    if (displacements.length < 2) return 0;
    const mean = displacements.reduce((a, b) => a + b, 0) / displacements.length;
    const variance = displacements.reduce((a, d) => a + (d - mean) ** 2, 0) / (displacements.length - 1);
    return Math.round(Math.sqrt(variance) * 1000) / 1000;
  }
}
