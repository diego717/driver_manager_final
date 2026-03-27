ALTER TABLE incidents ADD COLUMN geofence_override_note TEXT NOT NULL DEFAULT '';
ALTER TABLE incidents ADD COLUMN geofence_override_by TEXT;
ALTER TABLE incidents ADD COLUMN geofence_override_at TEXT;
