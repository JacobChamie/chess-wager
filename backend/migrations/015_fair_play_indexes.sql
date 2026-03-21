CREATE INDEX IF NOT EXISTS idx_game_analysis_white_created
  ON game_analysis(white_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_game_analysis_black_created
  ON game_analysis(black_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reports_created
  ON player_reports(created_at DESC);
