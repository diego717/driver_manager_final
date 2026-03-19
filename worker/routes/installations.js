import { HttpError } from "../lib/core.js";

export function createInstallationsRouteHandlers({
  jsonResponse,
  textResponse,
  normalizeOptionalString,
  normalizeRealtimeTenantId,
  parseDateOrNull,
  parsePageLimit,
  parseTimestampIdCursor,
  buildTimestampIdCursor,
  appendPaginationHeader,
  loadInstallationOperationalSummaries,
  mapInstallationWithOperationalState,
  requireWebWriteRole,
  readJsonOrThrowBadRequest,
  normalizeInstallationPayload,
  buildDefaultInstallationOperationalSummary,
  logAuditEvent,
  getClientIpForRateLimit,
  publishRealtimeEvent,
  publishRealtimeStatsUpdate,
  parsePositiveInt,
  normalizeInstallationUpdatePayload,
  ensureInstallationExistsForDelete,
  listIncidentPhotoR2KeysForInstallation,
  deleteIncidentPhotoObjectsFromR2,
  deleteInstallationCascade,
}) {
  async function handleInstallationsRoute(
    request,
    env,
    url,
    corsPolicy,
    routeParts,
    isWebRoute,
    webSession,
    realtimeTenantId,
  ) {
    if (routeParts.length === 1 && routeParts[0] === "installations") {
      const installationsTenantId = normalizeRealtimeTenantId(
        isWebRoute ? webSession?.tenant_id : realtimeTenantId,
      );

      if (request.method === "GET") {
        const clientName = normalizeOptionalString(
          url.searchParams.get("client_name"),
          "",
        ).toLowerCase();
        const brand = normalizeOptionalString(url.searchParams.get("brand"), "").toLowerCase();
        const status = normalizeOptionalString(url.searchParams.get("status"), "").toLowerCase();
        const startDate = parseDateOrNull(url.searchParams.get("start_date"));
        const endDate = parseDateOrNull(url.searchParams.get("end_date"));
        const limit = parsePageLimit(url.searchParams, { fallback: 100, max: 500 });
        const cursor = parseTimestampIdCursor(url.searchParams.get("cursor"));
        const pageSize = limit + 1;

        let query = "SELECT * FROM installations WHERE tenant_id = ?";
        const bindings = [installationsTenantId];

        if (clientName) {
          query += " AND LOWER(COALESCE(client_name, '')) LIKE ?";
          bindings.push(`%${clientName}%`);
        }
        if (brand) {
          query += " AND LOWER(COALESCE(driver_brand, '')) = ?";
          bindings.push(brand);
        }
        if (status) {
          query += " AND LOWER(COALESCE(status, '')) = ?";
          bindings.push(status);
        }
        if (startDate) {
          query += " AND timestamp >= ?";
          bindings.push(startDate.toISOString());
        }
        if (endDate) {
          query += " AND timestamp < ?";
          bindings.push(endDate.toISOString());
        }
        if (cursor) {
          query += " AND (timestamp < ? OR (timestamp = ? AND id < ?))";
          bindings.push(cursor.timestamp, cursor.timestamp, cursor.id);
        }

        query += " ORDER BY timestamp DESC, id DESC LIMIT ?";
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

        const operationalSummary = await loadInstallationOperationalSummaries(
          env,
          items.map((row) => row?.id),
          installationsTenantId,
        );
        const enrichedItems = items.map((item) =>
          mapInstallationWithOperationalState(item, operationalSummary),
        );

        const response = jsonResponse(request, env, corsPolicy, enrichedItems);
        appendPaginationHeader(response, nextCursor);
        return response;
      }

      if (request.method === "POST") {
        if (isWebRoute) {
          requireWebWriteRole(webSession?.role);
        }
        const data = await readJsonOrThrowBadRequest(request);
        const payload = normalizeInstallationPayload(data, "unknown");

        const insertResult = await env.DB.prepare(`
          INSERT INTO installations (
            timestamp,
            driver_brand,
            driver_version,
            status,
            client_name,
            driver_description,
            installation_time_seconds,
            os_info,
            notes,
            tenant_id
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
          .bind(
            payload.timestamp,
            payload.driver_brand,
            payload.driver_version,
            payload.status,
            payload.client_name,
            payload.driver_description,
            payload.installation_time_seconds,
            payload.os_info,
            payload.notes,
            installationsTenantId,
          )
          .run();
        const installationId = insertResult?.meta?.last_row_id || null;
        const installationEventPayload = {
          id: installationId,
          tenant_id: installationsTenantId,
          ...payload,
          ...buildDefaultInstallationOperationalSummary(),
        };

        await logAuditEvent(env, {
          action: "installation_created",
          username: webSession?.sub || "api",
          success: true,
          tenantId: installationsTenantId,
          details: {
            driver_brand: payload.driver_brand,
            driver_version: payload.driver_version,
            status: payload.status,
            client_name: payload.client_name,
            tenant_id: installationsTenantId,
          },
          ipAddress: getClientIpForRateLimit(request),
          platform: isWebRoute ? "web" : "api",
        });

        await publishRealtimeEvent(env, {
          type: "installation_created",
          installation: installationEventPayload,
        }, realtimeTenantId);
        await publishRealtimeStatsUpdate(env, realtimeTenantId);

        return jsonResponse(request, env, corsPolicy, { success: true }, 201);
      }
    }

    return null;
  }

  async function handleInstallationByIdRoute(
    request,
    env,
    corsPolicy,
    routeParts,
    isWebRoute,
    webSession,
    realtimeTenantId,
  ) {
    if (routeParts.length === 2 && routeParts[0] === "installations") {
      const installationsTenantId = normalizeRealtimeTenantId(
        isWebRoute ? webSession?.tenant_id : realtimeTenantId,
      );
      const recordId = routeParts[1];

      if (request.method === "GET") {
        const installationId = parsePositiveInt(recordId, "id");
        const { results } = await env.DB.prepare(
          "SELECT * FROM installations WHERE id = ? AND tenant_id = ? LIMIT 1",
        )
          .bind(installationId, installationsTenantId)
          .all();

        if (!results?.length) {
          throw new HttpError(404, "Registro no encontrado.");
        }

        const summaryById = await loadInstallationOperationalSummaries(
          env,
          [installationId],
          installationsTenantId,
        );
        const enrichedRecord = mapInstallationWithOperationalState(results[0], summaryById);

        return jsonResponse(request, env, corsPolicy, enrichedRecord);
      }

      if (request.method === "PUT") {
        if (isWebRoute) {
          requireWebWriteRole(webSession?.role);
        }
        const installationId = parsePositiveInt(recordId, "id");
        const data = await readJsonOrThrowBadRequest(request);
        const payload = normalizeInstallationUpdatePayload(data);
        const updateResult = await env.DB.prepare(`
          UPDATE installations
          SET notes = ?, installation_time_seconds = ?
          WHERE id = ?
            AND tenant_id = ?
        `)
          .bind(payload.notes, payload.installation_time_seconds, installationId, installationsTenantId)
          .run();

        if (!Number(updateResult?.meta?.changes || 0)) {
          throw new HttpError(404, "Registro no encontrado.");
        }

        await publishRealtimeEvent(env, {
          type: "installation_updated",
          installation: {
            id: installationId,
            notes: payload.notes,
            installation_time_seconds: payload.installation_time_seconds,
          },
        }, realtimeTenantId);
        await publishRealtimeStatsUpdate(env, realtimeTenantId);

        return jsonResponse(request, env, corsPolicy, { success: true, updated: String(installationId) });
      }

      if (request.method === "DELETE") {
        if (isWebRoute) {
          requireWebWriteRole(webSession?.role);
        }
        if (!recordId) {
          return textResponse(request, env, corsPolicy, "Error: El ID del registro es obligatorio.", 400);
        }

        const installationId = parsePositiveInt(recordId, "id");
        const normalizedTenantId = installationsTenantId;
        const installationExists = await ensureInstallationExistsForDelete(
          env,
          installationId,
          normalizedTenantId,
        );
        if (!installationExists) {
          throw new HttpError(404, "Registro no encontrado.");
        }

        const incidentPhotoKeys = await listIncidentPhotoR2KeysForInstallation(
          env,
          installationId,
          normalizedTenantId,
        );
        await deleteIncidentPhotoObjectsFromR2(env, incidentPhotoKeys);

        await logAuditEvent(env, {
          action: "installation_deleted",
          username: webSession?.sub || "api",
          success: true,
          tenantId: normalizedTenantId,
          details: {
            deleted_id: installationId,
            deleted_incident_photos: incidentPhotoKeys.length,
            tenant_id: normalizedTenantId,
          },
          ipAddress: getClientIpForRateLimit(request),
          platform: isWebRoute ? "web" : "api",
        });

        await deleteInstallationCascade(env, installationId, normalizedTenantId);
        await publishRealtimeEvent(env, {
          type: "installation_deleted",
          installation: {
            id: installationId,
          },
        }, realtimeTenantId);
        await publishRealtimeStatsUpdate(env, realtimeTenantId);
        return jsonResponse(request, env, corsPolicy, { message: `Registro ${installationId} eliminado.` });
      }
    }

    return null;
  }

  return {
    handleInstallationsRoute,
    handleInstallationByIdRoute,
  };
}
