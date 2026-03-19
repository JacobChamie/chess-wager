import { pool } from '../config/db.js';

/**
 * Stores and processes behavioral data collected from the client during games.
 */
export class BehaviorTracker {
  /**
   * Validate and save behavioral data for a game/player.
   * @param {string} gameId
   * @param {string} userId
   * @param {object} data - { tabSwitches, focusLosses, copyEvents, pasteEvents, mousePositions }
   */
  async saveBehavior(gameId, userId, data) {
    if (!gameId || !userId || !data) return;

    const tabSwitches = Math.max(0, parseInt(data.tabSwitches) || 0);
    const focusLosses = Math.max(0, parseInt(data.focusLosses) || 0);
    const copyEvents = Math.max(0, parseInt(data.copyEvents) || 0);
    const pasteEvents = Math.max(0, parseInt(data.pasteEvents) || 0);

    // Calculate mouse entropy from position samples
    let mouseEntropy = null;
    if (Array.isArray(data.mousePositions) && data.mousePositions.length >= 5) {
      mouseEntropy = this.calcMouseEntropy(data.mousePositions);
    }

    try {
      await pool.query(`
        INSERT INTO game_behavior (game_id, user_id, tab_switches, focus_losses, copy_events, paste_events, mouse_entropy, raw_events)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT (game_id, user_id) DO UPDATE SET
          tab_switches = $3, focus_losses = $4, copy_events = $5,
          paste_events = $6, mouse_entropy = $7, raw_events = $8
      `, [gameId, userId, tabSwitches, focusLosses, copyEvents, pasteEvents, mouseEntropy,
          JSON.stringify({ tabSwitchTimestamps: data.tabSwitchTimestamps || [] })]);
    } catch (err) {
      console.error(`[BehaviorTracker] Save error for game ${gameId}:`, err.message);
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

    const mean = displacements.reduce((a, b) => a + b, 0) / displacements.length;
    const variance = displacements.reduce((a, d) => a + (d - mean) ** 2, 0) / displacements.length;
    return Math.round(Math.sqrt(variance) * 1000) / 1000;
  }
}
