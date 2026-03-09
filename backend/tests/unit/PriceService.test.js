import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PriceService } from '../../src/crypto/PriceService.js';

describe('PriceService', () => {
  let priceService;
  let originalFetch;

  beforeEach(() => {
    priceService = new PriceService();
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  describe('getPrice', () => {
    it('should return 1.0 for USDC', async () => {
      expect(await priceService.getPrice('USDC')).toBe(1.0);
      expect(await priceService.getPrice('USDC_ERC20')).toBe(1.0);
      expect(await priceService.getPrice('USDC_SPL')).toBe(1.0);
    });

    it('should fetch ETH price from CoinGecko', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ ethereum: { usd: 3500.42 } }),
      });

      const price = await priceService.getPrice('ETH');
      expect(price).toBe(3500.42);
      expect(global.fetch).toHaveBeenCalledTimes(1);
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('ethereum')
      );
    });

    it('should fetch SOL price from CoinGecko', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ solana: { usd: 145.67 } }),
      });

      const price = await priceService.getPrice('SOL');
      expect(price).toBe(145.67);
    });

    it('should use cached price within TTL', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ ethereum: { usd: 3500 } }),
      });

      // First call hits API
      await priceService.getPrice('ETH');
      expect(global.fetch).toHaveBeenCalledTimes(1);

      // Second call uses cache
      const price2 = await priceService.getPrice('ETH');
      expect(price2).toBe(3500);
      expect(global.fetch).toHaveBeenCalledTimes(1); // still 1
    });

    it('should fall back to stale cache on API failure', async () => {
      // Seed the cache
      priceService.cache.set('ETH', { price: 3000, timestamp: Date.now() - 120_000 }); // stale

      global.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

      const price = await priceService.getPrice('ETH');
      expect(price).toBe(3000); // stale cache
    });

    it('should throw for unknown asset with no cache', async () => {
      await expect(priceService.getPrice('UNKNOWN')).rejects.toThrow('Unknown asset');
    });

    it('should throw on API error with no stale cache', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 429,
      });

      await expect(priceService.getPrice('ETH')).rejects.toThrow('CoinGecko API error');
    });
  });

  describe('getAllPrices', () => {
    it('should return prices for ETH, SOL, and USDC', async () => {
      global.fetch = vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ ethereum: { usd: 3500 } }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ solana: { usd: 150 } }),
        });

      const prices = await priceService.getAllPrices();
      expect(prices).toEqual({ ETH: 3500, SOL: 150, USDC: 1.0 });
    });
  });
});
