PRAGMA foreign_keys = OFF;

CREATE TABLE incidents_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  installation_id INTEGER NOT NULL,
  reporter_username TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  time_adjustment_seconds INTEGER NOT NULL DEFAULT 0,
  severity TEXT NOT NULL DEFAULT 'medium'
    CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  source TEXT NOT NULL DEFAULT 'mobile'
    CHECK (source IN ('desktop', 'mobile', 'web')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  tenant_id TEXT NOT NULL DEFAULT 'default',
  incident_status TEXT NOT NULL DEFAULT 'open'
    CHECK (incident_status IN ('open', 'in_progress', 'paused', 'resolved')),
  status_updated_at TEXT,
  status_updated_by TEXT,
  resolved_at TEXT,
  resolved_by TEXT,
  resolution_note TEXT,
  checklist_json TEXT,
  evidence_note TEXT,
  asset_id INTEGER,
  estimated_duration_seconds INTEGER NOT NULL DEFAULT 0,
  work_started_at TEXT,
  work_ended_at TEXT,
  actual_duration_seconds INTEGER,
  FOREIGN KEY (installation_id) REFERENCES installations(id) ON DELETE CASCADE
);

INSERT INTO incidents_new (
  id,
  installation_id,
  reporter_username,
  note,
  time_adjustment_seconds,
  severity,
  source,
  created_at,
  tenant_id,
  incident_status,
  status_updated_at,
  status_updated_by,
  resolved_at,
  resolved_by,
  resolution_note,
  checklist_json,
  evidence_note,
  asset_id,
  estimated_duration_seconds,
  work_started_at,
  work_ended_at,
  actual_duration_seconds
)
SELECT
  id,
  installation_id,
  reporter_username,
  note,
  time_adjustment_seconds,
  severity,
  source,
  created_at,
  tenant_id,
  incident_status,
  status_updated_at,
  status_updated_by,
  resolved_at,
  resolved_by,
  resolution_note,
  checklist_json,
  evidence_note,
  asset_id,
  estimated_duration_seconds,
  work_started_at,
  work_ended_at,
  actual_duration_seconds
FROM incidents;

DROP TABLE incidents;

ALTER TABLE incidents_new RENAME TO incidents;

CREATE INDEX IF NOT EXISTS idx_incidents_installation_id
  ON incidents (installation_id);

CREATE INDEX IF NOT EXISTS idx_incidents_created_at
  ON incidents (created_at);

CREATE INDEX IF NOT EXISTS idx_incidents_tenant_id
  ON incidents (tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_incidents_tenant_status
  ON incidents (tenant_id, incident_status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_incidents_status_updated_at
  ON incidents (status_updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_incidents_tenant_asset_id
  ON incidents (tenant_id, asset_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_incidents_asset_id
  ON incidents (asset_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_incidents_tenant_work_started
  ON incidents (tenant_id, work_started_at DESC);

PRAGMA foreign_keys = ON;
