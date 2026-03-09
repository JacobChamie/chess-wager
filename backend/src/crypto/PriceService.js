import { COINGECKO_API, PRICE_CACHE_TTL } from './constants.js';

export class PriceService {
  constructor() {
    this.cache = new Map(); // asset -> { price, timestamp }
  }

  /**
   * Get current USD price for an asset.
   * USDC is always $1. ETH and SOL fetched from CoinGecko with 60s cache.
   */
  async getPrice(asset) {
    // USDC is pegged
    if (asset === 'USDC' || asset === 'USDC_ERC20' || asset === 'USDC_SPL') {
      return 1.0;
    }

    const cached = this.cache.get(asset);
    if (cached && Date.now() - cached.timestamp < PRICE_CACHE_TTL) {
      return cached.price;
    }

    const coinId = asset === 'ETH' ? 'ethereum' : asset === 'SOL' ? 'solana' : null;
    if (!coinId) throw new Error(`Unknown asset: ${asset}`);

    try {
      const res = await fetch(
        `${COINGECKO_API}/simple/price?ids=${coinId}&vs_currencies=usd`
      );
      if (!res.ok) throw new Error(`CoinGecko API error: ${res.status}`);
      const data = await res.json();
      const price = data[coinId]?.usd;
      if (!price) throw new Error(`No price data for ${coinId}`);

      this.cache.set(asset, { price, timestamp: Date.now() });
      return price;
    } catch (err) {
      // Fall back to cached price if available (even if stale)
      if (cached) {
        console.warn(`CoinGecko fetch failed for ${asset}, using stale cache: ${err.message}`);
        return cached.price;
      }
      throw err;
    }
  }

  /**
   * Get all prices at once (for the /prices endpoint).
   */
  async getAllPrices() {
    const [eth, sol] = await Promise.all([
      this.getPrice('ETH'),
      this.getPrice('SOL'),
    ]);
    return { ETH: eth, SOL: sol, USDC: 1.0 };
  }
}
