PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS installation_conformities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  installation_id INTEGER NOT NULL,
  tenant_id TEXT NOT NULL DEFAULT 'default',
  signed_by_name TEXT NOT NULL,
  signed_by_document TEXT NOT NULL DEFAULT '',
  email_to TEXT NOT NULL,
  summary_note TEXT NOT NULL DEFAULT '',
  technician_note TEXT NOT NULL DEFAULT '',
  signature_r2_key TEXT NOT NULL,
  pdf_r2_key TEXT NOT NULL,
  signed_at TEXT NOT NULL,
  generated_at TEXT NOT NULL DEFAULT (datetime('now')),
  generated_by_user_id INTEGER,
  generated_by_username TEXT NOT NULL,
  session_version INTEGER,
  request_ip TEXT NOT NULL DEFAULT '',
  platform TEXT NOT NULL DEFAULT 'web',
  status TEXT NOT NULL DEFAULT 'generated'
    CHECK (status IN ('generated', 'emailed', 'email_failed')),
  photo_count INTEGER NOT NULL DEFAULT 0,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  FOREIGN KEY (installation_id) REFERENCES installations(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_installation_conformities_installation
  ON installation_conformities (tenant_id, installation_id, generated_at DESC);

CREATE INDEX IF NOT EXISTS idx_installation_conformities_signed_at
  ON installation_conformities (tenant_id, signed_at DESC);

CREATE INDEX IF NOT EXISTS idx_installation_conformities_email
  ON installation_conformities (tenant_id, email_to);

CREATE INDEX IF NOT EXISTS idx_installation_conformities_status
  ON installation_conformities (tenant_id, status, generated_at DESC);
