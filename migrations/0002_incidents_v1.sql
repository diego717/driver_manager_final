PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS incidents (
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
  FOREIGN KEY (installation_id) REFERENCES installations(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_incidents_installation_id
  ON incidents (installation_id);

CREATE INDEX IF NOT EXISTS idx_incidents_created_at
  ON incidents (created_at);

CREATE TABLE IF NOT EXISTS incident_photos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  incident_id INTEGER NOT NULL,
  r2_key TEXT NOT NULL UNIQUE,
  file_name TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  sha256 TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (incident_id) REFERENCES incidents(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_incident_photos_incident_id
  ON incident_photos (incident_id);
