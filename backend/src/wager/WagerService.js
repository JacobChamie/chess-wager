/**
 * Handles wager escrow for chess games.
 * - lockWager: deducts tokens from both players at game start
 * - settleWager: credits winner (2x) or refunds both on draw
 *
 * Security invariants:
 * 1. lockWager uses SELECT ... FOR UPDATE to prevent concurrent balance reads
 * 2. settleWager atomically claims the game via CAS on wager_status = 'locked'
 *    so duplicate calls are no-ops (idempotent)
 * 3. All balance mutations + ledger entries happen inside a single DB transaction
 */
export class WagerService {
  constructor(pool) {
    this.pool = pool;
  }

  /**
   * Lock wager tokens from both players at game start.
   * Uses SELECT ... FOR UPDATE to prevent concurrent balance reads (TOCTOU).
   * Returns { success: true } or { success: false, error: string }
   */
  async lockWager(gameId, whiteUserId, blackUserId, amount) {
    if (!amount || amount <= 0) return { success: true };
    if (!whiteUserId || !blackUserId) {
      return { success: false, error: 'Both players must be registered to play wager games' };
    }

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      // Lock both user rows to prevent concurrent balance modifications.
      // Consistent ordering (lower UUID first) prevents deadlocks.
      const [firstId, secondId] = whiteUserId < blackUserId
        ? [whiteUserId, blackUserId]
        : [blackUserId, whiteUserId];

      const lockRes = await client.query(
        'SELECT id, token_balance FROM users WHERE id IN ($1, $2) ORDER BY id FOR UPDATE',
        [firstId, secondId]
      );

      const balances = {};
      for (const row of lockRes.rows) {
        balances[row.id] = parseFloat(row.token_balance);
      }

      if (balances[whiteUserId] == null || balances[blackUserId] == null) {
        await client.query('ROLLBACK');
        return { success: false, error: 'Player not found' };
      }
      if (balances[whiteUserId] < amount) {
        await client.query('ROLLBACK');
        return { success: false, error: 'White player has insufficient balance' };
      }
      if (balances[blackUserId] < amount) {
        await client.query('ROLLBACK');
        return { success: false, error: 'Black player has insufficient balance' };
      }

      // Deduct from white
      const whiteRes = await client.query(
        'UPDATE users SET token_balance = token_balance - $1 WHERE id = $2 RETURNING token_balance',
        [amount, whiteUserId]
      );

      // Deduct from black
      const blackRes = await client.query(
        'UPDATE users SET token_balance = token_balance - $1 WHERE id = $2 RETURNING token_balance',
        [amount, blackUserId]
      );

      // Ledger entries
      await client.query(
        `INSERT INTO ledger (user_id, type, amount, balance_after, reference_type, reference_id, description)
         VALUES ($1, 'wager_lock', $2, $3, 'game', $4, $5)`,
        [whiteUserId, -amount, whiteRes.rows[0].token_balance, gameId, `Wager lock: ${amount} tokens`]
      );
      await client.query(
        `INSERT INTO ledger (user_id, type, amount, balance_after, reference_type, reference_id, description)
         VALUES ($1, 'wager_lock', $2, $3, 'game', $4, $5)`,
        [blackUserId, -amount, blackRes.rows[0].token_balance, gameId, `Wager lock: ${amount} tokens`]
      );

      await client.query('COMMIT');
      return { success: true };
    } catch (err) {
      await client.query('ROLLBACK');
      console.error(`Wager lock failed for game ${gameId}:`, err.message);
      return { success: false, error: 'Failed to lock wager' };
    } finally {
      client.release();
    }
  }

  /**
   * Settle a wager after game over.
   * - Win: winner gets 2x amount
   * - Draw: both get refunded
   *
   * IDEMPOTENCY: Atomically claims the game by setting wager_status from
   * 'locked' to 'settled'. If the CAS fails (already settled or held),
   * the call is a no-op — prevents double-payout from concurrent paths.
   */
  async settleWager(gameId, winnerUserId, loserUserId, amount, isDraw) {
    if (!amount || amount <= 0) return;

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      // Atomic claim: only proceed if wager_status is currently 'locked'.
      // This is the sole idempotency gate — if two settlement paths race,
      // only the first one will match and proceed; the second sees 0 rows.
      const claim = await client.query(
        "UPDATE games SET wager_status = 'settling' WHERE id = $1 AND wager_status = 'locked' RETURNING id",
        [gameId]
      );
      if (claim.rows.length === 0) {
        await client.query('ROLLBACK');
        console.log(`Wager settlement skipped for game ${gameId}: already settled or held`);
        return;
      }

      if (isDraw) {
        // Refund both players
        const whiteRes = await client.query(
          'UPDATE users SET token_balance = token_balance + $1 WHERE id = $2 RETURNING token_balance',
          [amount, winnerUserId]
        );
        const blackRes = await client.query(
          'UPDATE users SET token_balance = token_balance + $1 WHERE id = $2 RETURNING token_balance',
          [amount, loserUserId]
        );

        await client.query(
          `INSERT INTO ledger (user_id, type, amount, balance_after, reference_type, reference_id, description)
           VALUES ($1, 'wager_refund', $2, $3, 'game', $4, $5)`,
          [winnerUserId, amount, whiteRes.rows[0].token_balance, gameId, `Wager refund (draw): ${amount} tokens`]
        );
        await client.query(
          `INSERT INTO ledger (user_id, type, amount, balance_after, reference_type, reference_id, description)
           VALUES ($1, 'wager_refund', $2, $3, 'game', $4, $5)`,
          [loserUserId, amount, blackRes.rows[0].token_balance, gameId, `Wager refund (draw): ${amount} tokens`]
        );
      } else {
        // Winner gets the full pot (2x amount)
        const winnerRes = await client.query(
          'UPDATE users SET token_balance = token_balance + $1 WHERE id = $2 RETURNING token_balance',
          [amount * 2, winnerUserId]
        );

        await client.query(
          `INSERT INTO ledger (user_id, type, amount, balance_after, reference_type, reference_id, description)
           VALUES ($1, 'wager_win', $2, $3, 'game', $4, $5)`,
          [winnerUserId, amount * 2, winnerRes.rows[0].token_balance, gameId, `Wager win: ${amount * 2} tokens`]
        );
      }

      // Finalize wager status
      await client.query(
        "UPDATE games SET wager_status = 'settled' WHERE id = $1",
        [gameId]
      );

      await client.query('COMMIT');
      console.log(`Wager settled for game ${gameId}: ${isDraw ? 'draw refund' : 'winner paid'}`);
    } catch (err) {
      await client.query('ROLLBACK');
      console.error(`Wager settlement failed for game ${gameId}:`, err.message);
    } finally {
      client.release();
    }
  }
}
