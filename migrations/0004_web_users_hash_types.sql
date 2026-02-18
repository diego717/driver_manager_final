PRAGMA foreign_keys = ON;

ALTER TABLE web_users
  ADD COLUMN password_hash_type TEXT NOT NULL DEFAULT 'pbkdf2_sha256';

CREATE INDEX IF NOT EXISTS idx_web_users_hash_type
  ON web_users (password_hash_type);
