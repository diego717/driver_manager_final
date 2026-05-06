import {
  addUtcDays,
  normalizeOptionalString,
  startOfUtcDay,
  toUtcDayKey,
} from "../lib/core.js";

const EXECUTIVE_METRIC_DEFINITIONS = Object.freeze({
  mttr_minutes: "Promedio de tiempo de resolución en minutos. Usa actual_duration_seconds; si falta, resolved_at - created_at.",
  sla_on_time_pct: "Porcentaje de tickets resueltos dentro del objetivo SLA por severidad.",
  sla_late_pct: "Porcentaje de tickets resueltos fuera del objetivo SLA por severidad.",
  reincidence: "Cantidad de recurrencias (grupos con mas de un ticket) sobre asset/sede/categoria en el rango.",
  productivity_by_technician: "Tickets cerrados por tecnico (resolved_by) y su FCR en el rango.",
  fcr_pct: "First Contact Resolution: tickets resueltos sin reapertura en los 7 dias siguientes.",
  top_causes: "Causales con mas tickets en el rango filtrado.",
  trend: "Serie diaria de tickets resueltos y cumplimiento SLA.",
});

function buildDurationSecondsSql(alias = "i") {
  return `
    CASE
      WHEN ${alias}.actual_duration_seconds IS NOT NULL
        AND ${alias}.actual_duration_seconds >= 0
      THEN ${alias}.actual_duration_seconds
      WHEN ${alias}.resolved_at IS NOT NULL
        AND ${alias}.created_at IS NOT NULL
      THEN CAST((julianday(${alias}.resolved_at) - julianday(${alias}.created_at)) * 86400 AS INTEGER)
      ELSE NULL
    END
  `;
}

function buildResolvedAnchorSql(alias = "i") {
  return `COALESCE(${alias}.resolved_at, ${alias}.status_updated_at, ${alias}.created_at)`;
}

function buildFcrCaseSql(alias = "i") {
  const resolvedAnchor = buildResolvedAnchorSql(alias);
  return `
    CASE
      WHEN ${resolvedAnchor} IS NULL THEN 0
      WHEN NOT EXISTS (
        SELECT 1
        FROM audit_logs al
        WHERE al.tenant_id = ${alias}.tenant_id
          AND al.action = 'update_incident_status'
          AND CAST(json_extract(al.details, '$.incident_id') AS INTEGER) = ${alias}.id
          AND LOWER(COALESCE(json_extract(al.details, '$.new_status'), '')) IN ('open', 'in_progress', 'paused')
          AND al.timestamp > ${resolvedAnchor}
          AND al.timestamp <= datetime(${resolvedAnchor}, '+7 day')
      ) THEN 1
      ELSE 0
    END
  `;
}

function buildSlaTargetMinutesSql(alias = "i") {
  return `
    COALESCE(
      (
        SELECT sp.resolution_target_minutes
        FROM tenant_sla_policies sp
        WHERE sp.tenant_id = ${alias}.tenant_id
          AND sp.severity = LOWER(COALESCE(${alias}.severity, 'medium'))
        LIMIT 1
      ),
      CASE LOWER(COALESCE(${alias}.severity, 'medium'))
        WHEN 'critical' THEN 60
        WHEN 'high' THEN 240
        WHEN 'medium' THEN 480
        ELSE 1440
      END
    )
  `;
}

export async function refreshIncidentKpiDaily(
  env,
  {
    lookbackDays = 45,
    backfillDays = 365,
  } = {},
) {
  const todayStart = startOfUtcDay(new Date());
  const endExclusive = addUtcDays(todayStart, 1);
  const hasRowsResult = await env.DB.prepare(`
    SELECT COUNT(*) AS total
    FROM incident_kpi_daily
  `).all();
  const hasRows = Number(hasRowsResult?.results?.[0]?.total || 0) > 0;
  const effectiveLookbackDays = hasRows ? lookbackDays : Math.max(lookbackDays, backfillDays);
  const startInclusive = addUtcDays(endExclusive, -Math.max(1, effectiveLookbackDays));
  const startKey = toUtcDayKey(startInclusive);
  const endKey = toUtcDayKey(endExclusive);
  const startIso = startInclusive.toISOString();
  const endIso = endExclusive.toISOString();

  await env.DB.prepare(`
    DELETE FROM incident_kpi_daily
    WHERE day >= ?
      AND day < ?
  `)
    .bind(startKey, endKey)
    .run();

  const durationSql = buildDurationSecondsSql("i");
  const fcrCaseSql = buildFcrCaseSql("i");
  const slaTargetMinutesSql = buildSlaTargetMinutesSql("i");
  const resolvedAnchorSql = buildResolvedAnchorSql("i");

  await env.DB.prepare(`
    INSERT INTO incident_kpi_daily (
      tenant_id,
      day,
      site_id,
      team_name,
      technician_id,
      category_code,
      cause_code,
      severity,
      resolved_count,
      mttr_seconds_sum,
      sla_on_time_count,
      sla_late_count,
      fcr_count,
      updated_at
    )
    SELECT
      i.tenant_id AS tenant_id,
      substr(${resolvedAnchorSql}, 1, 10) AS day,
      COALESCE(i.site_id, -1) AS site_id,
      COALESCE(NULLIF(TRIM(t.team_name), ''), '') AS team_name,
      COALESCE(t.id, -1) AS technician_id,
      COALESCE(NULLIF(TRIM(i.category_code), ''), 'uncategorized') AS category_code,
      COALESCE(NULLIF(TRIM(i.cause_code), ''), 'unknown') AS cause_code,
      LOWER(COALESCE(i.severity, 'medium')) AS severity,
      COUNT(*) AS resolved_count,
      COALESCE(SUM(CASE WHEN ${durationSql} IS NOT NULL THEN ${durationSql} ELSE 0 END), 0) AS mttr_seconds_sum,
      COALESCE(SUM(
        CASE
          WHEN ${durationSql} IS NULL THEN 0
          WHEN ${durationSql} <= (${slaTargetMinutesSql} * 60) THEN 1
          ELSE 0
        END
      ), 0) AS sla_on_time_count,
      COALESCE(SUM(
        CASE
          WHEN ${durationSql} IS NULL THEN 0
          WHEN ${durationSql} > (${slaTargetMinutesSql} * 60) THEN 1
          ELSE 0
        END
      ), 0) AS sla_late_count,
      COALESCE(SUM(${fcrCaseSql}), 0) AS fcr_count,
      datetime('now') AS updated_at
    FROM incidents i
    LEFT JOIN web_users wu
      ON wu.tenant_id = i.tenant_id
     AND LOWER(COALESCE(wu.username, '')) = LOWER(COALESCE(i.resolved_by, ''))
    LEFT JOIN technicians t
      ON t.tenant_id = i.tenant_id
     AND t.web_user_id = wu.id
    WHERE i.deleted_at IS NULL
      AND i.resolved_at IS NOT NULL
      AND ${resolvedAnchorSql} >= ?
      AND ${resolvedAnchorSql} < ?
    GROUP BY
      i.tenant_id,
      substr(${resolvedAnchorSql}, 1, 10),
      COALESCE(i.site_id, -1),
      COALESCE(NULLIF(TRIM(t.team_name), ''), ''),
      COALESCE(t.id, -1),
      COALESCE(NULLIF(TRIM(i.category_code), ''), 'uncategorized'),
      COALESCE(NULLIF(TRIM(i.cause_code), ''), 'unknown'),
      LOWER(COALESCE(i.severity, 'medium'))
  `)
    .bind(startIso, endIso)
    .run();

  return {
    start_date: startKey,
    end_date: endKey,
    lookback_days: effectiveLookbackDays,
    used_backfill: !hasRows,
  };
}

export function buildExecutiveMetricDefinitions() {
  return {
    timezone: "UTC",
    metrics: EXECUTIVE_METRIC_DEFINITIONS,
    filters: [
      "start_date",
      "end_date",
      "site_id",
      "team_name",
      "technician_id",
    ],
  };
}

export function normalizeRgbHexColor(value, fallback) {
  const normalized = normalizeOptionalString(value, "").trim();
  if (!normalized) return fallback;
  const hex = normalized.startsWith("#") ? normalized : `#${normalized}`;
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return fallback;
  return hex.toLowerCase();
}
