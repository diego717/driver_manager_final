import { HttpError, normalizeOptionalString, normalizeRealtimeTenantId } from "../lib/core.js";

export function createAuditLogsRouteHandlers({
  jsonResponse,
  readJsonOrThrowBadRequest,
  requireAdminRole,
  normalizeWebUsername,
  logAuditEvent,
  parsePageLimit,
  parseTimestampIdCursor,
  buildTimestampIdCursor,
  appendPaginationHeader,
}) {
  async function handleAuditLogsRoute(
    request,
    env,
    url,
    corsPolicy,
    routeParts,
    isWebRoute,
    webSession,
    realtimeTenantId,
  ) {
    if (routeParts.length === 1 && routeParts[0] === "audit-logs") {
      const auditTenantId = normalizeRealtimeTenantId(
        isWebRoute ? webSession?.tenant_id : realtimeTenantId,
      );

      if (request.method === "POST") {
        if (isWebRoute) {
          requireAdminRole(webSession?.role);
        }

        const data = await readJsonOrThrowBadRequest(request);
        const action = normalizeOptionalString(data?.action, "");
        const payloadUsername = normalizeOptionalString(data?.username, "");
        const username = isWebRoute
          ? normalizeWebUsername(webSession?.sub || "unknown")
          : payloadUsername;

        if (!action) {
          throw new HttpError(400, "Campo 'action' es obligatorio.");
        }
        if (!username) {
          throw new HttpError(400, "Campo 'username' es obligatorio.");
        }

        const rawDetails =
          data && typeof data.details === "object" && data.details !== null ? data.details : {};
        await logAuditEvent(
          env,
          {
            timestamp: data?.timestamp,
            action,
            username,
            success: Boolean(data?.success),
            tenantId: auditTenantId,
            details: rawDetails,
            computerName: data?.computer_name,
            ipAddress: data?.ip_address,
            platform: data?.platform,
          },
          { swallowErrors: false },
        );

        return jsonResponse(request, env, corsPolicy, { success: true }, 201);
      }

      if (request.method === "GET") {
        if (isWebRoute) {
          requireAdminRole(webSession?.role);
        }

        const limit = parsePageLimit(url.searchParams, { fallback: 100, max: 500 });
        const cursor = parseTimestampIdCursor(url.searchParams.get("cursor"));
        const pageSize = limit + 1;

        let query = `
          SELECT id, timestamp, action, username, success, details, computer_name, ip_address, platform
          FROM audit_logs
          WHERE tenant_id = ?
        `;
        const bindings = [auditTenantId];
        if (cursor) {
          query += " AND (timestamp < ? OR (timestamp = ? AND id < ?))";
          bindings.push(cursor.timestamp, cursor.timestamp, cursor.id);
        }
        query += `
          ORDER BY timestamp DESC, id DESC
          LIMIT ?
        `;
        bindings.push(pageSize);

        const { results } = await env.DB.prepare(query).bind(...bindings).all();
        const rows = results || [];
        const hasMore = rows.length > limit;
        const items = hasMore ? rows.slice(0, limit) : rows;
        const nextCursor = hasMore
          ? buildTimestampIdCursor(
              items[items.length - 1].timestamp,
              items[items.length - 1].id,
            )
          : null;

        const response = jsonResponse(request, env, corsPolicy, items);
        appendPaginationHeader(response, nextCursor);
        return response;
      }
    }

    return null;
  }

  return {
    handleAuditLogsRoute,
  };
}
