PRAGMA foreign_keys = ON;

ALTER TABLE incidents ADD COLUMN asset_id INTEGER;

CREATE INDEX IF NOT EXISTS idx_incidents_tenant_asset_id
  ON incidents (tenant_id, asset_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_incidents_asset_id
  ON incidents (asset_id, created_at DESC);
