PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS assets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  external_code TEXT NOT NULL COLLATE NOCASE,
  serial_number TEXT NOT NULL DEFAULT '',
  model TEXT NOT NULL DEFAULT '',
  client_name TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'inactive', 'retired', 'maintenance')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_by_username TEXT,
  updated_by_username TEXT,
  UNIQUE (tenant_id, external_code),
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_assets_tenant_updated
  ON assets (tenant_id, updated_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_assets_tenant_status
  ON assets (tenant_id, status);

CREATE INDEX IF NOT EXISTS idx_assets_tenant_external_code
  ON assets (tenant_id, external_code);

CREATE TABLE IF NOT EXISTS asset_installation_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  asset_id INTEGER NOT NULL,
  installation_id INTEGER NOT NULL,
  linked_at TEXT NOT NULL DEFAULT (datetime('now')),
  unlinked_at TEXT,
  linked_by_username TEXT,
  notes TEXT NOT NULL DEFAULT '',
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE CASCADE,
  FOREIGN KEY (installation_id) REFERENCES installations(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_asset_links_tenant_asset_active
  ON asset_installation_links (tenant_id, asset_id, linked_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_asset_links_tenant_installation_active
  ON asset_installation_links (tenant_id, installation_id, linked_at DESC, id DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_asset_links_active_unique
  ON asset_installation_links (tenant_id, asset_id)
  WHERE unlinked_at IS NULL;
