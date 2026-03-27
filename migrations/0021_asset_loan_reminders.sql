ALTER TABLE asset_loans
  ADD COLUMN due_soon_reminded_at TEXT;

ALTER TABLE asset_loans
  ADD COLUMN overdue_reminded_at TEXT;

CREATE INDEX IF NOT EXISTS idx_asset_loans_reminder_due_soon
  ON asset_loans(tenant_id, returned_at, expected_return_at, due_soon_reminded_at);

CREATE INDEX IF NOT EXISTS idx_asset_loans_reminder_overdue
  ON asset_loans(tenant_id, returned_at, expected_return_at, overdue_reminded_at);
