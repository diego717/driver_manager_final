PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS asset_loans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL DEFAULT 'default',
  asset_id INTEGER NOT NULL,
  original_client TEXT NOT NULL DEFAULT '',
  borrowing_client TEXT NOT NULL,
  loaned_at TEXT NOT NULL,
  expected_return_at TEXT,
  returned_at TEXT,
  loaned_by_username TEXT NOT NULL DEFAULT 'unknown',
  returned_by_username TEXT,
  notes TEXT NOT NULL DEFAULT '',
  return_notes TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'overdue', 'returned')),
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_asset_loans_tenant_asset
  ON asset_loans (tenant_id, asset_id);

CREATE INDEX IF NOT EXISTS idx_asset_loans_tenant_status
  ON asset_loans (tenant_id, status);

CREATE INDEX IF NOT EXISTS idx_asset_loans_expected_return
  ON asset_loans (expected_return_at);
