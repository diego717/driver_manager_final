PRAGMA foreign_keys = ON;

ALTER TABLE incidents
  ADD COLUMN checklist_applied_json TEXT NOT NULL DEFAULT '[]';

CREATE TABLE IF NOT EXISTS incident_checklist_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL DEFAULT 'default',
  name TEXT NOT NULL,
  description TEXT,
  is_active INTEGER NOT NULL DEFAULT 1
    CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_incident_checklist_templates_tenant_active
  ON incident_checklist_templates (tenant_id, is_active);

CREATE TABLE IF NOT EXISTS incident_checklist_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL DEFAULT 'default',
  template_id INTEGER NOT NULL,
  item_code TEXT,
  label TEXT NOT NULL,
  is_required INTEGER NOT NULL DEFAULT 1
    CHECK (is_required IN (0, 1)),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (template_id) REFERENCES incident_checklist_templates(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_incident_checklist_items_template
  ON incident_checklist_items (template_id, sort_order, id);

CREATE INDEX IF NOT EXISTS idx_incident_checklist_items_tenant
  ON incident_checklist_items (tenant_id);

CREATE TABLE IF NOT EXISTS incident_evidence_metadata (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL DEFAULT 'default',
  incident_id INTEGER NOT NULL,
  photo_id INTEGER NOT NULL UNIQUE,
  captured_at TEXT NOT NULL,
  latitude REAL,
  longitude REAL,
  accuracy_m REAL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (incident_id) REFERENCES incidents(id) ON DELETE CASCADE,
  FOREIGN KEY (photo_id) REFERENCES incident_photos(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_incident_evidence_metadata_incident
  ON incident_evidence_metadata (incident_id, captured_at);

CREATE INDEX IF NOT EXISTS idx_incident_evidence_metadata_tenant
  ON incident_evidence_metadata (tenant_id, captured_at);
