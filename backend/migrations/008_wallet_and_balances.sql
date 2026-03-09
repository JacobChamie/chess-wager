-- Token balance on users
ALTER TABLE users ADD COLUMN IF NOT EXISTS token_balance NUMERIC(18,8) NOT NULL DEFAULT 0;
ALTER TABLE users ADD CONSTRAINT users_token_balance_nonneg CHECK (token_balance >= 0);

-- Deposit wallets (derived HD addresses)
CREATE TABLE IF NOT EXISTS wallets (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  chain            VARCHAR(10) NOT NULL,     -- 'ethereum' | 'solana'
  address          VARCHAR(128) NOT NULL,
  derivation_index INTEGER NOT NULL,
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(chain, derivation_index)
);
CREATE INDEX IF NOT EXISTS idx_wallets_user ON wallets(user_id);
CREATE INDEX IF NOT EXISTS idx_wallets_address ON wallets(address);

-- Deposits
CREATE TABLE IF NOT EXISTS deposits (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id),
  wallet_id       UUID NOT NULL REFERENCES wallets(id),
  chain           VARCHAR(10) NOT NULL,
  asset           VARCHAR(20) NOT NULL,      -- 'ETH' | 'SOL' | 'USDC_ERC20' | 'USDC_SPL'
  tx_hash         VARCHAR(128) NOT NULL UNIQUE,
  amount_raw      VARCHAR(78) NOT NULL,      -- smallest unit (wei/lamports)
  amount_decimal  NUMERIC(28,8) NOT NULL,
  usd_value       NUMERIC(18,8) NOT NULL,
  tokens_credited NUMERIC(18,8) NOT NULL,    -- = usd_value (1:1)
  confirmations   INTEGER NOT NULL DEFAULT 0,
  required_confs  INTEGER NOT NULL,
  status          VARCHAR(20) NOT NULL DEFAULT 'pending', -- pending|confirmed|credited|failed
  detected_at     TIMESTAMPTZ DEFAULT NOW(),
  confirmed_at    TIMESTAMPTZ,
  credited_at     TIMESTAMPTZ
);

-- Withdrawals
CREATE TABLE IF NOT EXISTS withdrawals (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID NOT NULL REFERENCES users(id),
  chain          VARCHAR(10) NOT NULL,
  asset          VARCHAR(20) NOT NULL,
  to_address     VARCHAR(128) NOT NULL,
  amount_tokens  NUMERIC(18,8) NOT NULL,
  amount_crypto  NUMERIC(28,8) NOT NULL,
  usd_value      NUMERIC(18,8) NOT NULL,
  tx_hash        VARCHAR(128),
  fee_tokens     NUMERIC(18,8) NOT NULL DEFAULT 0,
  status         VARCHAR(20) NOT NULL DEFAULT 'pending', -- pending|processing|sent|confirmed|failed
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  processed_at   TIMESTAMPTZ,
  error_message  TEXT
);

-- Wallet configuration (derivation indexes, last scanned block/slot)
CREATE TABLE IF NOT EXISTS wallet_config (
  key       VARCHAR(50) PRIMARY KEY,
  value     TEXT NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
INSERT INTO wallet_config (key, value) VALUES ('eth_derivation_index', '0') ON CONFLICT DO NOTHING;
INSERT INTO wallet_config (key, value) VALUES ('sol_derivation_index', '0') ON CONFLICT DO NOTHING;
INSERT INTO wallet_config (key, value) VALUES ('eth_last_block', '0') ON CONFLICT DO NOTHING;
INSERT INTO wallet_config (key, value) VALUES ('sol_last_slot', '0') ON CONFLICT DO NOTHING;
