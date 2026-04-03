import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WagerService } from '../../src/wager/WagerService.js';

function createMockClient() {
  const client = {
    query: vi.fn(),
  };
  return client;
}

function createMockPool(client) {
  return {
    connect: vi.fn().mockResolvedValue({
      query: client.query,
      release: vi.fn(),
    }),
    query: vi.fn(),
  };
}

describe('WagerService', () => {
  let pool;
  let client;
  let wagerService;

  beforeEach(() => {
    client = createMockClient();
    pool = createMockPool(client);
    wagerService = new WagerService(pool);
  });

  describe('lockWager', () => {
    it('should return success:true when amount is 0', async () => {
      const result = await wagerService.lockWager('game1', 'user1', 'user2', 0);
      expect(result.success).toBe(true);
      expect(pool.connect).not.toHaveBeenCalled();
    });

    it('should return error when a user ID is missing', async () => {
      const result = await wagerService.lockWager('game1', null, 'user2', 10);
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/registered/);
    });

    it('should deduct from both players on successful lock', async () => {
      // Mock: BEGIN, SELECT FOR UPDATE (lock rows), white deduct, black deduct, white ledger, black ledger, COMMIT
      client.query
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({ rows: [
          { id: 'blackUser', token_balance: '50' },
          { id: 'whiteUser', token_balance: '100' },
        ] }) // SELECT FOR UPDATE
        .mockResolvedValueOnce({ rows: [{ token_balance: '90' }] }) // white deduct
        .mockResolvedValueOnce({ rows: [{ token_balance: '40' }] }) // black deduct
        .mockResolvedValueOnce({}) // white ledger
        .mockResolvedValueOnce({}) // black ledger
        .mockResolvedValueOnce({}); // COMMIT

      const result = await wagerService.lockWager('game1', 'whiteUser', 'blackUser', 10);
      expect(result.success).toBe(true);

      // Verify SELECT FOR UPDATE was called
      const lockCall = client.query.mock.calls[1];
      expect(lockCall[0]).toContain('FOR UPDATE');
    });

    it('should rollback if white player has insufficient balance', async () => {
      client.query
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({ rows: [
          { id: 'blackUser', token_balance: '50' },
          { id: 'whiteUser', token_balance: '5' },
        ] }) // SELECT FOR UPDATE — white only has 5
        .mockResolvedValueOnce({}); // ROLLBACK

      const result = await wagerService.lockWager('game1', 'whiteUser', 'blackUser', 10);
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/White player/i);
    });

    it('should rollback if black player has insufficient balance', async () => {
      client.query
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({ rows: [
          { id: 'blackUser', token_balance: '3' },
          { id: 'whiteUser', token_balance: '100' },
        ] }) // SELECT FOR UPDATE — black only has 3
        .mockResolvedValueOnce({}); // ROLLBACK

      const result = await wagerService.lockWager('game1', 'whiteUser', 'blackUser', 10);
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/Black player/i);
    });

    it('should rollback on database error', async () => {
      client.query
        .mockResolvedValueOnce({}) // BEGIN
        .mockRejectedValueOnce(new Error('DB error')); // SELECT FOR UPDATE throws

      const result = await wagerService.lockWager('game1', 'whiteUser', 'blackUser', 10);
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/Failed/);
    });
  });

  describe('settleWager', () => {
    it('should do nothing when amount is 0', async () => {
      await wagerService.settleWager('game1', 'winner', 'loser', 0, false);
      expect(pool.connect).not.toHaveBeenCalled();
    });

    it('should credit winner with 2x amount on win', async () => {
      client.query
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({ rows: [{ id: 'game1' }] }) // CAS claim (wager_status locked -> settling)
        .mockResolvedValueOnce({ rows: [{ token_balance: '120' }] }) // winner credit
        .mockResolvedValueOnce({}) // winner ledger
        .mockResolvedValueOnce({}) // update game wager_status -> settled
        .mockResolvedValueOnce({}); // COMMIT

      await wagerService.settleWager('game1', 'winnerId', 'loserId', 10, false);

      // CAS claim should check wager_status = 'locked'
      const casCall = client.query.mock.calls[1];
      expect(casCall[0]).toContain("wager_status = 'settling'");
      expect(casCall[0]).toContain("wager_status = 'locked'");

      // Winner credit should be 2x (20)
      const creditCall = client.query.mock.calls[2];
      expect(creditCall[0]).toContain('token_balance + $1');
      expect(creditCall[1][0]).toBe(20);
    });

    it('should be idempotent — skip if already settled', async () => {
      client.query
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({ rows: [] }) // CAS claim fails (already settled)
        .mockResolvedValueOnce({}); // ROLLBACK

      await wagerService.settleWager('game1', 'winnerId', 'loserId', 10, false);

      // Should not proceed to credit — only BEGIN, CAS, ROLLBACK
      expect(client.query).toHaveBeenCalledTimes(3);
    });

    it('should refund both players on draw', async () => {
      client.query
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({ rows: [{ id: 'game1' }] }) // CAS claim
        .mockResolvedValueOnce({ rows: [{ token_balance: '110' }] }) // white refund
        .mockResolvedValueOnce({ rows: [{ token_balance: '60' }] }) // black refund
        .mockResolvedValueOnce({}) // white ledger
        .mockResolvedValueOnce({}) // black ledger
        .mockResolvedValueOnce({}) // update game wager_status -> settled
        .mockResolvedValueOnce({}); // COMMIT

      await wagerService.settleWager('game1', 'whiteId', 'blackId', 10, true);

      // Both should get their 10 tokens back
      const whiteRefund = client.query.mock.calls[2];
      expect(whiteRefund[1][0]).toBe(10);
      const blackRefund = client.query.mock.calls[3];
      expect(blackRefund[1][0]).toBe(10);
    });

    it('should rollback on error and not throw', async () => {
      client.query
        .mockResolvedValueOnce({}) // BEGIN
        .mockRejectedValueOnce(new Error('DB error')); // CAS throws

      await expect(
        wagerService.settleWager('game1', 'winnerId', 'loserId', 10, false)
      ).resolves.toBeUndefined();
    });
  });
});
