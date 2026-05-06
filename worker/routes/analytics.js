import {
  HttpError,
  addUtcDays,
  canReadOperationalData,
  normalizeOptionalString,
  normalizeRealtimeTenantId,
  parseDateOrNull,
  parseOptionalPositiveInt,
  startOfUtcDay,
  toUtcDayKey,
} from "../lib/core.js";
import { buildExecutiveMetricDefinitions, refreshIncidentKpiDaily } from "../services/analytics.js";

function sumBy(rows, key) {
  return (rows || []).reduce((acc, row) => acc + (Number(row?.[key] || 0) || 0), 0);
}

function toPercent(numerator, denominator) {
  if (!Number.isFinite(denominator) || denominator <= 0) return 0;
  return Number(((Number(numerator || 0) / denominator) * 100).toFixed(2));
}

function buildExecutiveFilters(url) {
  const startDateRaw = parseDateOrNull(url.searchParams.get("start_date"));
  const endDateRaw = parseDateOrNull(url.searchParams.get("end_date"));
  const todayStart = startOfUtcDay(new Date());
  const defaultEndExclusive = addUtcDays(todayStart, 1);
  const startInclusive = startDateRaw ? startOfUtcDay(startDateRaw) : addUtcDays(defaultEndExclusive, -30);
  const endExclusive = endDateRaw ? addUtcDays(startOfUtcDay(endDateRaw), 1) : defaultEndExclusive;

  if (startInclusive.getTime() >= endExclusive.getTime()) {
    throw new HttpError(400, "Rango de fechas invalido.");
  }

  const siteId = parseOptionalPositiveInt(url.searchParams.get("site_id"), "site_id");
  const technicianId = parseOptionalPositiveInt(
    url.searchParams.get("technician_id"),
    "technician_id",
  );
  const teamName = normalizeOptionalString(url.searchParams.get("team_name"), "")
    .trim()
    .slice(0, 120);

  return {
    startInclusive,
    endExclusive,
    startDateKey: toUtcDayKey(startInclusive),
    endDateKey: toUtcDayKey(endExclusive),
    startIso: startInclusive.toISOString(),
    endIso: endExclusive.toISOString(),
    siteId,
    technicianId,
    teamName,
  };
}

function buildDailyWhere(filters, tenantId) {
  const where = [
    "d.tenant_id = ?",
    "d.day >= ?",
    "d.day < ?",
  ];
  const bindings = [tenantId, filters.startDateKey, filters.endDateKey];

  if (filters.siteId !== null) {
    where.push("d.site_id = ?");
    bindings.push(filters.siteId);
  }
  if (filters.technicianId !== null) {
    where.push("d.technician_id = ?");
    bindings.push(filters.technicianId);
  }
  if (filters.teamName) {
    where.push("LOWER(COALESCE(d.team_name, '')) = ?");
    bindings.push(filters.teamName.toLowerCase());
  }

  return {
    sql: where.join("\n      AND "),
    bindings,
  };
}

function buildIncidentWhere(filters, tenantId) {
  const where = [
    "i.tenant_id = ?",
    "i.deleted_at IS NULL",
    "i.created_at >= ?",
    "i.created_at < ?",
  ];
  const bindings = [tenantId, filters.startIso, filters.endIso];

  if (filters.siteId !== null) {
    where.push("i.site_id = ?");
    bindings.push(filters.siteId);
  }
  if (filters.technicianId !== null) {
    where.push("t.id = ?");
    bindings.push(filters.technicianId);
  }
  if (filters.teamName) {
    where.push("LOWER(COALESCE(t.team_name, '')) = ?");
    bindings.push(filters.teamName.toLowerCase());
  }

  return {
    sql: where.join("\n      AND "),
    bindings,
  };
}

function normalizeRecurrenceRows(rows, fieldName, labelField = null, maxItems = 8) {
  const normalizedRows = (rows || [])
    .map((row) => ({
      key: row?.[fieldName] ?? null,
      label: labelField ? normalizeOptionalString(row?.[labelField], "") : "",
      incidents: Number(row?.incidents || 0),
    }))
    .filter((row) => row.key !== null && row.key !== undefined && row.incidents > 0);

  const repeatedGroups = normalizedRows.length;
  const repeatedTickets = sumBy(normalizedRows, "incidents");
  return {
    repeated_groups: repeatedGroups,
    repeated_tickets: repeatedTickets,
    top: normalizedRows.slice(0, maxItems),
  };
}

function isAnalyticsSchemaMismatchError(error) {
  const message = normalizeOptionalString(error?.message, "").toLowerCase();
  if (!message) return false;

  if (message.includes("no such table")) {
    return (
      message.includes("incident_kpi_daily") ||
      message.includes("tenant_sites") ||
      message.includes("incident_categories") ||
      message.includes("incident_causes") ||
      message.includes("tenant_sla_policies") ||
      message.includes("technicians") ||
      message.includes("audit_logs")
    );
  }

  if (message.includes("no such column") || message.includes("has no column named")) {
    return (
      message.includes("site_id") ||
      message.includes("category_code") ||
      message.includes("cause_code") ||
      message.includes("team_name") ||
      message.includes("actual_duration_seconds") ||
      message.includes("resolved_by") ||
      message.includes("severity") ||
      message.includes("details") ||
      message.includes("timestamp")
    );
  }

  return false;
}

export function createAnalyticsRouteHandlers({
  jsonResponse,
}) {
  async function handleAnalyticsRoute(
    request,
    env,
    url,
    corsPolicy,
    routeParts,
    isWebRoute,
    webSession,
    realtimeTenantId,
  ) {
    if (!routeParts.length || routeParts[0] !== "analytics") {
      return null;
    }
    if (!isWebRoute) {
      throw new HttpError(405, "Ruta disponible solo en /web.");
    }
    if (!canReadOperationalData(webSession?.role)) {
      throw new HttpError(403, "No tienes permisos para ver analitica ejecutiva.");
    }

    const analyticsTenantId = normalizeRealtimeTenantId(
      isWebRoute ? webSession?.tenant_id : realtimeTenantId,
    );

    if (
      routeParts.length === 2 &&
      routeParts[1] === "definitions" &&
      request.method === "GET"
    ) {
      return jsonResponse(request, env, corsPolicy, {
        success: true,
        ...buildExecutiveMetricDefinitions(),
      });
    }

    if (
      routeParts.length === 2 &&
      routeParts[1] === "executive" &&
      request.method === "GET"
    ) {
      try {
        const filters = buildExecutiveFilters(url);
        const { results: existingAggregateRows } = await env.DB.prepare(`
        SELECT COUNT(*) AS total
        FROM incident_kpi_daily
        WHERE tenant_id = ?
          AND day >= ?
          AND day < ?
      `)
          .bind(analyticsTenantId, filters.startDateKey, filters.endDateKey)
          .all();
        if (Number(existingAggregateRows?.[0]?.total || 0) === 0) {
          try {
            await refreshIncidentKpiDaily(env, {
              lookbackDays: 120,
              backfillDays: 365,
            });
          } catch (refreshError) {
            if (!isAnalyticsSchemaMismatchError(refreshError)) {
              throw refreshError;
            }
            // Keep serving the dashboard (likely zeros for the selected range) even if refresh
            // cannot run on a partially migrated schema.
            console.warn("[analytics] incident_kpi_daily refresh skipped due to schema mismatch", {
              tenant_id: analyticsTenantId,
              message: normalizeOptionalString(refreshError?.message, "unknown"),
            });
          }
        }
        const dailyWhere = buildDailyWhere(filters, analyticsTenantId);
        const incidentWhere = buildIncidentWhere(filters, analyticsTenantId);

        const { results: summaryRows } = await env.DB.prepare(`
        SELECT
          COALESCE(SUM(d.resolved_count), 0) AS resolved_total,
          COALESCE(SUM(d.mttr_seconds_sum), 0) AS mttr_seconds_sum,
          COALESCE(SUM(d.sla_on_time_count), 0) AS sla_on_time_count,
          COALESCE(SUM(d.sla_late_count), 0) AS sla_late_count,
          COALESCE(SUM(d.fcr_count), 0) AS fcr_count
        FROM incident_kpi_daily d
        WHERE ${dailyWhere.sql}
      `)
        .bind(...dailyWhere.bindings)
        .all();
        const summary = summaryRows?.[0] || {};
        const resolvedTotal = Number(summary?.resolved_total || 0);
        const mttrSecondsSum = Number(summary?.mttr_seconds_sum || 0);
        const onTimeCount = Number(summary?.sla_on_time_count || 0);
        const lateCount = Number(summary?.sla_late_count || 0);
        const fcrCount = Number(summary?.fcr_count || 0);

      const { results: productivityRows } = await env.DB.prepare(`
        SELECT
          d.technician_id,
          COALESCE(NULLIF(TRIM(t.display_name), ''), NULLIF(TRIM(wu.username), ''), 'Sin tecnico') AS technician_label,
          COALESCE(NULLIF(TRIM(t.team_name), ''), '') AS team_name,
          COALESCE(SUM(d.resolved_count), 0) AS closed_tickets,
          COALESCE(SUM(d.fcr_count), 0) AS fcr_hits
        FROM incident_kpi_daily d
        LEFT JOIN technicians t
          ON t.tenant_id = d.tenant_id
         AND t.id = d.technician_id
        LEFT JOIN web_users wu
          ON wu.tenant_id = d.tenant_id
         AND wu.id = t.web_user_id
        WHERE ${dailyWhere.sql}
        GROUP BY d.technician_id, technician_label, team_name
        ORDER BY closed_tickets DESC, technician_label ASC
        LIMIT 20
      `)
        .bind(...dailyWhere.bindings)
        .all();
      const productivity = (productivityRows || []).map((row) => {
        const closedTickets = Number(row?.closed_tickets || 0);
        const fcrHits = Number(row?.fcr_hits || 0);
        return {
          technician_id: Number(row?.technician_id || -1),
          technician_label: normalizeOptionalString(row?.technician_label, "Sin tecnico"),
          team_name: normalizeOptionalString(row?.team_name, ""),
          closed_tickets: closedTickets,
          fcr_pct: toPercent(fcrHits, closedTickets),
        };
      });

      const { results: topCauseRows } = await env.DB.prepare(`
        SELECT
          d.cause_code,
          COALESCE(
            (
              SELECT c.label
              FROM incident_causes c
              WHERE c.tenant_id = d.tenant_id
                AND c.cause_code = d.cause_code
              LIMIT 1
            ),
            (
              SELECT c2.label
              FROM incident_causes c2
              WHERE c2.tenant_id IS NULL
                AND c2.cause_code = d.cause_code
              LIMIT 1
            ),
            d.cause_code
          ) AS cause_label,
          COALESCE(SUM(d.resolved_count), 0) AS incidents
        FROM incident_kpi_daily d
        WHERE ${dailyWhere.sql}
        GROUP BY d.cause_code, cause_label
        ORDER BY incidents DESC, d.cause_code ASC
        LIMIT 10
      `)
        .bind(...dailyWhere.bindings)
        .all();
      const topCauses = (topCauseRows || []).map((row) => ({
        cause_code: normalizeOptionalString(row?.cause_code, "unknown"),
        cause_label: normalizeOptionalString(row?.cause_label, "No especificada"),
        incidents: Number(row?.incidents || 0),
      }));

      const { results: trendRows } = await env.DB.prepare(`
        SELECT
          d.day,
          COALESCE(SUM(d.resolved_count), 0) AS resolved_count,
          COALESCE(SUM(d.sla_on_time_count), 0) AS sla_on_time_count,
          COALESCE(SUM(d.sla_late_count), 0) AS sla_late_count,
          COALESCE(SUM(d.mttr_seconds_sum), 0) AS mttr_seconds_sum
        FROM incident_kpi_daily d
        WHERE ${dailyWhere.sql}
        GROUP BY d.day
        ORDER BY d.day ASC
      `)
        .bind(...dailyWhere.bindings)
        .all();
      const trend = (trendRows || []).map((row) => {
        const resolvedCount = Number(row?.resolved_count || 0);
        const mttrSeconds = Number(row?.mttr_seconds_sum || 0);
        return {
          day: normalizeOptionalString(row?.day, ""),
          resolved_count: resolvedCount,
          sla_on_time_pct: toPercent(Number(row?.sla_on_time_count || 0), resolvedCount),
          sla_late_pct: toPercent(Number(row?.sla_late_count || 0), resolvedCount),
          mttr_minutes: resolvedCount > 0
            ? Number(((mttrSeconds / resolvedCount) / 60).toFixed(2))
            : 0,
        };
      });

      const recurrenceJoins = `
        FROM incidents i
        LEFT JOIN web_users wu
          ON wu.tenant_id = i.tenant_id
         AND LOWER(COALESCE(wu.username, '')) = LOWER(COALESCE(i.resolved_by, ''))
        LEFT JOIN technicians t
          ON t.tenant_id = i.tenant_id
         AND t.web_user_id = wu.id
      `;

      const { results: assetRecurrenceRows } = await env.DB.prepare(`
        SELECT
          i.asset_id AS asset_id,
          COUNT(*) AS incidents
        ${recurrenceJoins}
        WHERE ${incidentWhere.sql}
          AND i.asset_id IS NOT NULL
        GROUP BY i.asset_id
        HAVING COUNT(*) > 1
        ORDER BY incidents DESC, i.asset_id ASC
        LIMIT 10
      `)
        .bind(...incidentWhere.bindings)
        .all();

      const { results: siteRecurrenceRows } = await env.DB.prepare(`
        SELECT
          i.site_id AS site_id,
          COALESCE(NULLIF(TRIM(s.name), ''), 'Sede sin nombre') AS site_name,
          COUNT(*) AS incidents
        ${recurrenceJoins}
        LEFT JOIN tenant_sites s
          ON s.tenant_id = i.tenant_id
         AND s.id = i.site_id
        WHERE ${incidentWhere.sql}
          AND i.site_id IS NOT NULL
        GROUP BY i.site_id, site_name
        HAVING COUNT(*) > 1
        ORDER BY incidents DESC, i.site_id ASC
        LIMIT 10
      `)
        .bind(...incidentWhere.bindings)
        .all();

      const { results: categoryRecurrenceRows } = await env.DB.prepare(`
        SELECT
          COALESCE(NULLIF(TRIM(i.category_code), ''), 'uncategorized') AS category_code,
          COALESCE(
            (
              SELECT c.label
              FROM incident_categories c
              WHERE c.tenant_id = i.tenant_id
                AND c.category_code = COALESCE(NULLIF(TRIM(i.category_code), ''), 'uncategorized')
              LIMIT 1
            ),
            (
              SELECT c2.label
              FROM incident_categories c2
              WHERE c2.tenant_id IS NULL
                AND c2.category_code = COALESCE(NULLIF(TRIM(i.category_code), ''), 'uncategorized')
              LIMIT 1
            ),
            COALESCE(NULLIF(TRIM(i.category_code), ''), 'uncategorized')
          ) AS category_label,
          COUNT(*) AS incidents
        ${recurrenceJoins}
        WHERE ${incidentWhere.sql}
        GROUP BY category_code, category_label
        HAVING COUNT(*) > 1
        ORDER BY incidents DESC, category_code ASC
        LIMIT 10
      `)
        .bind(...incidentWhere.bindings)
        .all();

      const { results: siteOptionsRows } = await env.DB.prepare(`
        SELECT id, code, name
        FROM tenant_sites
        WHERE tenant_id = ?
          AND is_active = 1
        ORDER BY name ASC, id ASC
      `)
        .bind(analyticsTenantId)
        .all();
      const { results: teamOptionsRows } = await env.DB.prepare(`
        SELECT DISTINCT team_name
        FROM technicians
        WHERE tenant_id = ?
          AND is_active = 1
          AND NULLIF(TRIM(team_name), '') IS NOT NULL
        ORDER BY LOWER(team_name) ASC
      `)
        .bind(analyticsTenantId)
        .all();
      const { results: technicianOptionsRows } = await env.DB.prepare(`
        SELECT id, display_name, team_name
        FROM technicians
        WHERE tenant_id = ?
          AND is_active = 1
        ORDER BY LOWER(display_name) ASC, id ASC
      `)
        .bind(analyticsTenantId)
        .all();

        return jsonResponse(request, env, corsPolicy, {
        success: true,
        filters: {
          start_date: filters.startInclusive.toISOString(),
          end_date: filters.endExclusive.toISOString(),
          site_id: filters.siteId,
          team_name: filters.teamName || null,
          technician_id: filters.technicianId,
        },
        kpis: {
          mttr_minutes: resolvedTotal > 0
            ? Number(((mttrSecondsSum / resolvedTotal) / 60).toFixed(2))
            : 0,
          sla_on_time_pct: toPercent(onTimeCount, resolvedTotal),
          sla_late_pct: toPercent(lateCount, resolvedTotal),
          fcr_pct: toPercent(fcrCount, resolvedTotal),
          resolved_tickets: resolvedTotal,
        },
        reincidence: {
          by_asset: normalizeRecurrenceRows(assetRecurrenceRows, "asset_id"),
          by_site: normalizeRecurrenceRows(siteRecurrenceRows, "site_id", "site_name"),
          by_category: normalizeRecurrenceRows(
            categoryRecurrenceRows,
            "category_code",
            "category_label",
          ),
        },
        productivity_by_technician: productivity,
        top_causes: topCauses,
        trend,
        filter_options: {
          sites: (siteOptionsRows || []).map((row) => ({
            id: Number(row?.id || 0),
            code: normalizeOptionalString(row?.code, ""),
            name: normalizeOptionalString(row?.name, ""),
          })),
          teams: (teamOptionsRows || []).map((row) => normalizeOptionalString(row?.team_name, "")),
          technicians: (technicianOptionsRows || []).map((row) => ({
            id: Number(row?.id || 0),
            display_name: normalizeOptionalString(row?.display_name, ""),
            team_name: normalizeOptionalString(row?.team_name, ""),
          })),
        },
        });
      } catch (error) {
        if (isAnalyticsSchemaMismatchError(error)) {
          throw new HttpError(
            503,
            "Falta esquema de analitica ejecutiva en D1. Ejecuta migraciones recientes (incluyendo 0028_tenant_branding_executive_analytics.sql).",
          );
        }
        throw error;
      }
    }

    return null;
  }

  return {
    handleAnalyticsRoute,
  };
}
