PRAGMA foreign_keys = OFF;

CREATE TABLE web_users__next (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'admin'
    CHECK (role IN ('admin', 'supervisor', 'tecnico', 'solo_lectura', 'super_admin', 'platform_owner')),
  is_active INTEGER NOT NULL DEFAULT 1
    CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_login_at TEXT,
  password_hash_type TEXT NOT NULL DEFAULT 'pbkdf2_sha256',
  tenant_id TEXT NOT NULL DEFAULT 'default'
);

INSERT INTO web_users__next (
  id,
  username,
  password_hash,
  role,
  is_active,
  created_at,
  updated_at,
  last_login_at,
  password_hash_type,
  tenant_id
)
SELECT
  id,
  username,
  password_hash,
  CASE
    WHEN LOWER(COALESCE(role, 'admin')) = 'viewer' THEN 'solo_lectura'
    ELSE LOWER(COALESCE(role, 'admin'))
  END AS role,
  COALESCE(is_active, 1),
  COALESCE(created_at, datetime('now')),
  COALESCE(updated_at, datetime('now')),
  last_login_at,
  COALESCE(password_hash_type, 'pbkdf2_sha256'),
  COALESCE(tenant_id, 'default')
FROM web_users;

DROP TABLE web_users;
ALTER TABLE web_users__next RENAME TO web_users;

CREATE INDEX IF NOT EXISTS idx_web_users_active
  ON web_users (is_active);

CREATE INDEX IF NOT EXISTS idx_web_users_role
  ON web_users (role);

CREATE INDEX IF NOT EXISTS idx_web_users_hash_type
  ON web_users (password_hash_type);

CREATE INDEX IF NOT EXISTS idx_web_users_tenant_id
  ON web_users (tenant_id, username);

PRAGMA foreign_keys = ON;
