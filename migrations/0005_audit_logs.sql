CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp TEXT NOT NULL,
  action TEXT NOT NULL,
  username TEXT NOT NULL,
  success INTEGER NOT NULL DEFAULT 1,
  details TEXT,
  computer_name TEXT,
  ip_address TEXT,
  platform TEXT
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_timestamp ON audit_logs(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_username ON audit_logs(username);
