PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS web_users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'admin'
    CHECK (role IN ('admin', 'viewer', 'super_admin')),
  is_active INTEGER NOT NULL DEFAULT 1
    CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_login_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_web_users_active
  ON web_users (is_active);

CREATE INDEX IF NOT EXISTS idx_web_users_role
  ON web_users (role);
