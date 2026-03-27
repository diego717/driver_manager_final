PRAGMA foreign_keys = ON;

ALTER TABLE installations ADD COLUMN gps_lat REAL;
ALTER TABLE installations ADD COLUMN gps_lng REAL;
ALTER TABLE installations ADD COLUMN gps_accuracy_m REAL;
ALTER TABLE installations ADD COLUMN gps_captured_at TEXT;
ALTER TABLE installations ADD COLUMN gps_capture_source TEXT NOT NULL DEFAULT 'none';
ALTER TABLE installations ADD COLUMN gps_capture_status TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE installations ADD COLUMN gps_capture_note TEXT NOT NULL DEFAULT '';

ALTER TABLE incidents ADD COLUMN gps_lat REAL;
ALTER TABLE incidents ADD COLUMN gps_lng REAL;
ALTER TABLE incidents ADD COLUMN gps_accuracy_m REAL;
ALTER TABLE incidents ADD COLUMN gps_captured_at TEXT;
ALTER TABLE incidents ADD COLUMN gps_capture_source TEXT NOT NULL DEFAULT 'none';
ALTER TABLE incidents ADD COLUMN gps_capture_status TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE incidents ADD COLUMN gps_capture_note TEXT NOT NULL DEFAULT '';
