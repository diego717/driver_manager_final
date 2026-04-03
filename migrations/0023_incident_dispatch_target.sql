ALTER TABLE incidents ADD COLUMN target_lat REAL;
ALTER TABLE incidents ADD COLUMN target_lng REAL;
ALTER TABLE incidents ADD COLUMN target_label TEXT;
ALTER TABLE incidents ADD COLUMN target_source TEXT;
ALTER TABLE incidents ADD COLUMN target_updated_at TEXT;
ALTER TABLE incidents ADD COLUMN target_updated_by TEXT;

ALTER TABLE incidents ADD COLUMN dispatch_place_name TEXT;
ALTER TABLE incidents ADD COLUMN dispatch_address TEXT;
ALTER TABLE incidents ADD COLUMN dispatch_reference TEXT;
ALTER TABLE incidents ADD COLUMN dispatch_contact_name TEXT;
ALTER TABLE incidents ADD COLUMN dispatch_contact_phone TEXT;
ALTER TABLE incidents ADD COLUMN dispatch_notes TEXT;
