CREATE TABLE IF NOT EXISTS device_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  fcm_token TEXT NOT NULL UNIQUE,
  device_model TEXT,
  app_version TEXT,
  platform TEXT NOT NULL DEFAULT 'android',
  registered_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES web_users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_device_tokens_user_id
  ON device_tokens (user_id);

CREATE INDEX IF NOT EXISTS idx_device_tokens_registered_at
  ON device_tokens (registered_at DESC);
