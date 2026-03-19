-- Player reports
CREATE TABLE IF NOT EXISTS player_reports (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id     UUID NOT NULL REFERENCES users(id),
  reported_id     UUID NOT NULL REFERENCES users(id),
  game_id         VARCHAR(12) REFERENCES games(id),
  reason          VARCHAR(30) NOT NULL,
  details         TEXT,
  status          VARCHAR(20) DEFAULT 'open',
  admin_note      TEXT,
  resolved_by     UUID REFERENCES users(id),
  resolved_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_reports_reported ON player_reports(reported_id);
CREATE INDEX IF NOT EXISTS idx_reports_status ON player_reports(status);

-- Game analysis results
CREATE TABLE IF NOT EXISTS game_analysis (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id                 VARCHAR(12) NOT NULL REFERENCES games(id),
  white_user_id           UUID REFERENCES users(id),
  black_user_id           UUID REFERENCES users(id),
  white_strength_score    NUMERIC(5,1),
  black_strength_score    NUMERIC(5,1),
  white_engine_corr       NUMERIC(5,3),
  black_engine_corr       NUMERIC(5,3),
  white_acpl              NUMERIC(6,1),
  black_acpl              NUMERIC(6,1),
  white_critical_accuracy NUMERIC(5,3),
  black_critical_accuracy NUMERIC(5,3),
  white_timing_suspicion  NUMERIC(5,3),
  black_timing_suspicion  NUMERIC(5,3),
  white_epr               INTEGER,
  black_epr               INTEGER,
  move_details            JSONB,
  analysis_depth          INTEGER DEFAULT 20,
  total_moves             INTEGER,
  book_cutoff             INTEGER DEFAULT 10,
  created_at              TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(game_id)
);
CREATE INDEX IF NOT EXISTS idx_analysis_white ON game_analysis(white_user_id);
CREATE INDEX IF NOT EXISTS idx_analysis_black ON game_analysis(black_user_id);

-- Behavioral data per game per player
CREATE TABLE IF NOT EXISTS game_behavior (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id         VARCHAR(12) NOT NULL REFERENCES games(id),
  user_id         UUID NOT NULL REFERENCES users(id),
  tab_switches    INTEGER DEFAULT 0,
  focus_losses    INTEGER DEFAULT 0,
  copy_events     INTEGER DEFAULT 0,
  paste_events    INTEGER DEFAULT 0,
  mouse_entropy   NUMERIC(8,3),
  raw_events      JSONB,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(game_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_behavior_user ON game_behavior(user_id);

-- Aggregate fair play score per user
CREATE TABLE IF NOT EXISTS fair_play_scores (
  user_id            UUID PRIMARY KEY REFERENCES users(id),
  trust_score        NUMERIC(5,1) DEFAULT 100.0,
  games_analyzed     INTEGER DEFAULT 0,
  avg_strength       NUMERIC(5,1) DEFAULT 0,
  avg_engine_corr    NUMERIC(5,3) DEFAULT 0,
  avg_acpl           NUMERIC(6,1) DEFAULT 0,
  total_tab_switches INTEGER DEFAULT 0,
  total_reports      INTEGER DEFAULT 0,
  rating_velocity    NUMERIC(8,3) DEFAULT 0,
  external_rating    INTEGER,
  external_platform  VARCHAR(20),
  rating_discrepancy INTEGER DEFAULT 0,
  is_flagged         BOOLEAN DEFAULT false,
  flagged_at         TIMESTAMPTZ,
  flag_reason        TEXT,
  last_updated       TIMESTAMPTZ DEFAULT NOW()
);

-- Admin actions log
CREATE TABLE IF NOT EXISTS fair_play_actions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id        UUID NOT NULL REFERENCES users(id),
  target_user_id  UUID NOT NULL REFERENCES users(id),
  action          VARCHAR(30) NOT NULL,
  note            TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_fp_actions_target ON fair_play_actions(target_user_id);
