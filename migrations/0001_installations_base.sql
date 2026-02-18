PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS installations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp TEXT NOT NULL DEFAULT (datetime('now')),
  driver_brand TEXT NOT NULL DEFAULT '',
  driver_version TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'unknown',
  client_name TEXT NOT NULL DEFAULT '',
  driver_description TEXT NOT NULL DEFAULT '',
  installation_time_seconds INTEGER NOT NULL DEFAULT 0,
  os_info TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_installations_timestamp
  ON installations (timestamp);

CREATE INDEX IF NOT EXISTS idx_installations_status
  ON installations (status);

CREATE INDEX IF NOT EXISTS idx_installations_brand
  ON installations (driver_brand);
