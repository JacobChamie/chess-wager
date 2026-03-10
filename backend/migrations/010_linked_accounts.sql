CREATE TABLE IF NOT EXISTS linked_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  platform VARCHAR(20) NOT NULL,
  platform_username VARCHAR(64) NOT NULL,
  is_verified BOOLEAN DEFAULT false,
  verification_code VARCHAR(32),
  ratings JSONB DEFAULT '{}',
  profile_url TEXT,
  linked_at TIMESTAMPTZ DEFAULT NOW(),
  ratings_updated_at TIMESTAMPTZ,
  UNIQUE(user_id, platform)
);
