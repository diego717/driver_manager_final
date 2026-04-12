import { nowIso } from "../lib/core.js";

export function createSystemRouteHandlers({ jsonResponse }) {
  function handleServiceMetadataRoute(request, env, corsPolicy, routeParts) {
    if (routeParts.length !== 0 || request.method !== "GET") {
      return null;
    }
    return jsonResponse(request, env, corsPolicy, {
      service: "driver-manager-api",
      status: "ok",
      docs: {
        health: "/health",
        web_login: "/web/auth/login",
        web_verify_password: "/web/auth/verify-password",
        web_bootstrap: "/web/auth/bootstrap",
        web_users: "/web/auth/users",
        web_user_update: "/web/auth/users/:user_id",
        web_user_delete: "/web/auth/users/:user_id",
        web_user_force_password: "/web/auth/users/:user_id/force-password",
        web_tenants: "/web/tenants",
        web_tenant_detail: "/web/tenants/:tenant_id",
        web_tenant_delete: "/web/tenants/:tenant_id",
        web_import_users: "/web/auth/import-users",
        installations: "/installations",
        web_installations: "/web/installations",
        web_assets: "/web/assets",
        web_assets_resolve: "/web/assets/resolve",
        web_asset_link: "/web/assets/:asset_id/link-installation",
        web_scan_asset_label: "/web/scan/asset-label",
        web_installation_budgets: "/web/installations/:installation_id/budgets",
        web_installation_budgets_latest: "/web/installations/:installation_id/budgets/latest",
        web_installation_budget_pdf: "/web/installations/:installation_id/budgets/:budget_id/pdf",
        web_installation_budget_approve: "/web/installations/:installation_id/budgets/:budget_id/approve",
        web_installation_conformity: "/web/installations/:installation_id/conformity",
        web_installation_conformity_pdf: "/web/installations/:installation_id/conformity/pdf?conformity_id=:id",
        web_incident_status: "/web/incidents/:incident_id/status",
        web_incident_evidence: "/web/incidents/:incident_id/evidence",
        web_installation_incident_status: "/web/installations/:installation_id/incidents/:incident_id/status",
        incident_evidence: "/incidents/:incident_id/evidence",
        web_drivers: "/web/drivers",
        web_drivers_upload: "/web/drivers",
        web_drivers_delete: "/web/drivers?key=drivers/default/Brand/Version/file.exe",
        web_drivers_download: "/web/drivers/download?key=drivers/default/Brand/Version/file.exe",
        web_devices: "/web/devices",
        web_lookup: "/web/lookup?type=asset&code=EQ-123",
        statistics_trend: "/statistics/trend?days=7",
        web_statistics_trend: "/web/statistics/trend?days=7",
        audit_logs: "/audit-logs",
        web_audit_logs: "/web/audit-logs",
        maintenance_cleanup_orphans: "/maintenance/cleanup-orphans",
        web_maintenance_cleanup_orphans: "/web/maintenance/cleanup-orphans",
      },
    });
  }

  function handleHealthCheckRoute(request, env, corsPolicy, routeParts) {
    if (routeParts.length !== 1 || routeParts[0] !== "health" || request.method !== "GET") {
      return null;
    }
    return jsonResponse(request, env, corsPolicy, { ok: true, now: nowIso() });
  }

  return {
    handleServiceMetadataRoute,
    handleHealthCheckRoute,
  };
}
