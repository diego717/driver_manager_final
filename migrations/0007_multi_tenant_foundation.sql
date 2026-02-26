PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS plan_limits (
  plan_code TEXT PRIMARY KEY,
  max_users INTEGER NOT NULL,
  max_storage_bytes INTEGER NOT NULL,
  max_incidents_per_month INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO plan_limits
  (plan_code, max_users, max_storage_bytes, max_incidents_per_month)
VALUES
  ('starter', 5, 1073741824, 500),
  ('growth', 25, 10737418240, 5000),
  ('scale', 250, 107374182400, 50000);

CREATE TABLE IF NOT EXISTS tenants (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'inactive', 'suspended')),
  plan_code TEXT NOT NULL DEFAULT 'starter',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (plan_code) REFERENCES plan_limits(plan_code)
);

CREATE INDEX IF NOT EXISTS idx_tenants_status
  ON tenants (status);

CREATE INDEX IF NOT EXISTS idx_tenants_plan_code
  ON tenants (plan_code);

INSERT OR IGNORE INTO tenants (id, name, status, plan_code)
VALUES ('default', 'Tenant por defecto', 'active', 'starter');

ALTER TABLE installations
  ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'default';

ALTER TABLE incidents
  ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'default';

ALTER TABLE incident_photos
  ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'default';

ALTER TABLE web_users
  ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'default';

ALTER TABLE audit_logs
  ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'default';

ALTER TABLE device_tokens
  ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'default';

CREATE INDEX IF NOT EXISTS idx_installations_tenant_id
  ON installations (tenant_id);

CREATE INDEX IF NOT EXISTS idx_incidents_tenant_id
  ON incidents (tenant_id);

CREATE INDEX IF NOT EXISTS idx_incident_photos_tenant_id
  ON incident_photos (tenant_id);

CREATE INDEX IF NOT EXISTS idx_web_users_tenant_id
  ON web_users (tenant_id);

CREATE INDEX IF NOT EXISTS idx_audit_logs_tenant_id
  ON audit_logs (tenant_id);

CREATE INDEX IF NOT EXISTS idx_device_tokens_tenant_id
  ON device_tokens (tenant_id);

CREATE TABLE IF NOT EXISTS tenant_user_roles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  user_id INTEGER NOT NULL,
  role TEXT NOT NULL
    CHECK (role IN ('admin', 'supervisor', 'tecnico', 'solo_lectura')),
  is_active INTEGER NOT NULL DEFAULT 1
    CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (tenant_id, user_id),
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES web_users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_tenant_user_roles_tenant_role
  ON tenant_user_roles (tenant_id, role);

CREATE INDEX IF NOT EXISTS idx_tenant_user_roles_user_id
  ON tenant_user_roles (user_id);

CREATE TABLE IF NOT EXISTS tenant_audit_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  actor_user_id INTEGER,
  actor_username TEXT,
  action TEXT NOT NULL,
  entity_type TEXT,
  entity_id TEXT,
  occurred_at TEXT NOT NULL DEFAULT (datetime('now')),
  metadata_json TEXT,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  FOREIGN KEY (actor_user_id) REFERENCES web_users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_tenant_audit_events_tenant_occurred
  ON tenant_audit_events (tenant_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_tenant_audit_events_action
  ON tenant_audit_events (action);

CREATE TABLE IF NOT EXISTS tenant_usage_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  snapshot_month TEXT NOT NULL,
  users_count INTEGER NOT NULL DEFAULT 0,
  storage_bytes INTEGER NOT NULL DEFAULT 0,
  incidents_count INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (tenant_id, snapshot_month),
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_tenant_usage_snapshots_tenant_month
  ON tenant_usage_snapshots (tenant_id, snapshot_month DESC);
