-- Migration 017: Live mid-game cheat detection flag table
--
-- Records flags raised by LiveCheatDetector during active games.
-- Used as an audit trail and to coordinate post-game wager settlement.

CREATE TABLE IF NOT EXISTS live_cheat_flags (
  id          UUID         DEFAULT gen_random_uuid() PRIMARY KEY,
  game_id     VARCHAR(12)  NOT NULL,
  user_id     UUID         NOT NULL REFERENCES users(id),
  flagged_at  TIMESTAMPTZ  DEFAULT NOW(),
  reason      VARCHAR(100),          -- 'consecutive_engine_moves' | 'high_engine_corr' | 'flat_timing_corr'
  metrics     JSONB,                 -- snapshot at flag time: { consecutiveCount, topOneRate, timingCV, analyzedMoves }
  resolved    BOOLEAN      DEFAULT false,
  resolved_at TIMESTAMPTZ,
  resolution  VARCHAR(20)            -- 'cleared' | 'confirmed' | 'admin_review'
);

CREATE INDEX IF NOT EXISTS idx_live_flags_game     ON live_cheat_flags(game_id);
CREATE INDEX IF NOT EXISTS idx_live_flags_user     ON live_cheat_flags(user_id);
CREATE INDEX IF NOT EXISTS idx_live_flags_unresolved
  ON live_cheat_flags(resolved) WHERE resolved = false;
