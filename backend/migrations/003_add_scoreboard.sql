-- Link games to user accounts
ALTER TABLE games ADD COLUMN IF NOT EXISTS white_user_id UUID REFERENCES users(id);
ALTER TABLE games ADD COLUMN IF NOT EXISTS black_user_id UUID REFERENCES users(id);

-- Avatar support
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_id VARCHAR(32) DEFAULT 'default';

-- Indexes for leaderboard/profile queries
CREATE INDEX IF NOT EXISTS idx_games_white_user ON games(white_user_id) WHERE white_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_games_black_user ON games(black_user_id) WHERE black_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_games_ended_at ON games(ended_at) WHERE ended_at IS NOT NULL;
