import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WithdrawalProcessor } from '../../src/crypto/WithdrawalProcessor.js';

// Mock ethers
vi.mock('ethers', () => {
  class JsonRpcProvider {}
  class Wallet {
    constructor() {
      this.sendTransaction = vi.fn().mockResolvedValue({
        hash: '0xeth_tx_hash',
        wait: vi.fn().mockResolvedValue({}),
      });
    }
  }
  class Contract {
    constructor() {
      this.transfer = vi.fn().mockResolvedValue({
        hash: '0xusdc_tx_hash',
        wait: vi.fn().mockResolvedValue({}),
      });
    }
  }
  return {
    ethers: {
      JsonRpcProvider,
      Wallet,
      Contract,
      parseEther: (val) => BigInt(Math.round(parseFloat(val) * 1e18)),
    },
  };
});

// Mock @solana/web3.js
vi.mock('@solana/web3.js', () => ({
  Connection: class Connection {},
  PublicKey: class PublicKey {
    constructor(addr) { this._addr = addr; }
    toBase58() { return this._addr; }
    toString() { return this._addr; }
  },
  SystemProgram: { transfer: vi.fn().mockReturnValue({}) },
  Transaction: class Transaction {
    add() { return this; }
  },
  sendAndConfirmTransaction: vi.fn().mockResolvedValue('sol_tx_sig_123'),
}));

function createMockPool() {
  const client = {
    query: vi.fn().mockResolvedValue({ rows: [] }),
    release: vi.fn(),
  };
  return {
    query: vi.fn().mockResolvedValue({ rows: [] }),
    connect: vi.fn().mockResolvedValue(client),
    _client: client,
  };
}

describe('WithdrawalProcessor', () => {
  let pool, walletManager, priceService, processor;

  beforeEach(() => {
    pool = createMockPool();
    walletManager = {
      getMainEthWallet: vi.fn().mockReturnValue({ privateKey: '0xprivkey' }),
      getMainSolKeypair: vi.fn().mockReturnValue({
        keypair: { publicKey: { toBase58: () => 'MainSolAddr' } },
      }),
    };
    priceService = {
      getPrice: vi.fn().mockResolvedValue(1),
    };
    processor = new WithdrawalProcessor(pool, walletManager, priceService);
  });

  describe('start/stop', () => {
    it('should start and stop polling', () => {
      vi.useFakeTimers();
      processor.start();
      expect(processor.intervalHandle).not.toBeNull();
      processor.stop();
      expect(processor.intervalHandle).toBeNull();
      vi.useRealTimers();
    });
  });

  describe('poll', () => {
    it('should process pending withdrawals', async () => {
      const withdrawal = {
        id: 'w-1',
        user_id: 'user-1',
        chain: 'ethereum',
        asset: 'ETH',
        to_address: '0x1234567890123456789012345678901234567890',
        amount_tokens: 100,
        amount_crypto: 0.05,
      };

      pool.query.mockResolvedValueOnce({ rows: [withdrawal] }); // SELECT pending
      pool.query.mockResolvedValue({ rows: [] }); // subsequent updates

      await processor.poll();

      // Should have set status to processing
      const processingCall = pool.query.mock.calls.find(
        (call) => typeof call[0] === 'string' && call[0].includes("status = 'processing'")
      );
      expect(processingCall).toBeDefined();
    });

    it('should skip if already processing', async () => {
      processor.processing = true;
      await processor.poll();
      expect(pool.query).not.toHaveBeenCalled();
    });

    it('should reset processing flag after completion', async () => {
      pool.query.mockResolvedValue({ rows: [] });
      await processor.poll();
      expect(processor.processing).toBe(false);
    });

    it('should reset processing flag even after errors', async () => {
      pool.query.mockRejectedValueOnce(new Error('DB error'));
      await processor.poll();
      expect(processor.processing).toBe(false);
    });
  });

  describe('_processWithdrawal', () => {
    it('should process ETH withdrawal and update status to sent', async () => {
      const withdrawal = {
        id: 'w-2',
        user_id: 'user-1',
        chain: 'ethereum',
        asset: 'ETH',
        to_address: '0x1234567890123456789012345678901234567890',
        amount_tokens: 100,
        amount_crypto: 0.05,
      };

      pool.query.mockResolvedValue({ rows: [] });

      await processor._processWithdrawal(withdrawal);

      // Should set status to processing
      const procCall = pool.query.mock.calls.find(
        (call) => typeof call[0] === 'string' && call[0].includes("status = 'processing'")
      );
      expect(procCall).toBeDefined();
      expect(procCall[1][0]).toBe('w-2');

      // Should set status to sent with tx hash
      const sentCall = pool.query.mock.calls.find(
        (call) => typeof call[0] === 'string' && call[0].includes("status = 'sent'")
      );
      expect(sentCall).toBeDefined();
    });

    it('should process SOL withdrawal', async () => {
      const withdrawal = {
        id: 'w-3',
        user_id: 'user-2',
        chain: 'solana',
        asset: 'SOL',
        to_address: 'SolDestAddr',
        amount_tokens: 50,
        amount_crypto: 1.5,
      };

      pool.query.mockResolvedValue({ rows: [] });

      await processor._processWithdrawal(withdrawal);

      const sentCall = pool.query.mock.calls.find(
        (call) => typeof call[0] === 'string' && call[0].includes("status = 'sent'")
      );
      expect(sentCall).toBeDefined();
    });

    it('should refund on send failure', async () => {
      const withdrawal = {
        id: 'w-4',
        user_id: 'user-1',
        chain: 'ethereum',
        asset: 'ETH',
        to_address: '0x1234567890123456789012345678901234567890',
        amount_tokens: 100,
        amount_crypto: 0.05,
      };

      // Override _sendEth to throw
      processor._sendEth = vi.fn().mockRejectedValue(new Error('insufficient funds'));

      pool.query.mockResolvedValue({ rows: [] });

      // Mock the refund client
      const client = pool._client;
      client.query
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({ rows: [{ token_balance: '200' }] }) // refund balance
        .mockResolvedValueOnce({}) // ledger entry
        .mockResolvedValueOnce({}) // mark failed
        .mockResolvedValueOnce({}); // COMMIT

      await processor._processWithdrawal(withdrawal);

      // Should have called refund (pool.connect for transaction)
      expect(pool.connect).toHaveBeenCalled();

      // Should have inserted ledger entry with refund description
      const ledgerCall = client.query.mock.calls.find(
        (call) => typeof call[0] === 'string' && call[0].includes('INSERT INTO ledger')
      );
      expect(ledgerCall).toBeDefined();
    });
  });

  describe('_refundWithdrawal', () => {
    it('should refund tokens to user and mark withdrawal as failed', async () => {
      const withdrawal = {
        id: 'w-5',
        user_id: 'user-3',
        amount_tokens: 75,
      };

      const client = pool._client;
      client.query
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({ rows: [{ token_balance: '175' }] }) // balance update
        .mockResolvedValueOnce({}) // ledger entry
        .mockResolvedValueOnce({}) // mark failed
        .mockResolvedValueOnce({}); // COMMIT

      await processor._refundWithdrawal(withdrawal, 'Gas too low');

      // Check balance was refunded
      const balCall = client.query.mock.calls.find(
        (call) => typeof call[0] === 'string' && call[0].includes('UPDATE users SET token_balance')
      );
      expect(balCall).toBeDefined();
      expect(balCall[1][0]).toBe(75);

      // Check withdrawal marked as failed
      const failCall = client.query.mock.calls.find(
        (call) => typeof call[0] === 'string' && call[0].includes("status = 'failed'")
      );
      expect(failCall).toBeDefined();
      expect(failCall[1][0]).toBe('Gas too low');
    });

    it('should rollback on refund failure', async () => {
      const withdrawal = {
        id: 'w-6',
        user_id: 'user-4',
        amount_tokens: 50,
      };

      const client = pool._client;
      client.query
        .mockResolvedValueOnce({}) // BEGIN
        .mockRejectedValueOnce(new Error('DB connection lost')); // balance update fails

      await processor._refundWithdrawal(withdrawal, 'Original error');

      // Should have rolled back
      const rollbackCall = client.query.mock.calls.find(
        (call) => call[0] === 'ROLLBACK'
      );
      expect(rollbackCall).toBeDefined();

      // Should have released the client
      expect(client.release).toHaveBeenCalled();
    });
  });
});
