ALTER TABLE installations
  ADD COLUMN commercial_closure_mode TEXT NOT NULL DEFAULT 'budget_required';

ALTER TABLE installations
  ADD COLUMN commercial_closure_note TEXT NOT NULL DEFAULT '';

ALTER TABLE installations
  ADD COLUMN commercial_closure_set_at TEXT NOT NULL DEFAULT '';

ALTER TABLE installations
  ADD COLUMN commercial_closure_set_by TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_installations_tenant_closure_mode
  ON installations (tenant_id, commercial_closure_mode);
