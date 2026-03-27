ALTER TABLE installations ADD COLUMN site_lat REAL;
ALTER TABLE installations ADD COLUMN site_lng REAL;
ALTER TABLE installations ADD COLUMN site_radius_m REAL;

ALTER TABLE incidents ADD COLUMN geofence_distance_m REAL;
ALTER TABLE incidents ADD COLUMN geofence_radius_m REAL;
ALTER TABLE incidents ADD COLUMN geofence_result TEXT NOT NULL DEFAULT 'not_applicable';
ALTER TABLE incidents ADD COLUMN geofence_checked_at TEXT;
