import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WalletManager } from '../../src/crypto/WalletManager.js';

// Use a known test mnemonic (DO NOT use in production!)
const TEST_MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

describe('WalletManager', () => {
  let pool;
  let walletManager;

  beforeEach(() => {
    process.env.WALLET_MNEMONIC = TEST_MNEMONIC;
    pool = {
      query: vi.fn(),
      connect: vi.fn(),
    };
    walletManager = new WalletManager(pool);
  });

  describe('deriveEthWallet', () => {
    it('should derive a valid Ethereum address at index 0', () => {
      const wallet = walletManager.deriveEthWallet(0);
      expect(wallet.address).toBeDefined();
      expect(wallet.address).toMatch(/^0x[0-9a-fA-F]{40}$/);
      expect(wallet.privateKey).toBeDefined();
    });

    it('should derive different addresses for different indices', () => {
      const w0 = walletManager.deriveEthWallet(0);
      const w1 = walletManager.deriveEthWallet(1);
      const w2 = walletManager.deriveEthWallet(2);

      expect(w0.address).not.toBe(w1.address);
      expect(w1.address).not.toBe(w2.address);
      expect(w0.address).not.toBe(w2.address);
    });

    it('should derive deterministic addresses (same index = same address)', () => {
      const a1 = walletManager.deriveEthWallet(5);
      const a2 = walletManager.deriveEthWallet(5);
      expect(a1.address).toBe(a2.address);
      expect(a1.privateKey).toBe(a2.privateKey);
    });
  });

  describe('deriveSolKeypair', () => {
    it('should derive a valid Solana address at index 0', () => {
      const result = walletManager.deriveSolKeypair(0);
      expect(result.address).toBeDefined();
      // Solana addresses are base58 encoded, 32-44 chars
      expect(result.address.length).toBeGreaterThanOrEqual(32);
      expect(result.address.length).toBeLessThanOrEqual(44);
      expect(result.keypair).toBeDefined();
    });

    it('should derive different addresses for different indices', () => {
      const k0 = walletManager.deriveSolKeypair(0);
      const k1 = walletManager.deriveSolKeypair(1);
      expect(k0.address).not.toBe(k1.address);
    });

    it('should derive deterministic addresses', () => {
      const a1 = walletManager.deriveSolKeypair(3);
      const a2 = walletManager.deriveSolKeypair(3);
      expect(a1.address).toBe(a2.address);
    });
  });

  describe('createDepositAddress', () => {
    it('should return existing address if user already has one', async () => {
      pool.query.mockResolvedValueOnce({
        rows: [{ address: '0xexisting' }],
      });

      const addr = await walletManager.createDepositAddress('user1', 'ethereum');
      expect(addr).toBe('0xexisting');
      expect(pool.connect).not.toHaveBeenCalled(); // no transaction needed
    });

    it('should create new address if user has none', async () => {
      // First query: check existing → none
      pool.query.mockResolvedValueOnce({ rows: [] });

      const mockClient = {
        query: vi.fn()
          .mockResolvedValueOnce({}) // BEGIN
          .mockResolvedValueOnce({ rows: [{ value: '1' }] }) // increment index
          .mockResolvedValueOnce({}) // INSERT wallet
          .mockResolvedValueOnce({}), // COMMIT
        release: vi.fn(),
      };
      pool.connect.mockResolvedValueOnce(mockClient);

      const addr = await walletManager.createDepositAddress('user1', 'ethereum');
      expect(addr).toBeDefined();
      expect(addr).toMatch(/^0x[0-9a-fA-F]{40}$/);
      expect(mockClient.query).toHaveBeenCalledTimes(4);
      expect(mockClient.release).toHaveBeenCalled();
    });

    it('should throw for unsupported chain', async () => {
      await expect(
        walletManager.createDepositAddress('user1', 'bitcoin')
      ).rejects.toThrow('Unsupported chain');
    });

    it('should rollback on error', async () => {
      pool.query.mockResolvedValueOnce({ rows: [] }); // no existing

      const mockClient = {
        query: vi.fn()
          .mockResolvedValueOnce({}) // BEGIN
          .mockRejectedValueOnce(new Error('DB error')), // increment fails
        release: vi.fn(),
      };
      pool.connect.mockResolvedValueOnce(mockClient);

      await expect(
        walletManager.createDepositAddress('user1', 'ethereum')
      ).rejects.toThrow('DB error');
      expect(mockClient.release).toHaveBeenCalled();
    });
  });

  describe('getMainEthWallet', () => {
    it('should return the index 0 wallet', () => {
      const main = walletManager.getMainEthWallet();
      const explicit = walletManager.deriveEthWallet(0);
      expect(main.address).toBe(explicit.address);
    });
  });

  describe('getMainSolKeypair', () => {
    it('should return the index 0 keypair', () => {
      const main = walletManager.getMainSolKeypair();
      const explicit = walletManager.deriveSolKeypair(0);
      expect(main.address).toBe(explicit.address);
    });
  });

  describe('getWalletAddresses', () => {
    it('should query wallets by chain', async () => {
      pool.query.mockResolvedValueOnce({
        rows: [
          { id: 'w1', user_id: 'u1', address: '0xabc', derivation_index: 1 },
          { id: 'w2', user_id: 'u2', address: '0xdef', derivation_index: 2 },
        ],
      });

      const wallets = await walletManager.getWalletAddresses('ethereum');
      expect(wallets).toHaveLength(2);
      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('WHERE chain'),
        ['ethereum']
      );
    });
  });
});
