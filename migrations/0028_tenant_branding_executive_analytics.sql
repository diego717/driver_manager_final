PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS tenant_branding (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL DEFAULT '',
  logo_key TEXT NOT NULL DEFAULT '',
  primary_color TEXT NOT NULL DEFAULT '#d97706',
  secondary_color TEXT NOT NULL DEFAULT '#b45309',
  status_colors_json TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_by TEXT NOT NULL DEFAULT '',
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_tenant_branding_tenant
  ON tenant_branding (tenant_id);

CREATE TABLE IF NOT EXISTS tenant_sites (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1
    CHECK (is_active IN (0, 1)),
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (tenant_id, code),
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_tenant_sites_tenant_active
  ON tenant_sites (tenant_id, is_active, name);

ALTER TABLE installations ADD COLUMN site_id INTEGER;
CREATE INDEX IF NOT EXISTS idx_installations_tenant_site_id
  ON installations (tenant_id, site_id, timestamp DESC);

ALTER TABLE incidents ADD COLUMN site_id INTEGER;
ALTER TABLE incidents ADD COLUMN category_code TEXT NOT NULL DEFAULT 'uncategorized';
ALTER TABLE incidents ADD COLUMN cause_code TEXT NOT NULL DEFAULT 'unknown';

CREATE INDEX IF NOT EXISTS idx_incidents_tenant_site_id
  ON incidents (tenant_id, site_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_incidents_tenant_category
  ON incidents (tenant_id, category_code, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_incidents_tenant_cause
  ON incidents (tenant_id, cause_code, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_incidents_tenant_resolved_at
  ON incidents (tenant_id, resolved_at DESC);

UPDATE incidents
SET site_id = (
  SELECT inst.site_id
  FROM installations inst
  WHERE inst.id = incidents.installation_id
    AND inst.tenant_id = incidents.tenant_id
  LIMIT 1
)
WHERE site_id IS NULL;

CREATE TABLE IF NOT EXISTS incident_categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT,
  category_code TEXT NOT NULL,
  label TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1
    CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (tenant_id, category_code)
);

CREATE INDEX IF NOT EXISTS idx_incident_categories_tenant_active
  ON incident_categories (tenant_id, is_active, category_code);

CREATE TABLE IF NOT EXISTS incident_causes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT,
  category_code TEXT NOT NULL,
  cause_code TEXT NOT NULL,
  label TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1
    CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (tenant_id, cause_code)
);

CREATE INDEX IF NOT EXISTS idx_incident_causes_tenant_category
  ON incident_causes (tenant_id, category_code, is_active);

INSERT OR IGNORE INTO incident_categories (tenant_id, category_code, label)
VALUES
  (NULL, 'uncategorized', 'Sin categoría'),
  (NULL, 'hardware', 'Hardware'),
  (NULL, 'software', 'Software'),
  (NULL, 'network', 'Red/Conectividad'),
  (NULL, 'operations', 'Operación');

INSERT OR IGNORE INTO incident_causes (tenant_id, category_code, cause_code, label)
VALUES
  (NULL, 'uncategorized', 'unknown', 'No especificada'),
  (NULL, 'hardware', 'parts_failure', 'Falla de partes'),
  (NULL, 'hardware', 'wear', 'Desgaste'),
  (NULL, 'software', 'config_error', 'Configuración incorrecta'),
  (NULL, 'software', 'version_mismatch', 'Versión incompatible'),
  (NULL, 'network', 'latency', 'Latencia'),
  (NULL, 'network', 'connectivity_loss', 'Pérdida de conectividad'),
  (NULL, 'operations', 'human_error', 'Error operativo'),
  (NULL, 'operations', 'missing_procedure', 'Procedimiento faltante');

CREATE TABLE IF NOT EXISTS tenant_sla_policies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  severity TEXT NOT NULL
    CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  resolution_target_minutes INTEGER NOT NULL
    CHECK (resolution_target_minutes > 0 AND resolution_target_minutes <= 10080),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_by TEXT NOT NULL DEFAULT '',
  UNIQUE (tenant_id, severity),
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_tenant_sla_policies_tenant
  ON tenant_sla_policies (tenant_id, severity);

INSERT OR IGNORE INTO tenant_sla_policies (tenant_id, severity, resolution_target_minutes)
SELECT t.id, s.severity, s.minutes
FROM tenants t
CROSS JOIN (
  SELECT 'low' AS severity, 1440 AS minutes
  UNION ALL SELECT 'medium', 480
  UNION ALL SELECT 'high', 240
  UNION ALL SELECT 'critical', 60
) s;

ALTER TABLE technicians ADD COLUMN team_name TEXT NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS idx_technicians_tenant_team
  ON technicians (tenant_id, team_name, is_active, display_name);

CREATE TABLE IF NOT EXISTS incident_kpi_daily (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  day TEXT NOT NULL,
  site_id INTEGER NOT NULL DEFAULT -1,
  team_name TEXT NOT NULL DEFAULT '',
  technician_id INTEGER NOT NULL DEFAULT -1,
  category_code TEXT NOT NULL DEFAULT 'uncategorized',
  cause_code TEXT NOT NULL DEFAULT 'unknown',
  severity TEXT NOT NULL DEFAULT 'medium',
  resolved_count INTEGER NOT NULL DEFAULT 0,
  mttr_seconds_sum INTEGER NOT NULL DEFAULT 0,
  sla_on_time_count INTEGER NOT NULL DEFAULT 0,
  sla_late_count INTEGER NOT NULL DEFAULT 0,
  fcr_count INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (
    tenant_id,
    day,
    site_id,
    team_name,
    technician_id,
    category_code,
    cause_code,
    severity
  ),
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_incident_kpi_daily_tenant_day
  ON incident_kpi_daily (tenant_id, day DESC);
CREATE INDEX IF NOT EXISTS idx_incident_kpi_daily_tenant_site
  ON incident_kpi_daily (tenant_id, site_id, day DESC);
CREATE INDEX IF NOT EXISTS idx_incident_kpi_daily_tenant_team
  ON incident_kpi_daily (tenant_id, team_name, day DESC);
CREATE INDEX IF NOT EXISTS idx_incident_kpi_daily_tenant_technician
  ON incident_kpi_daily (tenant_id, technician_id, day DESC);
CREATE INDEX IF NOT EXISTS idx_incident_kpi_daily_tenant_cause
  ON incident_kpi_daily (tenant_id, cause_code, day DESC);
