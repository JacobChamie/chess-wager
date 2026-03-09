// Chain configurations for crypto deposit/withdrawal system

export const CHAINS = {
  ethereum: {
    name: 'ethereum',
    nativeAsset: 'ETH',
    usdcAsset: 'USDC_ERC20',
    rpcUrl: process.env.ETH_RPC_URL || 'https://eth-mainnet.g.alchemy.com/v2/demo',
    // USDC ERC-20 contract on Ethereum mainnet
    usdcContract: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    usdcDecimals: 6,
    nativeDecimals: 18,
    requiredConfirmations: 12,
    // BIP-44 derivation path for Ethereum
    derivationPath: "m/44'/60'/0'/0",
  },
  solana: {
    name: 'solana',
    nativeAsset: 'SOL',
    usdcAsset: 'USDC_SPL',
    rpcUrl: process.env.SOL_RPC_URL || 'https://api.mainnet-beta.solana.com',
    // USDC SPL token mint on Solana mainnet
    usdcMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    usdcDecimals: 6,
    nativeDecimals: 9,
    requiredConfirmations: 32,
    // SLIP-44 derivation path for Solana
    derivationPath: "m/44'/501'/0'/0'",
  },
};

// Polling intervals (ms)
export const DEPOSIT_POLL_INTERVAL = 30_000;   // 30s
export const WITHDRAWAL_POLL_INTERVAL = 60_000; // 60s
export const SWEEP_INTERVAL = 300_000;          // 5min

// Price service
export const PRICE_CACHE_TTL = 60_000; // 60s cache for CoinGecko prices
export const COINGECKO_API = 'https://api.coingecko.com/api/v3';

// ERC-20 Transfer event topic (Transfer(address,address,uint256))
export const ERC20_TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

// Minimum deposit amounts (in native units)
export const MIN_DEPOSIT = {
  ETH: 0.001,
  SOL: 0.01,
  USDC_ERC20: 1,
  USDC_SPL: 1,
};

// Withdrawal rake — percentage taken on withdrawal (0.03 = 3%)
export const WITHDRAWAL_RAKE = 0.03;
