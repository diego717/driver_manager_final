import {
  HttpError,
  addUtcDays,
  isMissingIncidentsTableError,
  normalizeOptionalString,
  normalizeRealtimeTenantId,
  parseDateOrNull,
  parseOptionalPositiveInt,
  startOfUtcDay,
  toUtcDayKey,
} from "../lib/core.js";

export function createStatisticsRouteHandlers({ jsonResponse, textResponse }) {
  async function handleStatisticsTrendRoute(
    request,
    env,
    url,
    corsPolicy,
    routeParts,
    isWebRoute,
    webSession,
    realtimeTenantId,
  ) {
    if (routeParts.length === 2 && routeParts[0] === "statistics" && routeParts[1] === "trend") {
      const statsTenantId = normalizeRealtimeTenantId(
        isWebRoute ? webSession?.tenant_id : realtimeTenantId,
      );
      if (request.method !== "GET") {
        return textResponse(request, env, corsPolicy, "Ruta no encontrada.", 404);
      }

      const requestedDays = parseOptionalPositiveInt(url.searchParams.get("days"), "days");
      const normalizedDays = requestedDays === null ? 7 : Math.min(Math.max(requestedDays, 1), 90);
      const startDateFilter = parseDateOrNull(url.searchParams.get("start_date"));
      const endDateFilter = parseDateOrNull(url.searchParams.get("end_date"));

      const endExclusive = endDateFilter
        ? startOfUtcDay(endDateFilter)
        : addUtcDays(startOfUtcDay(new Date()), 1);
      const startInclusive = startDateFilter
        ? startOfUtcDay(startDateFilter)
        : addUtcDays(endExclusive, -normalizedDays);

      if (startInclusive.getTime() >= endExclusive.getTime()) {
        throw new HttpError(400, "Rango de fechas invalido para trend.");
      }

      const { results: trendRows } = await env.DB.prepare(`
        SELECT
          substr(timestamp, 1, 10) AS day,
          COUNT(*) AS total_installations,
          SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) AS successful_installations,
          SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed_installations
        FROM installations
        WHERE tenant_id = ?
          AND timestamp >= ?
          AND timestamp < ?
        GROUP BY substr(timestamp, 1, 10)
        ORDER BY day ASC
      `)
        .bind(statsTenantId, startInclusive.toISOString(), endExclusive.toISOString())
        .all();

      const byDay = new Map();
      for (const row of trendRows || []) {
        const day = normalizeOptionalString(row?.day, "");
        if (!day) continue;
        byDay.set(day, {
          total_installations: Number(row?.total_installations) || 0,
          successful_installations: Number(row?.successful_installations) || 0,
          failed_installations: Number(row?.failed_installations) || 0,
        });
      }

      const points = [];
      for (
        let cursor = new Date(startInclusive.getTime());
        cursor.getTime() < endExclusive.getTime();
        cursor = addUtcDays(cursor, 1)
      ) {
        const key = toUtcDayKey(cursor);
        const values = byDay.get(key) || {
          total_installations: 0,
          successful_installations: 0,
          failed_installations: 0,
        };
        points.push({
          date: key,
          total_installations: values.total_installations,
          successful_installations: values.successful_installations,
          failed_installations: values.failed_installations,
        });
      }

      return jsonResponse(request, env, corsPolicy, {
        start_date: startInclusive.toISOString(),
        end_date: endExclusive.toISOString(),
        days: points.length,
        points,
      });
    }

    return null;
  }

  async function handleStatisticsRoute(
    request,
    env,
    url,
    corsPolicy,
    routeParts,
    isWebRoute,
    webSession,
    realtimeTenantId,
  ) {
    if (routeParts.length === 1 && routeParts[0] === "statistics") {
      const statsTenantId = normalizeRealtimeTenantId(
        isWebRoute ? webSession?.tenant_id : realtimeTenantId,
      );
      const startDate = parseDateOrNull(url.searchParams.get("start_date"));
      const endDate = parseDateOrNull(url.searchParams.get("end_date"));
      const startFilter = startDate ? startDate.toISOString() : null;
      const endFilter = endDate ? endDate.toISOString() : null;

      const { results: totalsRows } = await env.DB.prepare(`
        SELECT
          COUNT(*) AS total_installations,
          SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) AS successful_installations,
          SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed_installations,
          ROUND(
            100.0 * SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) / NULLIF(COUNT(*), 0),
            2
          ) AS success_rate,
          ROUND(
            AVG(CASE WHEN installation_time_seconds > 0 THEN installation_time_seconds END) / 60.0,
            2
          ) AS average_time_minutes,
          COUNT(DISTINCT NULLIF(TRIM(client_name), '')) AS unique_clients
        FROM installations
        WHERE tenant_id = ?
          AND (? IS NULL OR timestamp >= ?)
          AND (? IS NULL OR timestamp < ?)
      `)
        .bind(statsTenantId, startFilter, startFilter, endFilter, endFilter)
        .all();

      const { results: byBrandRows } = await env.DB.prepare(`
        SELECT driver_brand AS brand, COUNT(*) AS count
        FROM installations
        WHERE tenant_id = ?
          AND (? IS NULL OR timestamp >= ?)
          AND (? IS NULL OR timestamp < ?)
          AND NULLIF(TRIM(driver_brand), '') IS NOT NULL
        GROUP BY driver_brand
        ORDER BY count DESC
      `)
        .bind(statsTenantId, startFilter, startFilter, endFilter, endFilter)
        .all();

      const { results: topDriverRows } = await env.DB.prepare(`
        SELECT TRIM(driver_brand) AS brand, TRIM(driver_version) AS version, COUNT(*) AS count
        FROM installations
        WHERE tenant_id = ?
          AND (? IS NULL OR timestamp >= ?)
          AND (? IS NULL OR timestamp < ?)
          AND NULLIF(TRIM(driver_brand || ' ' || driver_version), '') IS NOT NULL
        GROUP BY TRIM(driver_brand), TRIM(driver_version)
        ORDER BY count DESC
      `)
        .bind(statsTenantId, startFilter, startFilter, endFilter, endFilter)
        .all();

      const rawSlaMinutes = Number.parseInt(String(env?.INCIDENT_SLA_MINUTES || ""), 10);
      const incidentSlaMinutes = Number.isInteger(rawSlaMinutes) && rawSlaMinutes > 0
        ? Math.min(rawSlaMinutes, 24 * 60)
        : 30;
      const outsideSlaCutoffIso = new Date(Date.now() - incidentSlaMinutes * 60 * 1000).toISOString();
      const outsideSlaCutoffSqlite = outsideSlaCutoffIso.replace('T', ' ').substring(0, 19);
      let incidentSummary = {
        incident_in_progress_count: 0,
        incident_critical_active_count: 0,
        incident_outside_sla_count: 0,
      };
      try {
        const { results: incidentSummaryRows } = await env.DB.prepare(`
          SELECT
            SUM(CASE WHEN LOWER(COALESCE(incident_status, 'open')) = 'in_progress' THEN 1 ELSE 0 END) AS incident_in_progress_count,
            SUM(CASE WHEN LOWER(COALESCE(incident_status, 'open')) IN ('open', 'in_progress', 'paused')
              AND LOWER(COALESCE(severity, '')) = 'critical' THEN 1 ELSE 0 END) AS incident_critical_active_count,
            SUM(CASE WHEN LOWER(COALESCE(incident_status, 'open')) IN ('open', 'in_progress', 'paused')
              AND COALESCE(created_at, '') < ? THEN 1 ELSE 0 END) AS incident_outside_sla_count
          FROM incidents
          WHERE tenant_id = ?
            AND deleted_at IS NULL
        `)
          .bind(outsideSlaCutoffSqlite, statsTenantId)
          .all();
        const row = incidentSummaryRows?.[0] || {};
        incidentSummary = {
          incident_in_progress_count: Number(row?.incident_in_progress_count) || 0,
          incident_critical_active_count: Number(row?.incident_critical_active_count) || 0,
          incident_outside_sla_count: Number(row?.incident_outside_sla_count) || 0,
        };
      } catch (error) {
        if (!isMissingIncidentsTableError(error)) {
          console.warn("[statistics] incident summary unavailable", { error: String(error) });
        }
      }

      const totals = totalsRows?.[0] || {};
      const byBrand = {};
      for (const row of byBrandRows || []) {
        const brand = normalizeOptionalString(row.brand, "");
        const count = Number(row.count);
        if (brand && Number.isFinite(count) && count > 0) {
          byBrand[brand] = count;
        }
      }

      const topDrivers = {};
      for (const row of topDriverRows || []) {
        const brand = normalizeOptionalString(row.brand, "");
        const version = normalizeOptionalString(row.version, "");
        const count = Number(row.count);
        const key = `${brand} ${version}`.trim();
        if (key && Number.isFinite(count) && count > 0) {
          topDrivers[key] = count;
        }
      }

      return jsonResponse(request, env, corsPolicy, {
        total_installations: Number(totals.total_installations) || 0,
        successful_installations: Number(totals.successful_installations) || 0,
        failed_installations: Number(totals.failed_installations) || 0,
        success_rate: Number(totals.success_rate) || 0,
        average_time_minutes: Number(totals.average_time_minutes) || 0,
        unique_clients: Number(totals.unique_clients) || 0,
        incident_in_progress_count: incidentSummary.incident_in_progress_count,
        incident_critical_active_count: incidentSummary.incident_critical_active_count,
        incident_outside_sla_count: incidentSummary.incident_outside_sla_count,
        incident_sla_minutes: incidentSlaMinutes,
        top_drivers: topDrivers,
        by_brand: byBrand,
      });
    }

    return null;
  }

  return {
    handleStatisticsTrendRoute,
    handleStatisticsRoute,
  };
}