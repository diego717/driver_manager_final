ALTER TABLE incidents ADD COLUMN deleted_at TEXT;
ALTER TABLE incidents ADD COLUMN deleted_by TEXT;
ALTER TABLE incidents ADD COLUMN deletion_reason TEXT;

CREATE INDEX IF NOT EXISTS idx_incidents_tenant_deleted_at
  ON incidents (tenant_id, deleted_at, created_at DESC);
