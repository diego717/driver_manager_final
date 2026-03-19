export function createRecordsRouteHandlers({
  jsonResponse,
  readJsonOrThrowBadRequest,
  requireWebWriteRole,
  normalizeRealtimeTenantId,
  normalizeInstallationPayload,
  buildDefaultInstallationOperationalSummary,
  publishRealtimeEvent,
  publishRealtimeStatsUpdate,
}) {
  async function handleRecordsRoute(
    request,
    env,
    corsPolicy,
    routeParts,
    isWebRoute,
    webSession,
    realtimeTenantId,
  ) {
    if (routeParts.length === 1 && routeParts[0] === "records" && request.method === "POST") {
      if (isWebRoute) {
        requireWebWriteRole(webSession?.role);
      }
      const recordsTenantId = normalizeRealtimeTenantId(
        isWebRoute ? webSession?.tenant_id : realtimeTenantId,
      );
      const data = await readJsonOrThrowBadRequest(request);
      const payload = normalizeInstallationPayload(data, "manual");

      if (!payload.driver_brand) payload.driver_brand = "N/A";
      if (!payload.driver_version) payload.driver_version = "N/A";
      if (!payload.driver_description) payload.driver_description = "Registro manual";
      if (!payload.client_name) payload.client_name = "Sin cliente";
      if (!payload.os_info) payload.os_info = "manual";

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
          recordsTenantId,
        )
        .run();
      const record = {
        id: insertResult?.meta?.last_row_id || null,
        tenant_id: recordsTenantId,
        ...payload,
        ...buildDefaultInstallationOperationalSummary(),
      };

      await publishRealtimeEvent(env, {
        type: "installation_created",
        installation: record,
      }, realtimeTenantId);
      await publishRealtimeStatsUpdate(env, realtimeTenantId);

      return jsonResponse(
        request,
        env,
        corsPolicy,
        {
          success: true,
          record,
        },
        201,
      );
    }

    return null;
  }

  return {
    handleRecordsRoute,
  };
}
