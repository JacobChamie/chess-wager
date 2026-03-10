import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DepositMonitor } from '../../src/crypto/DepositMonitor.js';

// Mock ethers
vi.mock('ethers', () => {
  class JsonRpcProvider {}
  return {
    ethers: {
      JsonRpcProvider,
      formatEther: (val) => (Number(val) / 1e18).toString(),
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

function createMockWalletManager() {
  return {
    getWalletAddresses: vi.fn().mockResolvedValue([]),
  };
}

function createMockPriceService() {
  return {
    getPrice: vi.fn().mockResolvedValue(1), // 1 USD by default
  };
}

describe('DepositMonitor', () => {
  let pool, walletManager, priceService, monitor;

  beforeEach(() => {
    pool = createMockPool();
    walletManager = createMockWalletManager();
    priceService = createMockPriceService();
    monitor = new DepositMonitor(pool, walletManager, priceService);

    // Override providers with mocks
    monitor.ethProvider = {
      getBlockNumber: vi.fn().mockResolvedValue(1000),
      getBlock: vi.fn().mockResolvedValue(null),
      getLogs: vi.fn().mockResolvedValue([]),
      getTransactionReceipt: vi.fn().mockResolvedValue(null),
    };
    monitor.solConnection = {
      getSignaturesForAddress: vi.fn().mockResolvedValue([]),
      getParsedTransaction: vi.fn().mockResolvedValue(null),
    };
  });

  describe('start/stop', () => {
    it('should start and stop polling', () => {
      vi.useFakeTimers();
      monitor.poll = vi.fn();
      monitor.start();
      expect(monitor.intervalHandle).not.toBeNull();
      monitor.stop();
      expect(monitor.intervalHandle).toBeNull();
      vi.useRealTimers();
    });
  });

  describe('_pollEthereum', () => {
    const ethWallet = {
      id: 'wallet-1',
      user_id: 'user-1',
      address: '0xabcdef1234567890abcdef1234567890abcdef12',
      derivation_index: 1,
    };

    beforeEach(() => {
      walletManager.getWalletAddresses.mockResolvedValue([ethWallet]);
      // eth_last_block config
      pool.query.mockImplementation((sql) => {
        if (typeof sql === 'string' && sql.includes('eth_last_block') && sql.includes('SELECT')) {
          return Promise.resolve({ rows: [{ value: '990' }] });
        }
        if (typeof sql === 'string' && sql.includes('SELECT id FROM deposits')) {
          return Promise.resolve({ rows: [] }); // no duplicates
        }
        return Promise.resolve({ rows: [] });
      });
    });

    it('should skip if no wallets exist', async () => {
      walletManager.getWalletAddresses.mockResolvedValue([]);
      await monitor._pollEthereum();
      expect(monitor.ethProvider.getBlockNumber).not.toHaveBeenCalled();
    });

    it('should skip if fromBlock > currentBlock', async () => {
      pool.query.mockImplementation((sql) => {
        if (typeof sql === 'string' && sql.includes('eth_last_block') && sql.includes('SELECT')) {
          return Promise.resolve({ rows: [{ value: '2000' }] });
        }
        return Promise.resolve({ rows: [] });
      });
      await monitor._pollEthereum();
      expect(monitor.ethProvider.getBlock).not.toHaveBeenCalled();
    });

    it('should detect native ETH deposit from block scan', async () => {
      const txValue = BigInt('1000000000000000000'); // 1 ETH
      monitor.ethProvider.getBlock.mockResolvedValue({
        prefetchedTransactions: [
          {
            hash: '0xtxhash123',
            to: ethWallet.address,
            value: txValue,
          },
        ],
      });
      priceService.getPrice.mockResolvedValue(3000); // ETH = $3000

      await monitor._pollEthereum();

      // Should have inserted a deposit
      const insertCall = pool.query.mock.calls.find(
        (call) => typeof call[0] === 'string' && call[0].includes('INSERT INTO deposits')
      );
      expect(insertCall).toBeDefined();
      expect(insertCall[1][4]).toBe('0xtxhash123'); // real tx hash
      expect(insertCall[1][6]).toBeCloseTo(1, 5); // 1 ETH
    });

    it('should detect USDC ERC-20 deposit from logs', async () => {
      const paddedAddr = '0x' + ethWallet.address.slice(2).toLowerCase().padStart(64, '0');
      const amountRaw = BigInt(100 * 10 ** 6); // 100 USDC
      monitor.ethProvider.getLogs.mockResolvedValue([
        {
          transactionHash: '0xusdc_tx_123',
          blockNumber: 995,
          topics: [
            '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
            '0x' + '0'.repeat(64), // from
            paddedAddr, // to
          ],
          data: '0x' + amountRaw.toString(16).padStart(64, '0'),
        },
      ]);

      await monitor._pollEthereum();

      const insertCall = pool.query.mock.calls.find(
        (call) => typeof call[0] === 'string' && call[0].includes('INSERT INTO deposits')
      );
      expect(insertCall).toBeDefined();
      expect(insertCall[1][4]).toBe('0xusdc_tx_123');
      expect(insertCall[1][3]).toBe('USDC_ERC20');
    });

    it('should skip duplicate deposits (tx_hash already exists)', async () => {
      const txValue = BigInt('1000000000000000000');
      monitor.ethProvider.getBlock.mockResolvedValue({
        prefetchedTransactions: [
          { hash: '0xexisting_tx', to: ethWallet.address, value: txValue },
        ],
      });

      pool.query.mockImplementation((sql, params) => {
        if (typeof sql === 'string' && sql.includes('eth_last_block') && sql.includes('SELECT')) {
          return Promise.resolve({ rows: [{ value: '990' }] });
        }
        if (typeof sql === 'string' && sql.includes('SELECT id FROM deposits')) {
          return Promise.resolve({ rows: [{ id: 'existing' }] }); // already exists
        }
        return Promise.resolve({ rows: [] });
      });

      await monitor._pollEthereum();

      const insertCall = pool.query.mock.calls.find(
        (call) => typeof call[0] === 'string' && call[0].includes('INSERT INTO deposits')
      );
      expect(insertCall).toBeUndefined(); // no insert
    });

    it('should update eth_last_block after scanning', async () => {
      await monitor._pollEthereum();

      const updateCall = pool.query.mock.calls.find(
        (call) => typeof call[0] === 'string' && call[0].includes("UPDATE wallet_config") && call[0].includes('eth_last_block')
      );
      expect(updateCall).toBeDefined();
      expect(updateCall[1][0]).toBe('1000');
    });

    it('should handle RPC errors gracefully', async () => {
      monitor.ethProvider.getBlockNumber.mockRejectedValue(new Error('RPC timeout'));
      await expect(monitor._pollEthereum()).rejects.toThrow('RPC timeout');
    });
  });

  describe('_pollSolana', () => {
    const solWallet = {
      id: 'wallet-sol-1',
      user_id: 'user-2',
      address: 'SolWalletAddr123',
      derivation_index: 1,
    };

    beforeEach(() => {
      walletManager.getWalletAddresses.mockResolvedValue([solWallet]);
    });

    it('should skip if no wallets exist', async () => {
      walletManager.getWalletAddresses.mockResolvedValue([]);
      await monitor._pollSolana();
      expect(monitor.solConnection.getSignaturesForAddress).not.toHaveBeenCalled();
    });

    it('should detect native SOL deposit via getSignaturesForAddress', async () => {
      const sig = 'solsig123abc';
      monitor.solConnection.getSignaturesForAddress.mockResolvedValue([
        { signature: sig, err: null },
      ]);

      // Return a parsed transaction with SOL transfer to our wallet
      monitor.solConnection.getParsedTransaction.mockResolvedValue({
        transaction: {
          message: {
            accountKeys: [
              { pubkey: { toBase58: () => 'SenderAddr' } },
              { pubkey: { toBase58: () => solWallet.address } },
            ],
          },
        },
        meta: {
          preBalances: [5000000000, 0], // sender had 5 SOL, receiver had 0
          postBalances: [3900000000, 1000000000], // receiver got 1 SOL
          preTokenBalances: [],
          postTokenBalances: [],
        },
      });

      pool.query.mockImplementation((sql, params) => {
        if (typeof sql === 'string' && sql.includes('wallet_config') && sql.includes('SELECT')) {
          return Promise.resolve({ rows: [] }); // no last signature
        }
        if (typeof sql === 'string' && sql.includes('SELECT id FROM deposits')) {
          return Promise.resolve({ rows: [] }); // no duplicates
        }
        return Promise.resolve({ rows: [] });
      });

      priceService.getPrice.mockResolvedValue(150); // SOL = $150

      await monitor._pollSolana();

      const insertCall = pool.query.mock.calls.find(
        (call) => typeof call[0] === 'string' && call[0].includes('INSERT INTO deposits')
      );
      expect(insertCall).toBeDefined();
      expect(insertCall[1][4]).toBe(sig); // real signature as tx_hash
      expect(insertCall[1][3]).toBe('SOL');
      expect(insertCall[1][6]).toBeCloseTo(1, 5); // 1 SOL
    });

    it('should skip failed transactions', async () => {
      monitor.solConnection.getSignaturesForAddress.mockResolvedValue([
        { signature: 'failedsig', err: { InstructionError: 'some error' } },
      ]);

      pool.query.mockImplementation((sql) => {
        if (typeof sql === 'string' && sql.includes('wallet_config') && sql.includes('SELECT')) {
          return Promise.resolve({ rows: [] });
        }
        return Promise.resolve({ rows: [] });
      });

      await monitor._pollSolana();

      expect(monitor.solConnection.getParsedTransaction).not.toHaveBeenCalled();
    });

    it('should update last processed signature after scan', async () => {
      const sig = 'newest_sig_abc';
      monitor.solConnection.getSignaturesForAddress.mockResolvedValue([
        { signature: sig, err: null },
      ]);
      monitor.solConnection.getParsedTransaction.mockResolvedValue({
        transaction: { message: { accountKeys: [] } },
        meta: { preBalances: [], postBalances: [], preTokenBalances: [], postTokenBalances: [] },
      });

      pool.query.mockImplementation((sql) => {
        if (typeof sql === 'string' && sql.includes('wallet_config') && sql.includes('SELECT')) {
          return Promise.resolve({ rows: [] });
        }
        return Promise.resolve({ rows: [] });
      });

      await monitor._pollSolana();

      const upsertCall = pool.query.mock.calls.find(
        (call) => typeof call[0] === 'string' && call[0].includes('INSERT INTO wallet_config') && call[0].includes('ON CONFLICT')
      );
      expect(upsertCall).toBeDefined();
      expect(upsertCall[1][0]).toBe(`sol_last_sig_${solWallet.address}`);
      expect(upsertCall[1][1]).toBe(sig);
    });

    it('should pass until option when last signature exists', async () => {
      const lastSig = 'previous_sig_xyz';
      pool.query.mockImplementation((sql, params) => {
        if (typeof sql === 'string' && sql.includes('wallet_config') && sql.includes('SELECT')) {
          return Promise.resolve({ rows: [{ value: lastSig }] });
        }
        return Promise.resolve({ rows: [] });
      });

      monitor.solConnection.getSignaturesForAddress.mockResolvedValue([]);

      await monitor._pollSolana();

      const callArgs = monitor.solConnection.getSignaturesForAddress.mock.calls[0];
      expect(callArgs[1]).toEqual({ limit: 100, until: lastSig });
    });

    it('should detect USDC SPL deposit', async () => {
      const sig = 'usdc_spl_sig';
      monitor.solConnection.getSignaturesForAddress.mockResolvedValue([
        { signature: sig, err: null },
      ]);

      monitor.solConnection.getParsedTransaction.mockResolvedValue({
        transaction: {
          message: {
            accountKeys: [
              { pubkey: { toBase58: () => 'SenderAddr' } },
              { pubkey: { toBase58: () => solWallet.address } },
            ],
          },
        },
        meta: {
          preBalances: [5000000000, 0],
          postBalances: [5000000000, 0], // no native SOL change
          preTokenBalances: [],
          postTokenBalances: [
            {
              accountIndex: 1,
              mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
              owner: solWallet.address,
              uiTokenAmount: { uiAmountString: '50.0' },
            },
          ],
        },
      });

      pool.query.mockImplementation((sql) => {
        if (typeof sql === 'string' && sql.includes('wallet_config') && sql.includes('SELECT')) {
          return Promise.resolve({ rows: [] });
        }
        if (typeof sql === 'string' && sql.includes('SELECT id FROM deposits')) {
          return Promise.resolve({ rows: [] });
        }
        return Promise.resolve({ rows: [] });
      });

      await monitor._pollSolana();

      const insertCall = pool.query.mock.calls.find(
        (call) => typeof call[0] === 'string' && call[0].includes('INSERT INTO deposits')
      );
      expect(insertCall).toBeDefined();
      expect(insertCall[1][3]).toBe('USDC_SPL');
      expect(insertCall[1][4]).toBe(`${sig}_usdc`);
      expect(insertCall[1][6]).toBeCloseTo(50, 1);
    });

    it('should handle RPC errors gracefully', async () => {
      monitor.solConnection.getSignaturesForAddress.mockRejectedValue(new Error('SOL RPC error'));

      pool.query.mockImplementation((sql) => {
        if (typeof sql === 'string' && sql.includes('wallet_config') && sql.includes('SELECT')) {
          return Promise.resolve({ rows: [] });
        }
        return Promise.resolve({ rows: [] });
      });

      // Should not throw — errors are caught per-wallet
      await monitor._pollSolana();
    });
  });

  describe('_processConfirmations', () => {
    it('should credit deposit when confirmations reach threshold', async () => {
      const deposit = {
        id: 'dep-1',
        user_id: 'user-1',
        chain: 'ethereum',
        tx_hash: '0xrealtxhash',
        confirmations: 5,
        required_confs: 12,
        status: 'pending',
        tokens_credited: 100,
        amount_decimal: '0.05',
        asset: 'ETH',
      };

      pool.query.mockImplementation((sql) => {
        if (typeof sql === 'string' && sql.includes("status IN ('pending', 'confirmed')") && sql.includes('SELECT')) {
          return Promise.resolve({ rows: [deposit] });
        }
        return Promise.resolve({ rows: [] });
      });

      monitor.ethProvider.getTransactionReceipt.mockResolvedValue({
        blockNumber: 980,
      });
      monitor.ethProvider.getBlockNumber.mockResolvedValue(1000);

      // Mock the client for _creditDeposit
      const client = pool._client;
      client.query
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({ rows: [{ id: 'dep-1' }] }) // UPDATE deposits (claim)
        .mockResolvedValueOnce({ rows: [{ token_balance: '200' }] }) // UPDATE users
        .mockResolvedValueOnce({}) // INSERT ledger
        .mockResolvedValueOnce({}); // COMMIT

      await monitor._processConfirmations();

      // Should have called getTransactionReceipt
      expect(monitor.ethProvider.getTransactionReceipt).toHaveBeenCalledWith('0xrealtxhash');
    });

    it('should update confirmation count without crediting if below threshold', async () => {
      const deposit = {
        id: 'dep-2',
        user_id: 'user-1',
        chain: 'ethereum',
        tx_hash: '0xrealtx2',
        confirmations: 3,
        required_confs: 12,
        status: 'pending',
      };

      pool.query.mockImplementation((sql) => {
        if (typeof sql === 'string' && sql.includes("status IN ('pending', 'confirmed')") && sql.includes('SELECT')) {
          return Promise.resolve({ rows: [deposit] });
        }
        return Promise.resolve({ rows: [] });
      });

      monitor.ethProvider.getTransactionReceipt.mockResolvedValue({ blockNumber: 995 });
      monitor.ethProvider.getBlockNumber.mockResolvedValue(1000); // 5 confs < 12 required

      await monitor._processConfirmations();

      // Should update confirmations but not credit
      const updateCall = pool.query.mock.calls.find(
        (call) => typeof call[0] === 'string' && call[0].includes("status = 'confirmed'") && call[1]?.[0] === 5
      );
      expect(updateCall).toBeDefined();
    });

    it('should not double-credit an already credited deposit', async () => {
      const deposit = {
        id: 'dep-3',
        user_id: 'user-1',
        chain: 'solana',
        tx_hash: 'solsig456',
        confirmations: 32,
        required_confs: 32,
        status: 'confirmed',
        tokens_credited: 50,
        amount_decimal: '1.0',
        asset: 'SOL',
      };

      pool.query.mockImplementation((sql) => {
        if (typeof sql === 'string' && sql.includes("status IN ('pending', 'confirmed')") && sql.includes('SELECT')) {
          return Promise.resolve({ rows: [deposit] });
        }
        return Promise.resolve({ rows: [] });
      });

      // Simulate the atomic claim failing (already credited)
      const client = pool._client;
      client.query
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({ rows: [] }) // claim returns 0 rows — already credited
        .mockResolvedValueOnce({}); // ROLLBACK

      await monitor._processConfirmations();

      // Should NOT have done a balance update
      const balUpdate = client.query.mock.calls.find(
        (call) => typeof call[0] === 'string' && call[0].includes('UPDATE users')
      );
      expect(balUpdate).toBeUndefined();
    });
  });

  describe('_recordDeposit', () => {
    it('should immediately credit if confirmations >= requiredConfs', async () => {
      pool.query.mockImplementation((sql) => {
        if (typeof sql === 'string' && sql.includes('SELECT id FROM deposits')) {
          return Promise.resolve({ rows: [] }); // no duplicate
        }
        if (typeof sql === 'string' && sql.includes('INSERT INTO deposits')) {
          return Promise.resolve({ rows: [] });
        }
        if (typeof sql === 'string' && sql.includes('SELECT * FROM deposits WHERE tx_hash')) {
          return Promise.resolve({
            rows: [{ id: 'dep-new', user_id: 'u1', tokens_credited: 100, amount_decimal: 1, asset: 'ETH' }],
          });
        }
        return Promise.resolve({ rows: [] });
      });

      const client = pool._client;
      client.query
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({ rows: [{ id: 'dep-new' }] }) // claim
        .mockResolvedValueOnce({ rows: [{ token_balance: '100' }] }) // balance update
        .mockResolvedValueOnce({}) // ledger
        .mockResolvedValueOnce({}); // COMMIT

      priceService.getPrice.mockResolvedValue(100);

      await monitor._recordDeposit({
        userId: 'u1',
        walletId: 'w1',
        chain: 'ethereum',
        asset: 'ETH',
        txHash: '0xnewtx',
        amountRaw: '1000000000000000000',
        amountDecimal: 1,
        confirmations: 15,
        requiredConfs: 12,
      });

      // Should have inserted deposit AND credited
      const insertCall = pool.query.mock.calls.find(
        (call) => typeof call[0] === 'string' && call[0].includes('INSERT INTO deposits')
      );
      expect(insertCall).toBeDefined();

      // Should have started credit flow
      expect(pool.connect).toHaveBeenCalled();
    });
  });
});
