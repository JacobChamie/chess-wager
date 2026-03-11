-- Wager gates on games (creator-defined join requirements)
ALTER TABLE games ADD COLUMN IF NOT EXISTS require_verified BOOLEAN DEFAULT false;
ALTER TABLE games ADD COLUMN IF NOT EXISTS min_external_rating INTEGER;
ALTER TABLE games ADD COLUMN IF NOT EXISTS min_external_platform VARCHAR(20);
ALTER TABLE games ADD COLUMN IF NOT EXISTS min_external_time_control VARCHAR(20);

-- Purchases table (receipt tracking for deposits)
CREATE TABLE IF NOT EXISTS purchases (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id),
  deposit_id      UUID NOT NULL REFERENCES deposits(id),
  chain           VARCHAR(10) NOT NULL,
  asset           VARCHAR(20) NOT NULL,
  amount_crypto   NUMERIC(28,8) NOT NULL,
  usd_value       NUMERIC(18,8) NOT NULL,
  tokens_credited NUMERIC(18,8) NOT NULL,
  receipt_sent    BOOLEAN DEFAULT false,
  receipt_sent_at TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_purchases_user ON purchases(user_id);

-- Withdrawal approval: add admin fields, change default status
ALTER TABLE withdrawals ADD COLUMN IF NOT EXISTS approved_by UUID REFERENCES users(id);
ALTER TABLE withdrawals ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;
ALTER TABLE withdrawals ADD COLUMN IF NOT EXISTS admin_note TEXT;
ALTER TABLE withdrawals ALTER COLUMN status SET DEFAULT 'awaiting_approval';

-- Admin reversal tracking
CREATE TABLE IF NOT EXISTS admin_reversals (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_user_id   UUID NOT NULL REFERENCES users(id),
  target_user_id  UUID NOT NULL REFERENCES users(id),
  reversal_type   VARCHAR(30) NOT NULL,
  reference_id    VARCHAR(128) NOT NULL,
  amount          NUMERIC(18,8) NOT NULL,
  reason          TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Board theme preference
ALTER TABLE users ADD COLUMN IF NOT EXISTS board_theme VARCHAR(30) DEFAULT 'default';
