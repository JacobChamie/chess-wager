-- Wager status state machine: only valid transitions
-- locked -> settling -> settled  (normal payout)
-- locked -> held                 (anti-cheat flag)
-- held -> settling -> settled    (admin release)
-- NULL is allowed for non-wager games

-- Constrain wager_status to valid values
DO $$ BEGIN
  ALTER TABLE games ADD CONSTRAINT games_wager_status_valid
    CHECK (wager_status IS NULL OR wager_status IN ('locked', 'settling', 'settled', 'held'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Prevent negative wager amounts
DO $$ BEGIN
  ALTER TABLE games ADD CONSTRAINT games_wager_amount_nonneg
    CHECK (wager_amount >= 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Ensure ledger is append-only: no updates or deletes via a trigger
-- (Admin reversals create new rows, never modify existing ones)
CREATE OR REPLACE FUNCTION prevent_ledger_mutation() RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'Ledger entries are immutable — create a reversal entry instead';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS ledger_no_update ON ledger;
CREATE TRIGGER ledger_no_update
  BEFORE UPDATE OR DELETE ON ledger
  FOR EACH ROW EXECUTE FUNCTION prevent_ledger_mutation();

-- Index for the settlement CAS query (WHERE id = X AND wager_status = 'locked')
CREATE INDEX IF NOT EXISTS idx_games_wager_status ON games(id, wager_status)
  WHERE wager_status IS NOT NULL;

-- Prevent duplicate wager_lock ledger entries for the same game+user
-- (guards against double-lock at the DB level)
CREATE UNIQUE INDEX IF NOT EXISTS idx_ledger_wager_lock_unique
  ON ledger(user_id, reference_id)
  WHERE type = 'wager_lock';
