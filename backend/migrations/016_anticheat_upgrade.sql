-- Anti-cheat upgrade: new signals, Bayesian confirmation, environment fingerprinting

-- game_behavior: new client-side signals
ALTER TABLE game_behavior
  ADD COLUMN IF NOT EXISTS mutation_events   INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS simulated_clicks  INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS canvas_fingerprint VARCHAR(64);

-- game_analysis: per-game derived cheating metrics
ALTER TABLE game_analysis
  ADD COLUMN IF NOT EXISTS white_flat_timing_cv          NUMERIC(5,3),
  ADD COLUMN IF NOT EXISTS black_flat_timing_cv          NUMERIC(5,3),
  ADD COLUMN IF NOT EXISTS white_tab_move_corr           NUMERIC(5,3),
  ADD COLUMN IF NOT EXISTS black_tab_move_corr           NUMERIC(5,3),
  ADD COLUMN IF NOT EXISTS white_cploss_complexity_corr  NUMERIC(5,3),
  ADD COLUMN IF NOT EXISTS black_cploss_complexity_corr  NUMERIC(5,3);

-- fair_play_scores: Bayesian confirmation fields
ALTER TABLE fair_play_scores
  ADD COLUMN IF NOT EXISTS ipr_discrepancy    INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS avg_flat_timing_cv NUMERIC(5,3),
  ADD COLUMN IF NOT EXISTS avg_tab_move_corr  NUMERIC(5,3),
  ADD COLUMN IF NOT EXISTS confirmed_flag     BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS confirmed_at       TIMESTAMPTZ;

-- Environment fingerprints: detect banned players on same machine
CREATE TABLE IF NOT EXISTS environment_fingerprints (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL REFERENCES users(id),
  canvas_hash      VARCHAR(64) NOT NULL,
  first_seen       TIMESTAMPTZ DEFAULT NOW(),
  last_seen        TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, canvas_hash)
);
CREATE INDEX IF NOT EXISTS idx_env_fp_hash ON environment_fingerprints(canvas_hash);
CREATE INDEX IF NOT EXISTS idx_env_fp_user ON environment_fingerprints(user_id);
