export function createMaintenanceRouteHandlers({
  jsonResponse,
  textResponse,
  readJsonOrThrowBadRequest,
  normalizeOptionalString,
  parseBooleanOrNull,
  normalizeRealtimeTenantId,
  requireAdminRole,
  assertSameTenantOrSuperAdmin,
  cleanupOrphanInstallationArtifacts,
  logAuditEvent,
  getClientIpForRateLimit,
}) {
  async function handleMaintenanceCleanupRoute(
    request,
    env,
    corsPolicy,
    routeParts,
    isWebRoute,
    webSession,
    realtimeTenantId,
  ) {
    if (routeParts.length === 2 && routeParts[0] === "maintenance" && routeParts[1] === "cleanup-orphans") {
      if (request.method !== "POST") {
        return textResponse(request, env, corsPolicy, "Ruta no encontrada.", 404);
      }

      if (isWebRoute) {
        requireAdminRole(webSession?.role);
      }

      const body = await readJsonOrThrowBadRequest(request);
      const requestedTenant = normalizeOptionalString(body?.tenant_id, "");
      const dryRunValue = parseBooleanOrNull(body?.dry_run);
      const dryRun = dryRunValue === null ? false : dryRunValue;
      const targetTenantId = requestedTenant
        ? normalizeRealtimeTenantId(requestedTenant)
        : normalizeRealtimeTenantId(realtimeTenantId);

      if (isWebRoute) {
        assertSameTenantOrSuperAdmin(webSession, targetTenantId);
      }

      const summary = await cleanupOrphanInstallationArtifacts(env, targetTenantId, {
        dryRun,
      });

      await logAuditEvent(env, {
        action: "maintenance_cleanup_orphans",
        username: webSession?.sub || "api",
        success: true,
        tenantId: targetTenantId,
        details: {
          tenant_id: targetTenantId,
          dry_run: dryRun,
          ...summary,
        },
        ipAddress: getClientIpForRateLimit(request),
        platform: isWebRoute ? "web" : "api",
      });

      return jsonResponse(request, env, corsPolicy, {
        success: true,
        message: dryRun
          ? "Simulacion de limpieza completada."
          : "Limpieza de huerfanos completada.",
        tenant_id: targetTenantId,
        dry_run: dryRun,
        summary,
      });
    }

    return null;
  }

  return {
    handleMaintenanceCleanupRoute,
  };
}
