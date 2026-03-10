PRAGMA foreign_keys = ON;

ALTER TABLE incidents
  ADD COLUMN estimated_duration_seconds INTEGER NOT NULL DEFAULT 0;

ALTER TABLE incidents
  ADD COLUMN work_started_at TEXT;

ALTER TABLE incidents
  ADD COLUMN work_ended_at TEXT;

ALTER TABLE incidents
  ADD COLUMN actual_duration_seconds INTEGER;

CREATE INDEX IF NOT EXISTS idx_incidents_tenant_work_started
  ON incidents (tenant_id, work_started_at DESC);
