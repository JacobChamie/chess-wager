/**
 * Handles wager escrow for chess games.
 * - lockWager: deducts tokens from both players at game start
 * - settleWager: credits winner (2x) or refunds both on draw
 */
export class WagerService {
  constructor(pool) {
    this.pool = pool;
  }

  /**
   * Lock wager tokens from both players at game start.
   * Uses a DB transaction to ensure atomicity.
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

      // Deduct from white
      const whiteRes = await client.query(
        'UPDATE users SET token_balance = token_balance - $1 WHERE id = $2 AND token_balance >= $1 RETURNING token_balance',
        [amount, whiteUserId]
      );
      if (!whiteRes.rows[0]) {
        await client.query('ROLLBACK');
        return { success: false, error: 'White player has insufficient balance' };
      }

      // Deduct from black
      const blackRes = await client.query(
        'UPDATE users SET token_balance = token_balance - $1 WHERE id = $2 AND token_balance >= $1 RETURNING token_balance',
        [amount, blackUserId]
      );
      if (!blackRes.rows[0]) {
        await client.query('ROLLBACK');
        return { success: false, error: 'Black player has insufficient balance' };
      }

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
   */
  async settleWager(gameId, winnerUserId, loserUserId, amount, isDraw) {
    if (!amount || amount <= 0) return;

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      if (isDraw) {
        // Refund both players
        const whiteRes = await client.query(
          'UPDATE users SET token_balance = token_balance + $1 WHERE id = $2 RETURNING token_balance',
          [amount, winnerUserId] // in draw case, winnerUserId is white
        );
        const blackRes = await client.query(
          'UPDATE users SET token_balance = token_balance + $1 WHERE id = $2 RETURNING token_balance',
          [amount, loserUserId] // in draw case, loserUserId is black
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

      // Update game wager status
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
