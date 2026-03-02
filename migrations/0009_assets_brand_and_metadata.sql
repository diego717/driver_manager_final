PRAGMA foreign_keys = ON;

ALTER TABLE assets
  ADD COLUMN brand TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_assets_tenant_brand
  ON assets (tenant_id, brand);
