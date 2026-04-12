PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS installation_budgets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  installation_id INTEGER NOT NULL,
  tenant_id TEXT NOT NULL DEFAULT 'default',
  budget_number TEXT NOT NULL,
  incidence_summary TEXT NOT NULL DEFAULT '',
  scope_included TEXT NOT NULL DEFAULT '',
  scope_excluded TEXT NOT NULL DEFAULT '',
  labor_amount_cents INTEGER NOT NULL DEFAULT 0,
  parts_amount_cents INTEGER NOT NULL DEFAULT 0,
  tax_amount_cents INTEGER NOT NULL DEFAULT 0,
  total_amount_cents INTEGER NOT NULL DEFAULT 0,
  currency_code TEXT NOT NULL DEFAULT 'UYU',
  estimated_days INTEGER,
  valid_until TEXT,
  email_to TEXT NOT NULL DEFAULT '',
  delivery_status TEXT NOT NULL DEFAULT 'generated'
    CHECK (delivery_status IN ('generated', 'emailed', 'email_failed')),
  approval_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (approval_status IN ('pending', 'approved', 'superseded', 'rejected')),
  approved_by_name TEXT NOT NULL DEFAULT '',
  approved_by_channel TEXT NOT NULL DEFAULT '',
  approved_at TEXT,
  approval_note TEXT NOT NULL DEFAULT '',
  pdf_r2_key TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_by_user_id INTEGER,
  created_by_username TEXT NOT NULL DEFAULT 'web',
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (installation_id) REFERENCES installations(id) ON DELETE CASCADE,
  UNIQUE (tenant_id, budget_number)
);

CREATE INDEX IF NOT EXISTS idx_installation_budgets_installation
  ON installation_budgets (tenant_id, installation_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_installation_budgets_approval
  ON installation_budgets (tenant_id, installation_id, approval_status, approved_at DESC);

ALTER TABLE installation_conformities
  ADD COLUMN budget_id INTEGER;

CREATE INDEX IF NOT EXISTS idx_installation_conformities_budget
  ON installation_conformities (tenant_id, installation_id, budget_id, generated_at DESC);
