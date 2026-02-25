PRAGMA foreign_keys = ON;

-- Base tenant catalog
CREATE TABLE IF NOT EXISTS tenants (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'suspended')),
  plan_code TEXT NOT NULL DEFAULT 'starter',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_tenants_status
  ON tenants (status);

-- Technical plan limits (editable without code deploy).
CREATE TABLE IF NOT EXISTS plan_limits (
  plan_code TEXT PRIMARY KEY,
  max_users INTEGER NOT NULL,
  max_storage_bytes INTEGER NOT NULL,
  max_incidents_per_month INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO plan_limits (
  plan_code,
  max_users,
  max_storage_bytes,
  max_incidents_per_month
)
VALUES
  ('starter', 10, 2147483648, 300),
  ('growth', 50, 21474836480, 3000),
  ('scale', 250, 214748364800, 30000);

-- Default tenant for existing single-tenant data.
INSERT OR IGNORE INTO tenants (id, name, slug, plan_code)
VALUES ('default', 'Default Tenant', 'default', 'starter');

-- Add tenant_id to existing domain tables (safe for current rows).
ALTER TABLE installations ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'default';
ALTER TABLE incidents ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'default';
ALTER TABLE incident_photos ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'default';
ALTER TABLE web_users ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'default';
ALTER TABLE audit_logs ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'default';
ALTER TABLE device_tokens ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'default';

CREATE INDEX IF NOT EXISTS idx_installations_tenant_id ON installations (tenant_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_incidents_tenant_id ON incidents (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_incident_photos_tenant_id ON incident_photos (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_web_users_tenant_id ON web_users (tenant_id, username);
CREATE INDEX IF NOT EXISTS idx_audit_logs_tenant_id ON audit_logs (tenant_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_device_tokens_tenant_id ON device_tokens (tenant_id, updated_at DESC);

-- Company roles scoped by tenant (admin, supervisor, tecnico, solo_lectura).
CREATE TABLE IF NOT EXISTS tenant_user_roles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  user_id INTEGER NOT NULL,
  role TEXT NOT NULL
    CHECK (role IN ('admin', 'supervisor', 'tecnico', 'solo_lectura')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (tenant_id, user_id),
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES web_users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_tenant_user_roles_tenant_role
  ON tenant_user_roles (tenant_id, role);

-- Minimal tenant audit trail requested for "who did what and when".
CREATE TABLE IF NOT EXISTS tenant_audit_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  actor_user_id INTEGER,
  actor_username TEXT NOT NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  occurred_at TEXT NOT NULL DEFAULT (datetime('now')),
  metadata_json TEXT,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  FOREIGN KEY (actor_user_id) REFERENCES web_users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_tenant_audit_events_tenant_time
  ON tenant_audit_events (tenant_id, occurred_at DESC);

-- Tenant usage snapshots for enforcement and billing decisions.
CREATE TABLE IF NOT EXISTS tenant_usage_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  usage_month TEXT NOT NULL, -- YYYY-MM
  users_count INTEGER NOT NULL DEFAULT 0,
  storage_bytes INTEGER NOT NULL DEFAULT 0,
  incidents_count INTEGER NOT NULL DEFAULT 0,
  recorded_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (tenant_id, usage_month),
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_tenant_usage_snapshots_tenant_month
  ON tenant_usage_snapshots (tenant_id, usage_month DESC);
