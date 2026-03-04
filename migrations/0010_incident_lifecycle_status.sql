ALTER TABLE incidents ADD COLUMN incident_status TEXT NOT NULL DEFAULT 'open'
  CHECK (incident_status IN ('open', 'in_progress', 'resolved'));

ALTER TABLE incidents ADD COLUMN status_updated_at TEXT;
ALTER TABLE incidents ADD COLUMN status_updated_by TEXT;
ALTER TABLE incidents ADD COLUMN resolved_at TEXT;
ALTER TABLE incidents ADD COLUMN resolved_by TEXT;
ALTER TABLE incidents ADD COLUMN resolution_note TEXT;

CREATE INDEX IF NOT EXISTS idx_incidents_tenant_status
  ON incidents (tenant_id, incident_status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_incidents_status_updated_at
  ON incidents (status_updated_at DESC);
