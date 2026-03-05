-- time_control was INTEGER but persistGame inserts JSON strings like '{"time":300,"increment":0}'
-- Change to TEXT to accept both legacy integer values and new JSON strings
ALTER TABLE games ALTER COLUMN time_control TYPE TEXT USING time_control::TEXT;
ALTER TABLE games ALTER COLUMN time_control SET DEFAULT '300';
ALTER TABLE games ALTER COLUMN time_control DROP NOT NULL;
