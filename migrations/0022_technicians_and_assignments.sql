PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS technicians (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  web_user_id INTEGER,
  display_name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  employee_code TEXT,
  notes TEXT,
  is_active INTEGER NOT NULL DEFAULT 1
    CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (tenant_id, web_user_id),
  UNIQUE (tenant_id, employee_code),
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  FOREIGN KEY (web_user_id) REFERENCES web_users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_technicians_tenant_active
  ON technicians (tenant_id, is_active, display_name);

CREATE INDEX IF NOT EXISTS idx_technicians_tenant_web_user
  ON technicians (tenant_id, web_user_id);

CREATE TABLE IF NOT EXISTS technician_assignments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  technician_id INTEGER NOT NULL,
  entity_type TEXT NOT NULL
    CHECK (entity_type IN ('installation', 'incident', 'asset', 'zone')),
  entity_id TEXT NOT NULL,
  assignment_role TEXT NOT NULL DEFAULT 'owner'
    CHECK (assignment_role IN ('owner', 'assistant', 'reviewer')),
  assigned_by_user_id INTEGER,
  assigned_by_username TEXT NOT NULL,
  assigned_at TEXT NOT NULL DEFAULT (datetime('now')),
  unassigned_at TEXT,
  metadata_json TEXT,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  FOREIGN KEY (technician_id) REFERENCES technicians(id) ON DELETE CASCADE,
  FOREIGN KEY (assigned_by_user_id) REFERENCES web_users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_technician_assignments_tenant_entity
  ON technician_assignments (tenant_id, entity_type, entity_id, unassigned_at);

CREATE INDEX IF NOT EXISTS idx_technician_assignments_tenant_technician
  ON technician_assignments (tenant_id, technician_id, unassigned_at, assigned_at DESC);
