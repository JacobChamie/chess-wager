-- Transaction ledger (append-only audit trail)
CREATE TABLE IF NOT EXISTS ledger (
  id             BIGSERIAL PRIMARY KEY,
  user_id        UUID NOT NULL REFERENCES users(id),
  type           VARCHAR(30) NOT NULL, -- deposit|withdrawal|wager_lock|wager_win|wager_refund
  amount         NUMERIC(18,8) NOT NULL,
  balance_after  NUMERIC(18,8) NOT NULL,
  reference_type VARCHAR(30),          -- 'deposit'|'withdrawal'|'game'
  reference_id   VARCHAR(128),
  description    TEXT,
  created_at     TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ledger_user ON ledger(user_id);

-- Wager columns on games
ALTER TABLE games ADD COLUMN IF NOT EXISTS wager_amount NUMERIC(18,8) DEFAULT 0;
ALTER TABLE games ADD COLUMN IF NOT EXISTS is_wager_game BOOLEAN DEFAULT false;
ALTER TABLE games ADD COLUMN IF NOT EXISTS wager_status VARCHAR(20);
