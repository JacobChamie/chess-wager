CREATE TABLE IF NOT EXISTS games (
  id              VARCHAR(12) PRIMARY KEY,
  status          VARCHAR(20) NOT NULL DEFAULT 'waiting',
  white_player    VARCHAR(64),
  black_player    VARCHAR(64),
  white_name      VARCHAR(50),
  black_name      VARCHAR(50),
  time_control    INTEGER NOT NULL DEFAULT 300,
  fen             TEXT NOT NULL DEFAULT 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
  pgn             TEXT DEFAULT '',
  moves           JSONB DEFAULT '[]',
  result          VARCHAR(20),
  result_reason   VARCHAR(30),
  white_time_remaining INTEGER,
  black_time_remaining INTEGER,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  started_at      TIMESTAMPTZ,
  ended_at        TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_games_status ON games(status);
