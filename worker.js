import {
  addUtcDays,
  DEFAULT_REALTIME_TENANT_ID,
  HttpError,
  isMissingAssetsTableError,
  isMissingIncidentAssetColumnError,
  isMissingIncidentGeofenceOverrideColumnsError,
  isMissingIncidentTimingColumnsError,
  isMissingIncidentsTableError,
  normalizeOptionalString,
  normalizeRealtimeTenantId,
  nowIso,
  parseDateOrNull,
  parseOptionalPositiveInt,
  startOfUtcDay,
  toUtcDayKey,
} from "./worker/lib/core.js";
import {
  appendPaginationHeader,
  buildTimestampIdCursor,
  buildUsernameIdCursor,
  parsePageLimit,
  parseTimestampIdCursor,
  parseUsernameIdCursor,
} from "./worker/lib/pagination.js";
import {
  applyNoStoreHeaders,
  appendVaryHeader,
  buildCorsPolicy,
  corsHeaders,
  errorCodeFromHttpStatus,
  jsonResponse,
  setHeaderWithVaryMerge,
  textResponse,
} from "./worker/lib/http.js";
import { createAuthSecurityHelpers } from "./worker/auth/security.js";
import { createLegacyAuthHelpers } from "./worker/auth/legacy.js";
import { createWebUserAuthHelpers } from "./worker/auth/users.js";
import { createWebAuthRouteHandlers } from "./worker/auth/web.js";
import { createWebSessionHelpers } from "./worker/auth/web-session.js";
import { createAuditLogsRouteHandlers } from "./worker/routes/audit-logs.js";
import { createDevicesRouteHandlers } from "./worker/routes/devices.js";
import { createConformitiesRouteHandlers } from "./worker/routes/conformities.js";
import { createIncidentsRouteHandlers } from "./worker/routes/incidents.js";
import { createInstallationsRouteHandlers } from "./worker/routes/installations.js";
import { createLookupRouteHandlers } from "./worker/routes/lookup.js";
import { createMaintenanceRouteHandlers } from "./worker/routes/maintenance.js";
import { createRecordsRouteHandlers } from "./worker/routes/records.js";
import { createStatisticsRouteHandlers } from "./worker/routes/statistics.js";
import { createSystemRouteHandlers } from "./worker/routes/system.js";
import { createPublicTrackingRouteHandlers } from "./worker/routes/public-tracking.js";
import {
  ALLOWED_INCIDENT_PHOTO_TYPES,
  buildIncidentPhotoDescriptor,
  buildIncidentPhotoFileName,
  buildIncidentR2Key,
  extensionFromType,
  loadIncidentByIdForTenant,
  loadIncidentForTenant,
  loadIncidentPhotoByIdForTenant,
  recoverIncidentPhotosFromStorageForTenant,
  loadIncidentTimingFieldsForTenant,
  requireIncidentsBucketOperation,
  resolveIncidentPhotoMetadata,
  validateAndProcessPhoto,
} from "./worker/services/incidents.js";
import {
  buildGpsMapsUrl,
  buildGpsMetadataSnapshot,
  buildDefaultGpsSnapshot,
  gpsBindValues,
  normalizeGpsPayload,
} from "./worker/lib/gps.js";
import {
  GPS_OBSERVABILITY_AUDIT_ACTIONS,
  createEmptyGpsObservabilitySummary,
  summarizeGpsObservability,
} from "./worker/lib/gps-observability.js";
import {
  getActivePublicTrackingLink,
  issuePublicTrackingLink,
  publicTrackingHeaders,
  resolvePublicTrackingOrigin,
  syncPublicTrackingSnapshotForInstallation,
  renderPublicTrackingHtml,
  resolvePublicTrackingRequest,
  revokePublicTrackingLink,
} from "./worker/lib/public-tracking.js";
import {
  buildDefaultGeofenceSnapshot,
  evaluateGeofence,
  GEOFENCE_FLOW_INCIDENTS,
  resolveHardGeofenceOverride,
  normalizeInstallationSitePayload,
} from "./worker/lib/geofence.js";
import {
  generateConformityPdf,
  loadInstallationConformityContext,
  loadInstallationConformityPdfById,
  loadLatestInstallationConformity,
  persistInstallationConformity,
  sendConformityEmail,
  storeConformityPdf,
  storeSignatureAsset,
} from "./worker/services/conformities.js";

const AUTH_WINDOW_SECONDS = 300;
const AUTH_NONCE_TTL_SECONDS = AUTH_WINDOW_SECONDS + 60;
const AUTH_NONCE_MAX_LENGTH = 128;
const AUTH_NONCE_PATTERN = /^[A-Za-z0-9._:-]{16,128}$/;
const MAX_AUTH_INMEM_BODY_HASH_BYTES = 256 * 1024;
const MAX_AUTH_INMEM_NONCE_TRACKED = 5000;
const EMPTY_BODY_SHA256_HEX = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
const WEB_ACCESS_TTL_SECONDS = 8 * 60 * 60;
const WEB_SESSION_COOKIE_NAME = "__Host-web_session";
const WEB_SESSION_STORE_TTL_SECONDS = WEB_ACCESS_TTL_SECONDS + 60;
const WEB_LOGIN_RATE_LIMIT_MAX_ATTEMPTS = 5;
const WEB_LOGIN_RATE_LIMIT_LOCKOUT_SECONDS = 15 * 60;
const WEB_PASSWORD_VERIFY_RATE_LIMIT_MAX_ATTEMPTS = 8;
const WEB_PASSWORD_VERIFY_RATE_LIMIT_LOCKOUT_SECONDS = 10 * 60;
const MAX_WEB_AUTH_DEFAULT_BODY_BYTES = 64 * 1024;
const MAX_WEB_AUTH_IMPORT_BODY_BYTES = 2 * 1024 * 1024;
const MAX_JSON_BODY_DEFAULT_BYTES = 64 * 1024;
const WEB_PASSWORD_MIN_LENGTH = 12;
const WEB_PASSWORD_SPECIAL_CHARS = "!@#$%^&*()_+-=[]{}|;:,.<>?";
const WEB_PASSWORD_PBKDF2_ITERATIONS = 100000;
const WEB_PASSWORD_KEY_LENGTH_BYTES = 32;
const WEB_USERNAME_PATTERN = /^[a-z0-9._-]{3,64}$/;
const WEB_DEFAULT_ROLE = "admin";
const WEB_BEARER_TOKEN_TYPE = "Bearer";
const WEB_HASH_TYPE_PBKDF2 = "pbkdf2_sha256";
const WEB_HASH_TYPE_BCRYPT = "bcrypt";
const WEB_HASH_TYPE_LEGACY_PBKDF2 = "legacy_pbkdf2_hex";
const PUSH_NOTIFICATION_MAX_TOKENS_PER_REQUEST = 500;
const CRITICAL_INCIDENT_PUSH_ROLES = ["admin", "super_admin"];
const FCM_OAUTH_SCOPE = "https://www.googleapis.com/auth/firebase.messaging";
const FCM_OAUTH_AUDIENCE = "https://oauth2.googleapis.com/token";
const FCM_OAUTH_GRANT_TYPE = "urn:ietf:params:oauth:grant-type:jwt-bearer";
const WEB_ALLOWED_HASH_TYPES = new Set([
  WEB_HASH_TYPE_PBKDF2,
  WEB_HASH_TYPE_BCRYPT,
  WEB_HASH_TYPE_LEGACY_PBKDF2,
]);

let fcmAccessTokenCache = null;
let fcmAccessTokenRefreshState = null;
const SSE_POLL_INTERVAL_MS = 10000;
const SSE_KEEP_ALIVE_INTERVAL_MS = 30000;
const SSE_MAX_CONNECTION_MS = 30 * 60 * 1000;
const SSE_MAX_CLIENTS_PER_BROKER = 200;
const SSE_CLIENT_WRITE_TIMEOUT_MS = 1500;
const SSE_CLIENT_KEY_PATTERN = /^[a-z0-9._:-]{1,96}$/;
const REALTIME_BROKER_INSTANCE = "global";
const ASSET_EXTERNAL_CODE_MAX_LENGTH = 128;
const ASSET_BRAND_MAX_LENGTH = 120;
const ASSET_SERIAL_MAX_LENGTH = 128;
const ASSET_MODEL_MAX_LENGTH = 160;
const ASSET_CLIENT_NAME_MAX_LENGTH = 180;
const ASSET_NOTES_MAX_LENGTH = 2000;
const ALLOWED_ASSET_STATUSES = new Set(["active", "inactive", "retired", "maintenance"]);
const ALLOWED_INCIDENT_STATUSES = new Set(["open", "in_progress", "paused", "resolved"]);
const DRIVER_BRAND_MAX_LENGTH = 120;
const DRIVER_VERSION_MAX_LENGTH = 120;
const DRIVER_DESCRIPTION_MAX_LENGTH = 500;
const DRIVER_MANIFEST_KEY = "manifest.json";
const MAX_DRIVER_UPLOAD_BYTES = 300 * 1024 * 1024;
const MAX_INCIDENT_ESTIMATED_DURATION_SECONDS = 7 * 24 * 60 * 60;
const WEB_AUTH_ALLOW_INSECURE_FALLBACK_ENV = "ALLOW_INSECURE_WEB_AUTH_FALLBACK";
const LEGACY_API_TENANT_ENV_NAME = "DRIVER_MANAGER_API_TENANT_ID";
const LOAN_DUE_SOON_HOURS = 48;
const LOAN_OVERDUE_REPEAT_HOURS = 24;
const RESEND_API_URL = "https://api.resend.com/emails";

function dashboardAssetSecurityHeaders() {
  return {
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Permissions-Policy": "geolocation=(self), microphone=(), camera=(self)",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": [
      "default-src 'self'",
      "base-uri 'self'",
      "frame-ancestors 'none'",
      "object-src 'none'",
      "img-src 'self' data: blob:",
      "font-src 'self' data: https://fonts.gstatic.com",
      "connect-src 'self' https://fonts.googleapis.com https://fonts.gstatic.com",
      "script-src 'self'",
      "style-src 'self' https://fonts.googleapis.com",
      "manifest-src 'self'",
    ].join("; "),
  };
}

const DASHBOARD_ASSET_PATHS = {
  dashboard: "/dashboard",
  "dashboard.css": "/dashboard.css",
  "chart.umd.js": "/chart.umd.js",
  "dashboard-qr.js": "/dashboard-qr.js",
  "dashboard-api.js": "/dashboard-api.js",
  "dashboard-geolocation.js": "/dashboard-geolocation.js",
  "dashboard-modals.js": "/dashboard-modals.js",
  "dashboard-incidents.js": "/dashboard-incidents.js",
  "dashboard-assets.js": "/dashboard-assets.js",
  "dashboard-drivers.js": "/dashboard-drivers.js",
  "dashboard-audit.js": "/dashboard-audit.js",
  "dashboard-overview.js": "/dashboard-overview.js",
  "dashboard-realtime.js": "/dashboard-realtime.js",
  "dashboard-auth.js": "/dashboard-auth.js",
  "dashboard-navigation.js": "/dashboard-navigation.js",
  "dashboard-bootstrap.js": "/dashboard-bootstrap.js",
  "dashboard.js": "/dashboard.js",
  "dashboard-pwa.js": "/dashboard-pwa.js",
  "public-tracking.js": "/public-tracking.js",
  "public-tracking.css": "/public-tracking.css",
  "manifest.json": "/manifest.json",
  "sw.js": "/sw.js",
  "favicon.ico": "/icons/icon-192x192.png",
};

function resolveDashboardAssetPath(routeParts) {
  if (!Array.isArray(routeParts) || routeParts.length === 0) return null;
  if (routeParts.length === 1) {
    return DASHBOARD_ASSET_PATHS[routeParts[0]] || null;
  }
  if (
    routeParts.length === 2 &&
    routeParts[0] === "icons" &&
    (routeParts[1] === "icon-192x192.png" || routeParts[1] === "icon-512x512.png")
  ) {
    return `/icons/${routeParts[1]}`;
  }
  return null;
}

function dashboardAssetContentType(assetPath) {
  if (assetPath === "/dashboard" || assetPath === "/dashboard.html") return "text/html; charset=utf-8";
  if (assetPath === "/dashboard.css") return "text/css; charset=utf-8";
  if (
    assetPath === "/chart.umd.js" ||
    assetPath === "/dashboard-qr.js" ||
    assetPath === "/dashboard-api.js" ||
    assetPath === "/dashboard-geolocation.js" ||
    assetPath === "/dashboard-modals.js" ||
    assetPath === "/dashboard-incidents.js" ||
    assetPath === "/dashboard-assets.js" ||
    assetPath === "/dashboard-drivers.js" ||
    assetPath === "/dashboard-audit.js" ||
    assetPath === "/dashboard-overview.js" ||
    assetPath === "/dashboard-realtime.js" ||
    assetPath === "/dashboard-auth.js" ||
    assetPath === "/dashboard-navigation.js" ||
    assetPath === "/dashboard-bootstrap.js" ||
    assetPath === "/dashboard.js" ||
    assetPath === "/dashboard-pwa.js" ||
    assetPath === "/public-tracking.js" ||
    assetPath === "/sw.js"
  ) {
    return "application/javascript; charset=utf-8";
  }
  if (assetPath === "/public-tracking.css") return "text/css; charset=utf-8";
  if (assetPath === "/manifest.json") return "application/manifest+json; charset=utf-8";
  if (assetPath.startsWith("/icons/")) return "image/png";
  return null;
}

function dashboardAssetCacheControl(assetPath) {
  if (assetPath === "/dashboard" || assetPath === "/dashboard.html") return "public, max-age=0, must-revalidate";
  if (assetPath === "/sw.js") return "no-cache";
  return "public, max-age=31536000, immutable";
}

function dashboardFallbackHtml() {
  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>SiteOps Dashboard</title>
</head>
<body>
  <main>
    <h1>SiteOps Dashboard</h1>
    <p>No se encontró el binding de assets estáticos. Revisa wrangler.toml ([assets]).</p>
  </main>
</body>
</html>`;
}

async function serveDashboardStaticAsset(request, env, corsPolicy, routeParts) {
  if (request.method !== "GET" && request.method !== "HEAD") return null;
  const assetPath = resolveDashboardAssetPath(routeParts);
  if (!assetPath) return null;

  if (!env?.ASSETS || typeof env.ASSETS.fetch !== "function") {
    if (assetPath === "/dashboard" || assetPath === "/dashboard.html") {
      return new Response(dashboardFallbackHtml(), {
        status: 200,
        headers: {
          ...corsHeaders(request, env, corsPolicy),
          ...dashboardAssetSecurityHeaders(),
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-cache",
        },
      });
    }
    return new Response("Asset binding no configurado.", {
      status: 503,
      headers: {
        ...corsHeaders(request, env, corsPolicy),
        ...dashboardAssetSecurityHeaders(),
        "Content-Type": "text/plain; charset=utf-8",
      },
    });
  }

  let assetUrl = new URL(request.url);
  assetUrl.pathname = assetPath;
  assetUrl.search = "";

  const redirectStatuses = new Set([301, 302, 303, 307, 308]);
  let assetResponse = await env.ASSETS.fetch(new Request(assetUrl.toString(), request));
  for (let i = 0; i < 2; i += 1) {
    if (!redirectStatuses.has(assetResponse.status)) break;
    const location = assetResponse.headers.get("Location");
    if (!location) break;
    assetUrl = new URL(location, assetUrl.origin);
    assetResponse = await env.ASSETS.fetch(new Request(assetUrl.toString(), request));
  }
  if (assetResponse.status === 404) return null;

  const headers = new Headers(assetResponse.headers);
  const contentType = dashboardAssetContentType(assetPath);
  if (contentType) headers.set("Content-Type", contentType);
  headers.set("Cache-Control", dashboardAssetCacheControl(assetPath));
  appendVaryHeader(headers, "Accept-Encoding");

  const cors = corsHeaders(request, env, corsPolicy);
  for (const [key, value] of Object.entries(cors)) setHeaderWithVaryMerge(headers, key, value);
  for (const [key, value] of Object.entries(dashboardAssetSecurityHeaders())) {
    setHeaderWithVaryMerge(headers, key, value);
  }

  return new Response(request.method === "HEAD" ? null : assetResponse.body, {
    status: assetResponse.status,
    headers,
  });
}

function parsePositiveInt(value, label) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new HttpError(400, `${label} inválido.`);
  }
  return parsed;
}

function normalizeContentType(headerValue) {
  if (!headerValue) return "";
  return headerValue.split(";")[0].trim().toLowerCase();
}

function sanitizeFileName(input, fallbackBase) {
  const candidate = (input || `${fallbackBase}.jpg`).trim();
  const normalized = candidate.replace(/[^a-zA-Z0-9._-]/g, "_");
  return normalized || `${fallbackBase}.jpg`;
}

function nowUnixSeconds() {
  return Math.floor(Date.now() / 1000);
}

function normalizeRealtimeClientKey(value) {
  const raw = normalizeOptionalString(value, "").toLowerCase();
  if (!raw) return "";
  if (!SSE_CLIENT_KEY_PATTERN.test(raw)) return "";
  return raw;
}

function buildRealtimeClientKeyFromSession(webSession) {
  const tenantId = normalizeRealtimeTenantId(webSession?.tenant_id);
  const userId = Number.isInteger(webSession?.user_id) ? Number(webSession.user_id) : null;
  if (userId && userId > 0) {
    return normalizeRealtimeClientKey(`${tenantId}:uid:${userId}`);
  }
  const username = normalizeWebUsername(webSession?.sub || "");
  if (!username) return "";
  return normalizeRealtimeClientKey(`${tenantId}:usr:${username}`);
}

function resolveRealtimeTenantId(request, webSession = null) {
  const sessionTenant = normalizeOptionalString(webSession?.tenant_id, "");
  if (sessionTenant) return normalizeRealtimeTenantId(sessionTenant);
  try {
    const path = new URL(request?.url || "https://invalid.local").pathname;
    if (path.startsWith("/web/")) {
      return DEFAULT_REALTIME_TENANT_ID;
    }
  } catch {
    // ignore malformed url
  }
  const headerTenant = normalizeOptionalString(request?.headers?.get("X-Tenant-Id"), "");
  if (headerTenant) return normalizeRealtimeTenantId(headerTenant);
  return DEFAULT_REALTIME_TENANT_ID;
}

function canManageAllTenants(role) {
  return normalizeOptionalString(role, "") === "super_admin";
}

function assertSameTenantOrSuperAdmin(session, targetTenantId) {
  if (canManageAllTenants(session?.role)) return;
  const actorTenant = normalizeRealtimeTenantId(session?.tenant_id);
  const targetTenant = normalizeRealtimeTenantId(targetTenantId);
  if (actorTenant !== targetTenant) {
    throw new HttpError(403, "No tienes permisos para operar sobre otro tenant.");
  }
}

function normalizeWebUsername(value) {
  return normalizeOptionalString(value, "").toLowerCase();
}

function normalizeNonNegativeInteger(value, fallback = 0) {
  if (value === null || value === undefined || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, Math.trunc(parsed));
}

function normalizeInstallationPayload(data, defaultStatus = "unknown") {
  const source = data && typeof data === "object" ? data : {};
  const siteConfig = normalizeInstallationSitePayload(source);

  return {
    timestamp: normalizeOptionalString(source.timestamp, nowIso()),
    driver_brand: normalizeOptionalString(source.driver_brand || source.brand, ""),
    driver_version: normalizeOptionalString(source.driver_version || source.version, ""),
    status: normalizeOptionalString(source.status, defaultStatus) || defaultStatus,
    client_name: normalizeOptionalString(source.client_name || source.client, ""),
    driver_description: normalizeOptionalString(
      source.driver_description || source.description,
      "",
    ),
    installation_time_seconds: normalizeNonNegativeInteger(
      source.installation_time_seconds ?? source.installation_time ?? source.time_seconds,
      0,
    ),
    os_info: normalizeOptionalString(source.os_info, ""),
    notes: normalizeOptionalString(source.notes || source.error_message, ""),
    has_site_config: siteConfig.hasSiteConfig,
    site_lat: siteConfig.site_lat,
    site_lng: siteConfig.site_lng,
    site_radius_m: siteConfig.site_radius_m,
  };
}

function normalizeInstallationUpdatePayload(data) {
  const source = data && typeof data === "object" ? data : {};
  const hasNotes = Object.prototype.hasOwnProperty.call(source, "notes");
  const hasInstallationTime = Object.prototype.hasOwnProperty.call(source, "installation_time_seconds");
  const siteConfig = normalizeInstallationSitePayload(source);

  let notes = null;
  if (hasNotes) {
    if (source.notes === null || source.notes === undefined) {
      notes = null;
    } else if (typeof source.notes !== "string") {
      throw new HttpError(400, "Campo 'notes' invalido.");
    } else if (source.notes.length > 5000) {
      throw new HttpError(400, "Campo 'notes' excede el maximo permitido (5000 caracteres).");
    } else {
      notes = source.notes;
    }
  }

  let installationTimeSeconds = null;
  if (hasInstallationTime) {
    const rawValue = source.installation_time_seconds;
    if (rawValue === null || rawValue === undefined) {
      installationTimeSeconds = null;
    } else {
      const asText = typeof rawValue === "string" ? rawValue.trim() : rawValue;
      if (asText === "") {
        installationTimeSeconds = null;
      } else {
        const parsed = Number(asText);
        if (!Number.isInteger(parsed) || parsed < 0) {
          throw new HttpError(400, "Campo 'installation_time_seconds' invalido.");
        }
        installationTimeSeconds = parsed;
      }
    }
  }

  return {
    notes,
    installation_time_seconds: installationTimeSeconds,
    has_site_config: siteConfig.hasSiteConfig,
    site_lat: siteConfig.site_lat,
    site_lng: siteConfig.site_lng,
    site_radius_m: siteConfig.site_radius_m,
  };
}

function normalizeIncidentLifecycleStatus(value) {
  const normalized = normalizeOptionalString(value, "open").toLowerCase();
  if (normalized === "in_progress" || normalized === "paused" || normalized === "resolved") {
    return normalized;
  }
  return "open";
}

function deriveInstallationAttentionState(summary) {
  const criticalActive = normalizeNonNegativeInteger(summary?.incident_critical_active_count, 0);
  if (criticalActive > 0) return "critical";

  const inProgress = normalizeNonNegativeInteger(summary?.incident_in_progress_count, 0);
  if (inProgress > 0) return "in_progress";

  const paused = normalizeNonNegativeInteger(summary?.incident_paused_count, 0);
  if (paused > 0) return "paused";

  const open = normalizeNonNegativeInteger(summary?.incident_open_count, 0);
  if (open > 0) return "open";

  const resolved = normalizeNonNegativeInteger(summary?.incident_resolved_count, 0);
  if (resolved > 0) return "resolved";

  return "clear";
}

function buildDefaultInstallationOperationalSummary() {
  return {
    incident_open_count: 0,
    incident_in_progress_count: 0,
    incident_paused_count: 0,
    incident_resolved_count: 0,
    incident_active_count: 0,
    incident_critical_active_count: 0,
    incident_estimated_duration_seconds_total: 0,
    incident_estimated_duration_count: 0,
    incident_actual_duration_seconds_total: 0,
    incident_actual_duration_count: 0,
    attention_state: "clear",
  };
}

function mapInstallationWithOperationalState(installation, summaryById) {
  const installationId = Number(installation?.id);
  const summary =
    (Number.isInteger(installationId) ? summaryById.get(installationId) : null) ||
    buildDefaultInstallationOperationalSummary();
  return {
    ...installation,
    ...summary,
  };
}

async function loadInstallationOperationalSummaries(env, installationIds, tenantId) {
  const ids = [...new Set(
    (installationIds || [])
      .map((value) => Number(value))
      .filter((value) => Number.isInteger(value) && value > 0),
  )];
  const summaryById = new Map();
  if (!ids.length) {
    return summaryById;
  }

  const placeholders = ids.map(() => "?").join(", ");
  const mapRows = (rows) => {
    for (const row of rows || []) {
      const installationId = Number(row?.installation_id);
      if (!Number.isInteger(installationId) || installationId <= 0) continue;
      const summary = {
        incident_open_count: normalizeNonNegativeInteger(row?.incident_open_count, 0),
        incident_in_progress_count: normalizeNonNegativeInteger(row?.incident_in_progress_count, 0),
        incident_paused_count: normalizeNonNegativeInteger(row?.incident_paused_count, 0),
        incident_resolved_count: normalizeNonNegativeInteger(row?.incident_resolved_count, 0),
        incident_active_count: normalizeNonNegativeInteger(row?.incident_active_count, 0),
        incident_critical_active_count: normalizeNonNegativeInteger(
          row?.incident_critical_active_count,
          0,
        ),
        incident_estimated_duration_seconds_total: normalizeNonNegativeInteger(
          row?.incident_estimated_duration_seconds_total,
          0,
        ),
        incident_estimated_duration_count: normalizeNonNegativeInteger(
          row?.incident_estimated_duration_count,
          0,
        ),
        incident_actual_duration_seconds_total: normalizeNonNegativeInteger(
          row?.incident_actual_duration_seconds_total,
          0,
        ),
        incident_actual_duration_count: normalizeNonNegativeInteger(
          row?.incident_actual_duration_count,
          0,
        ),
      };
      summary.attention_state = deriveInstallationAttentionState(summary);
      summaryById.set(installationId, summary);
    }
  };

  try {
    const { results } = await env.DB.prepare(`
      SELECT
        installation_id,
        SUM(CASE WHEN LOWER(COALESCE(incident_status, 'open')) = 'open' THEN 1 ELSE 0 END) AS incident_open_count,
        SUM(CASE WHEN LOWER(COALESCE(incident_status, 'open')) = 'in_progress' THEN 1 ELSE 0 END) AS incident_in_progress_count,
        SUM(CASE WHEN LOWER(COALESCE(incident_status, 'open')) = 'paused' THEN 1 ELSE 0 END) AS incident_paused_count,
        SUM(CASE WHEN LOWER(COALESCE(incident_status, 'open')) = 'resolved' THEN 1 ELSE 0 END) AS incident_resolved_count,
        SUM(CASE WHEN LOWER(COALESCE(incident_status, 'open')) IN ('open', 'in_progress', 'paused') THEN 1 ELSE 0 END) AS incident_active_count,
        SUM(CASE WHEN LOWER(COALESCE(incident_status, 'open')) IN ('open', 'in_progress', 'paused') AND LOWER(COALESCE(severity, '')) = 'critical' THEN 1 ELSE 0 END) AS incident_critical_active_count,
        SUM(CASE WHEN estimated_duration_seconds IS NOT NULL AND estimated_duration_seconds >= 0 THEN estimated_duration_seconds ELSE 0 END) AS incident_estimated_duration_seconds_total,
        SUM(CASE WHEN estimated_duration_seconds IS NOT NULL AND estimated_duration_seconds >= 0 THEN 1 ELSE 0 END) AS incident_estimated_duration_count,
        SUM(CASE WHEN actual_duration_seconds IS NOT NULL AND actual_duration_seconds >= 0 THEN actual_duration_seconds ELSE 0 END) AS incident_actual_duration_seconds_total,
        SUM(CASE WHEN actual_duration_seconds IS NOT NULL AND actual_duration_seconds >= 0 THEN 1 ELSE 0 END) AS incident_actual_duration_count
      FROM incidents
      WHERE tenant_id = ?
        AND deleted_at IS NULL
        AND installation_id IN (${placeholders})
      GROUP BY installation_id
    `)
      .bind(tenantId, ...ids)
      .all();
    mapRows(results);
    return summaryById;
  } catch (error) {
    if (isMissingIncidentsTableError(error)) {
      return summaryById;
    }
    if (!isMissingTenantColumnError(error)) {
      throw error;
    }
  }

  const { results } = await env.DB.prepare(`
    SELECT
      installation_id,
      SUM(CASE WHEN LOWER(COALESCE(incident_status, 'open')) = 'open' THEN 1 ELSE 0 END) AS incident_open_count,
      SUM(CASE WHEN LOWER(COALESCE(incident_status, 'open')) = 'in_progress' THEN 1 ELSE 0 END) AS incident_in_progress_count,
      SUM(CASE WHEN LOWER(COALESCE(incident_status, 'open')) = 'paused' THEN 1 ELSE 0 END) AS incident_paused_count,
      SUM(CASE WHEN LOWER(COALESCE(incident_status, 'open')) = 'resolved' THEN 1 ELSE 0 END) AS incident_resolved_count,
      SUM(CASE WHEN LOWER(COALESCE(incident_status, 'open')) IN ('open', 'in_progress', 'paused') THEN 1 ELSE 0 END) AS incident_active_count,
      SUM(CASE WHEN LOWER(COALESCE(incident_status, 'open')) IN ('open', 'in_progress', 'paused') AND LOWER(COALESCE(severity, '')) = 'critical' THEN 1 ELSE 0 END) AS incident_critical_active_count,
      SUM(CASE WHEN estimated_duration_seconds IS NOT NULL AND estimated_duration_seconds >= 0 THEN estimated_duration_seconds ELSE 0 END) AS incident_estimated_duration_seconds_total,
      SUM(CASE WHEN estimated_duration_seconds IS NOT NULL AND estimated_duration_seconds >= 0 THEN 1 ELSE 0 END) AS incident_estimated_duration_count,
      SUM(CASE WHEN actual_duration_seconds IS NOT NULL AND actual_duration_seconds >= 0 THEN actual_duration_seconds ELSE 0 END) AS incident_actual_duration_seconds_total,
      SUM(CASE WHEN actual_duration_seconds IS NOT NULL AND actual_duration_seconds >= 0 THEN 1 ELSE 0 END) AS incident_actual_duration_count
    FROM incidents
    WHERE deleted_at IS NULL
      AND installation_id IN (${placeholders})
    GROUP BY installation_id
  `)
    .bind(...ids)
    .all();
  mapRows(results);
  return summaryById;
}

function normalizeAssetExternalCode(value) {
  const normalized = normalizeOptionalString(value, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, ASSET_EXTERNAL_CODE_MAX_LENGTH);
  if (!normalized) {
    throw new HttpError(400, "Campo 'external_code' es obligatorio.");
  }
  return normalized;
}

function normalizeAssetStatus(value, fallback = "active") {
  const normalized = normalizeOptionalString(value, fallback).toLowerCase();
  if (!ALLOWED_ASSET_STATUSES.has(normalized)) {
    throw new HttpError(400, "Campo 'status' invalido.");
  }
  return normalized;
}

function normalizeAssetPayload(data, options = {}) {
  const source = data && typeof data === "object" ? data : {};
  const allowPartial = Boolean(options.allowPartial);

  const hasExternalCode = Object.prototype.hasOwnProperty.call(source, "external_code");
  const hasBrand = Object.prototype.hasOwnProperty.call(source, "brand");
  const hasSerial = Object.prototype.hasOwnProperty.call(source, "serial_number");
  const hasModel = Object.prototype.hasOwnProperty.call(source, "model");
  const hasClientName = Object.prototype.hasOwnProperty.call(source, "client_name");
  const hasNotes = Object.prototype.hasOwnProperty.call(source, "notes");
  const hasStatus = Object.prototype.hasOwnProperty.call(source, "status");

  if (!allowPartial || hasExternalCode) {
    const externalCode = normalizeAssetExternalCode(source.external_code);
    source.external_code = externalCode;
  }

  const brand = hasBrand
    ? normalizeOptionalString(source.brand, "").slice(0, ASSET_BRAND_MAX_LENGTH)
    : undefined;
  const serialNumber = hasSerial
    ? normalizeOptionalString(source.serial_number, "").slice(0, ASSET_SERIAL_MAX_LENGTH)
    : undefined;
  const model = hasModel
    ? normalizeOptionalString(source.model, "").slice(0, ASSET_MODEL_MAX_LENGTH)
    : undefined;
  const clientName = hasClientName
    ? normalizeOptionalString(source.client_name, "").slice(0, ASSET_CLIENT_NAME_MAX_LENGTH)
    : undefined;
  const notes = hasNotes
    ? normalizeOptionalString(source.notes, "").slice(0, ASSET_NOTES_MAX_LENGTH)
    : undefined;
  const status = hasStatus ? normalizeAssetStatus(source.status) : undefined;

  if (allowPartial) {
    if (!hasExternalCode && !hasBrand && !hasSerial && !hasModel && !hasClientName && !hasNotes && !hasStatus) {
      throw new HttpError(
        400,
        "Debes enviar al menos uno de: external_code, brand, serial_number, model, client_name, notes, status.",
      );
    }
    return {
      external_code: hasExternalCode ? source.external_code : undefined,
      brand: hasBrand ? brand : undefined,
      serial_number: hasSerial ? serialNumber : undefined,
      model: hasModel ? model : undefined,
      client_name: hasClientName ? clientName : undefined,
      notes: hasNotes ? notes : undefined,
      status: hasStatus ? status : undefined,
    };
  }

  return {
    external_code: source.external_code,
    brand: brand || "",
    serial_number: serialNumber || "",
    model: model || "",
    client_name: clientName || "",
    notes: notes || "",
    status: normalizeAssetStatus(source.status, "active"),
  };
}

function parseAssetSearchQuery(searchParams) {
  return {
    code: normalizeOptionalString(searchParams.get("code"), "").toLowerCase(),
    brand: normalizeOptionalString(searchParams.get("brand"), "").toLowerCase(),
    status: normalizeOptionalString(searchParams.get("status"), "").toLowerCase(),
    search: normalizeOptionalString(searchParams.get("search"), "").toLowerCase(),
  };
}

function deriveLoanStatus(row, currentIso = nowIso()) {
  if (normalizeOptionalString(row?.returned_at, "").trim()) return "returned";
  const expectedReturnAt = normalizeOptionalString(row?.expected_return_at, "").trim();
  if (expectedReturnAt && expectedReturnAt < currentIso) return "overdue";
  return "active";
}

function mapLoanRow(row, currentIso = nowIso()) {
  return {
    id: row.id,
    tenant_id: row.tenant_id,
    asset_id: row.asset_id,
    asset_external_code: row.asset_external_code || null,
    asset_brand: row.asset_brand || null,
    asset_model: row.asset_model || null,
    original_client: row.original_client || "",
    borrowing_client: row.borrowing_client || "",
    loaned_at: row.loaned_at || null,
    expected_return_at: row.expected_return_at || null,
    returned_at: row.returned_at || null,
    loaned_by_username: row.loaned_by_username || "",
    returned_by_username: row.returned_by_username || null,
    notes: row.notes || "",
    return_notes: row.return_notes || "",
    status: deriveLoanStatus(row, currentIso),
  };
}

function resolveLoanReminderType(row, currentIso = nowIso(), options = {}) {
  if (normalizeOptionalString(row?.returned_at, "").trim()) return null;
  const expectedReturnAt = normalizeOptionalString(row?.expected_return_at, "").trim();
  if (!expectedReturnAt) return null;
  const currentDate = new Date(currentIso);
  const currentTime = Number.isFinite(currentDate.getTime()) ? currentDate.getTime() : Date.now();

  const dueSoonCutoffIso = normalizeOptionalString(
    options.dueSoonCutoffIso,
    new Date(currentTime + LOAN_DUE_SOON_HOURS * 60 * 60 * 1000).toISOString(),
  );
  const overdueRepeatCutoffIso = normalizeOptionalString(
    options.overdueRepeatCutoffIso,
    new Date(currentTime - LOAN_OVERDUE_REPEAT_HOURS * 60 * 60 * 1000).toISOString(),
  );

  if (expectedReturnAt < currentIso) {
    const lastOverdueReminderAt = normalizeOptionalString(row?.overdue_reminded_at, "").trim();
    return !lastOverdueReminderAt || lastOverdueReminderAt < overdueRepeatCutoffIso
      ? "overdue"
      : null;
  }

  if (expectedReturnAt <= dueSoonCutoffIso) {
    const dueSoonReminderAt = normalizeOptionalString(row?.due_soon_reminded_at, "").trim();
    return dueSoonReminderAt ? null : "due_soon";
  }

  return null;
}

function buildLoanReminderStatusLabel(reminderType) {
  return reminderType === "overdue" ? "vencido" : "proximo a vencer";
}

function normalizeEmailRecipients(value) {
  return [...new Set(
    String(value || "")
      .split(/[,\n;]+/)
      .map((entry) => normalizeOptionalString(entry, "").trim())
      .filter((entry) => entry),
  )];
}

async function readJsonOrThrowBadRequest(request, message = "Payload invalido.", options = {}) {
  const maxBytes = Number.isInteger(options.maxBytes) ? options.maxBytes : null;
  const resolvedMaxBytes = maxBytes && maxBytes > 0 ? maxBytes : MAX_JSON_BODY_DEFAULT_BYTES;
  if (resolvedMaxBytes) {
    const contentLengthRaw = normalizeOptionalString(request.headers.get("content-length"), "");
    const contentLength = Number.parseInt(contentLengthRaw, 10);
    if (Number.isFinite(contentLength) && contentLength > resolvedMaxBytes) {
      throw new HttpError(413, `Payload supera el limite permitido (${resolvedMaxBytes} bytes).`);
    }
  }

  try {
    if (!request.body) {
      throw new HttpError(400, message);
    }

    const reader = request.body.getReader();
    const chunks = [];
    let totalBytes = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = value instanceof Uint8Array ? value : new Uint8Array(value || 0);
      totalBytes += chunk.byteLength;

      if (resolvedMaxBytes && totalBytes > resolvedMaxBytes) {
        throw new HttpError(413, `Payload supera el limite permitido (${resolvedMaxBytes} bytes).`);
      }

      chunks.push(chunk);
    }

    if (!totalBytes) {
      throw new HttpError(400, message);
    }

    const bodyBytes = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
      bodyBytes.set(chunk, offset);
      offset += chunk.byteLength;
    }

    const rawBody = new TextDecoder().decode(bodyBytes).replace(/^\uFEFF/, "");
    if (!rawBody.trim()) {
      throw new HttpError(400, message);
    }

    return JSON.parse(rawBody);
  } catch (error) {
    if (error instanceof HttpError) {
      throw error;
    }

    if (error instanceof SyntaxError) {
      throw new HttpError(400, message);
    }

    throw error;
  }
}

function getDriversBucketBinding(env) {
  const bucket = env?.DRIVERS_BUCKET;
  if (
    !bucket ||
    typeof bucket.get !== "function" ||
    typeof bucket.put !== "function" ||
    typeof bucket.delete !== "function"
  ) {
    throw new HttpError(
      503,
      "No hay bucket R2 configurado para drivers (usa DRIVERS_BUCKET).",
    );
  }
  return bucket;
}

function sanitizeStorageSegment(value, fallback = "default", maxLength = 96) {
  const normalized = normalizeOptionalString(value, "")
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, maxLength);
  return normalized || fallback;
}

function normalizeDriverBrand(value) {
  const brand = normalizeOptionalString(value, "").replace(/\s+/g, " ").trim().slice(0, DRIVER_BRAND_MAX_LENGTH);
  if (!brand) {
    throw new HttpError(400, "Campo 'brand' es obligatorio.");
  }
  return brand;
}

function normalizeDriverVersion(value) {
  const version = normalizeOptionalString(value, "").replace(/\s+/g, " ").trim().slice(0, DRIVER_VERSION_MAX_LENGTH);
  if (!version) {
    throw new HttpError(400, "Campo 'version' es obligatorio.");
  }
  return version;
}

function normalizeDriverDescription(value) {
  return normalizeOptionalString(value, "").replace(/\s+/g, " ").trim().slice(0, DRIVER_DESCRIPTION_MAX_LENGTH);
}

function formatLegacyDateTime(isoValue) {
  const parsed = new Date(isoValue);
  if (Number.isNaN(parsed.getTime())) {
    return nowIso().replace("T", " ").slice(0, 19);
  }
  return parsed.toISOString().replace("T", " ").slice(0, 19);
}

function buildDriverStorageKey({ tenantId, brand, version, fileName }) {
  const tenantSegment = sanitizeStorageSegment(tenantId, "default");
  const brandSegment = sanitizeStorageSegment(brand, "brand");
  const versionSegment = sanitizeStorageSegment(version, "version");
  return `drivers/${tenantSegment}/${brandSegment}/${versionSegment}/${fileName}`;
}

function createDefaultDriverManifest() {
  return {
    version: "1.0",
    last_updated: nowIso(),
    drivers: [],
  };
}

function normalizeDriverManifestEntry(rawEntry) {
  const entry = rawEntry && typeof rawEntry === "object" ? rawEntry : {};
  const key = normalizeOptionalString(entry.key, "");
  if (!key) return null;

  const uploaded = normalizeOptionalString(entry.uploaded, nowIso());
  const sizeBytes = Math.max(0, Number(entry.size_bytes) || 0);
  const sizeMb = Number.isFinite(Number(entry.size_mb))
    ? Number(entry.size_mb)
    : Number((sizeBytes / (1024 * 1024)).toFixed(2));

  return {
    tenant_id: normalizeRealtimeTenantId(entry.tenant_id),
    brand: normalizeOptionalString(entry.brand, ""),
    version: normalizeOptionalString(entry.version, ""),
    description: normalizeOptionalString(entry.description, ""),
    key,
    filename: normalizeOptionalString(entry.filename, key.split("/").pop() || "driver.bin"),
    uploaded,
    last_modified: normalizeOptionalString(entry.last_modified, formatLegacyDateTime(uploaded)),
    size_bytes: sizeBytes,
    size_mb: Number(sizeMb.toFixed(2)),
  };
}

function normalizeDriverManifest(rawManifest) {
  const source = rawManifest && typeof rawManifest === "object" ? rawManifest : {};
  const rawDrivers = Array.isArray(source.drivers) ? source.drivers : [];
  const drivers = rawDrivers
    .map((entry) => normalizeDriverManifestEntry(entry))
    .filter((entry) => Boolean(entry));

  return {
    version: normalizeOptionalString(source.version, "1.0"),
    last_updated: normalizeOptionalString(source.last_updated, nowIso()),
    drivers,
  };
}

async function readDriverManifest(bucket) {
  const object = await bucket.get(DRIVER_MANIFEST_KEY);
  if (!object || !object.body) {
    return createDefaultDriverManifest();
  }

  try {
    const rawText = await object.text();
    const parsed = rawText ? JSON.parse(rawText) : {};
    return normalizeDriverManifest(parsed);
  } catch {
    return createDefaultDriverManifest();
  }
}

async function writeDriverManifest(bucket, manifest) {
  const normalized = normalizeDriverManifest(manifest);
  normalized.last_updated = nowIso();
  await bucket.put(DRIVER_MANIFEST_KEY, JSON.stringify(normalized, null, 2), {
    httpMetadata: { contentType: "application/json" },
  });
  return normalized;
}

function applyInstallationFilters(installations, searchParams) {
  const clientName = normalizeOptionalString(searchParams.get("client_name"), "").toLowerCase();
  const brand = normalizeOptionalString(searchParams.get("brand"), "").toLowerCase();
  const status = normalizeOptionalString(searchParams.get("status"), "").toLowerCase();
  const startDate = parseDateOrNull(searchParams.get("start_date"));
  const endDate = parseDateOrNull(searchParams.get("end_date"));
  const limit = parseOptionalPositiveInt(searchParams.get("limit"), "limit");

  const filtered = (installations || []).filter((row) => {
    if (clientName) {
      const currentClient = normalizeOptionalString(row.client_name, "").toLowerCase();
      if (!currentClient.includes(clientName)) return false;
    }

    if (brand) {
      const currentBrand = normalizeOptionalString(row.driver_brand, "").toLowerCase();
      if (currentBrand !== brand) return false;
    }

    if (status) {
      const currentStatus = normalizeOptionalString(row.status, "").toLowerCase();
      if (currentStatus !== status) return false;
    }

    if (startDate || endDate) {
      const rawTimestamp = normalizeOptionalString(row.timestamp, "");
      const rowDate = rawTimestamp ? new Date(rawTimestamp) : null;
      if (!rowDate || Number.isNaN(rowDate.getTime())) return false;

      if (startDate && rowDate < startDate) return false;
      // Rango semiclosed [start_date, end_date)
      if (endDate && rowDate >= endDate) return false;
    }

    return true;
  });

  if (limit) {
    return filtered.slice(0, limit);
  }

  return filtered;
}

function computeStatistics(installations) {
  const rows = installations || [];
  const total = rows.length;

  let success = 0;
  let failed = 0;
  let totalSeconds = 0;
  let timedRows = 0;
  const uniqueClients = new Set();
  const topDrivers = {};
  const byBrand = {};

  for (const row of rows) {
    const rowStatus = normalizeOptionalString(row.status, "").toLowerCase();
    if (rowStatus === "success") success += 1;
    if (rowStatus === "failed") failed += 1;

    const seconds = Number(row.installation_time_seconds);
    if (Number.isFinite(seconds) && seconds >= 0) {
      totalSeconds += seconds;
      timedRows += 1;
    }

    const client = normalizeOptionalString(row.client_name, "");
    if (client) uniqueClients.add(client);

    const brand = normalizeOptionalString(row.driver_brand, "");
    const version = normalizeOptionalString(row.driver_version, "");

    if (brand) {
      byBrand[brand] = (byBrand[brand] || 0) + 1;
    }

    const driverKey = `${brand} ${version}`.trim();
    if (driverKey) {
      topDrivers[driverKey] = (topDrivers[driverKey] || 0) + 1;
    }
  }

  return {
    total_installations: total,
    successful_installations: success,
    failed_installations: failed,
    success_rate: total > 0 ? Number(((success / total) * 100).toFixed(2)) : 0,
    average_time_minutes: timedRows > 0 ? Number(((totalSeconds / timedRows) / 60).toFixed(2)) : 0,
    unique_clients: uniqueClients.size,
    top_drivers: topDrivers,
    by_brand: byBrand,
  };
}

async function getSseLatestState(env, tenantId = DEFAULT_REALTIME_TENANT_ID) {
  const normalizedTenantId = normalizeRealtimeTenantId(tenantId);
  const { results: installationRows } = await env.DB.prepare(`
    SELECT COALESCE(MAX(id), 0) AS max_id
    FROM installations
    WHERE tenant_id = ?
  `)
    .bind(normalizedTenantId)
    .all();
  const { results: incidentRows } = await env.DB.prepare(`
    SELECT COALESCE(MAX(id), 0) AS max_id
    FROM incidents
    WHERE tenant_id = ?
      AND deleted_at IS NULL
  `)
    .bind(normalizedTenantId)
    .all();

  return {
    lastInstallationId: Number(installationRows?.[0]?.max_id || 0),
    lastIncidentId: Number(incidentRows?.[0]?.max_id || 0),
  };
}

async function getInstallationsAfterId(
  env,
  lastId,
  limit = 25,
  tenantId = DEFAULT_REALTIME_TENANT_ID,
) {
  const normalizedTenantId = normalizeRealtimeTenantId(tenantId);
  const { results } = await env.DB.prepare(`
    SELECT
      id,
      timestamp,
      driver_brand,
      driver_version,
      status,
      client_name,
      driver_description,
      installation_time_seconds,
      os_info,
      notes,
      site_lat,
      site_lng,
      site_radius_m,
      gps_lat,
      gps_lng,
      gps_accuracy_m,
      gps_captured_at,
      gps_capture_source,
      gps_capture_status,
      gps_capture_note
    FROM installations
    WHERE tenant_id = ?
      AND id > ?
    ORDER BY id ASC
    LIMIT ?
  `)
    .bind(normalizedTenantId, lastId, limit)
    .all();

  return results || [];
}

async function getIncidentsAfterId(
  env,
  lastId,
  limit = 25,
  tenantId = DEFAULT_REALTIME_TENANT_ID,
) {
  const normalizedTenantId = normalizeRealtimeTenantId(tenantId);
  try {
    const { results } = await env.DB.prepare(`
      SELECT
        id,
        installation_id,
        asset_id,
        reporter_username,
        note,
        time_adjustment_seconds,
        estimated_duration_seconds,
        severity,
        source,
        created_at,
        incident_status,
        status_updated_at,
        status_updated_by,
        resolved_at,
        resolved_by,
        resolution_note,
        checklist_json,
        evidence_note,
        work_started_at,
        work_ended_at,
        actual_duration_seconds,
        geofence_distance_m,
        geofence_radius_m,
        geofence_result,
        geofence_checked_at,
        geofence_override_note,
        geofence_override_by,
        geofence_override_at,
        gps_lat,
        gps_lng,
        gps_accuracy_m,
        gps_captured_at,
        gps_capture_source,
        gps_capture_status,
        gps_capture_note
      FROM incidents
      WHERE tenant_id = ?
        AND deleted_at IS NULL
        AND id > ?
      ORDER BY id ASC
      LIMIT ?
    `)
      .bind(normalizedTenantId, lastId, limit)
      .all();
    return (results || []).map((incident) => mapIncidentRow(incident));
  } catch (error) {
    if (!isMissingIncidentAssetColumnError(error)) {
      throw error;
    }
    const { results } = await env.DB.prepare(`
      SELECT
        id,
        installation_id,
        reporter_username,
        note,
        time_adjustment_seconds,
        estimated_duration_seconds,
        severity,
        source,
        created_at,
        incident_status,
        status_updated_at,
        status_updated_by,
        resolved_at,
        resolved_by,
        resolution_note,
        checklist_json,
        evidence_note,
        geofence_distance_m,
        geofence_radius_m,
        geofence_result,
        geofence_checked_at,
        geofence_override_note,
        geofence_override_by,
        geofence_override_at,
        gps_lat,
        gps_lng,
        gps_accuracy_m,
        gps_captured_at,
        gps_capture_source,
        gps_capture_status,
        gps_capture_note
      FROM incidents
      WHERE tenant_id = ?
        AND deleted_at IS NULL
        AND id > ?
      ORDER BY id ASC
      LIMIT ?
    `)
      .bind(normalizedTenantId, lastId, limit)
      .all();

    return (results || []).map((incident) => mapIncidentRow({
      ...incident,
      asset_id: null,
    }));
  }
}

async function getSseStatisticsSnapshot(env, tenantId = DEFAULT_REALTIME_TENANT_ID) {
  const normalizedTenantId = normalizeRealtimeTenantId(tenantId);
  const { results: installations } = await env.DB.prepare(`
    SELECT
      timestamp,
      driver_brand,
      driver_version,
      status,
      client_name,
      installation_time_seconds
    FROM installations
    WHERE tenant_id = ?
  `)
    .bind(normalizedTenantId)
    .all();
  const baseStats = computeStatistics(installations || []);

  const rawSlaMinutes = Number.parseInt(String(env?.INCIDENT_SLA_MINUTES || ""), 10);
  const incidentSlaMinutes = Number.isInteger(rawSlaMinutes) && rawSlaMinutes > 0
    ? Math.min(rawSlaMinutes, 24 * 60)
    : 30;
  const outsideSlaCutoffIso = new Date(Date.now() - incidentSlaMinutes * 60 * 1000).toISOString();

  let incidentSummary = {
    incident_in_progress_count: 0,
    incident_critical_active_count: 0,
    incident_outside_sla_count: 0,
  };
  let gpsObservability = createEmptyGpsObservabilitySummary();
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
      .bind(outsideSlaCutoffIso, normalizedTenantId)
      .all();
    const row = incidentSummaryRows?.[0] || {};
    incidentSummary = {
      incident_in_progress_count: Number(row?.incident_in_progress_count) || 0,
      incident_critical_active_count: Number(row?.incident_critical_active_count) || 0,
      incident_outside_sla_count: Number(row?.incident_outside_sla_count) || 0,
    };

    const { results: installationGpsRows } = await env.DB.prepare(`
      SELECT gps_capture_status, gps_accuracy_m
      FROM installations
      WHERE tenant_id = ?
    `)
      .bind(normalizedTenantId)
      .all();

    const { results: incidentGpsRows } = await env.DB.prepare(`
      SELECT gps_capture_status, gps_accuracy_m
      FROM incidents
      WHERE tenant_id = ?
    `)
      .bind(normalizedTenantId)
      .all();

    const auditActionPlaceholders = GPS_OBSERVABILITY_AUDIT_ACTIONS.map(() => "?").join(", ");
    const { results: auditActionRows } = await env.DB.prepare(`
      SELECT action, COUNT(*) AS count
      FROM audit_logs
      WHERE tenant_id = ?
        AND action IN (${auditActionPlaceholders})
      GROUP BY action
    `)
      .bind(normalizedTenantId, ...GPS_OBSERVABILITY_AUDIT_ACTIONS)
      .all();

    gpsObservability = summarizeGpsObservability({
      installationRows: installationGpsRows || [],
      incidentRows: incidentGpsRows || [],
      auditActionRows: auditActionRows || [],
    });
  } catch (error) {
    if (!isMissingIncidentsTableError(error)) {
      throw error;
    }
  }

  return {
    ...baseStats,
    ...incidentSummary,
    incident_sla_minutes: incidentSlaMinutes,
    gps_observability: gpsObservability,
  };
}

function getRealtimeBrokerStub(env) {
  if (!env?.REALTIME_EVENTS || typeof env.REALTIME_EVENTS.idFromName !== "function") {
    return null;
  }
  try {
    const id = env.REALTIME_EVENTS.idFromName(REALTIME_BROKER_INSTANCE);
    return env.REALTIME_EVENTS.get(id);
  } catch {
    return null;
  }
}

async function connectRealtimeBrokerStream(
  request,
  env,
  corsPolicy,
  tenantId = DEFAULT_REALTIME_TENANT_ID,
  clientKey = "",
) {
  const broker = getRealtimeBrokerStub(env);
  if (!broker || typeof broker.fetch !== "function") return null;

  const brokerUrl = new URL("https://realtime/connect");
  brokerUrl.searchParams.set("tenant_id", normalizeRealtimeTenantId(tenantId));
  const normalizedClientKey = normalizeRealtimeClientKey(clientKey);
  if (normalizedClientKey) {
    brokerUrl.searchParams.set("client_key", normalizedClientKey);
  }
  const brokerResponse = await broker.fetch(brokerUrl.toString(), {
    method: "GET",
  });
  if (!brokerResponse?.body) return null;

  const headers = new Headers(brokerResponse.headers);
  for (const [key, value] of Object.entries(corsHeaders(request, env, corsPolicy))) {
    headers.set(key, value);
  }
  headers.set("Content-Type", "text/event-stream");
  headers.set("Cache-Control", "no-cache");
  headers.set("Connection", "keep-alive");

  return new Response(brokerResponse.body, {
    status: brokerResponse.status,
    headers,
  });
}

async function publishRealtimeEvent(env, payload, tenantId = DEFAULT_REALTIME_TENANT_ID) {
  const broker = getRealtimeBrokerStub(env);
  if (!broker || typeof broker.fetch !== "function") return;

  const eventPayload = {
    tenant_id: normalizeRealtimeTenantId(payload?.tenant_id || tenantId),
    ...payload,
    timestamp: payload?.timestamp || nowIso(),
  };

  try {
    await broker.fetch("https://realtime/publish", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(eventPayload),
    });
  } catch (err) {
    console.error("[SSE-BROKER] publish failed:", err);
  }
}

async function publishRealtimeStatsUpdate(env, tenantId = DEFAULT_REALTIME_TENANT_ID) {
  const broker = getRealtimeBrokerStub(env);
  if (!broker || typeof broker.fetch !== "function") return;
  try {
    const statistics = await getSseStatisticsSnapshot(env, tenantId);
    await publishRealtimeEvent(env, {
      type: "stats_update",
      statistics,
    }, tenantId);
  } catch (err) {
    console.error("[SSE-BROKER] stats update failed:", err);
  }
}

export class RealtimeEventsBroker {
  constructor(state) {
    this.state = state;
    this.encoder = new TextEncoder();
    this.clients = new Map();
    this.clientKeyToId = new Map();

    this.keepAliveTimer = setInterval(() => {
      this.broadcastComment("ping").catch(() => { });
    }, SSE_KEEP_ALIVE_INTERVAL_MS);
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/connect") {
      return this.handleConnect(request);
    }
    if (request.method === "POST" && url.pathname === "/publish") {
      return this.handlePublish(request);
    }
    return new Response("Not found", { status: 404 });
  }

  async handleConnect(request) {
    const url = new URL(request.url);
    const tenantId = normalizeRealtimeTenantId(url.searchParams.get("tenant_id"));
    const clientKey = normalizeRealtimeClientKey(url.searchParams.get("client_key"));
    return this.handleConnectWithTenant(tenantId, clientKey);
  }

  async handleConnectWithTenant(tenantId, clientKey = "") {
    const normalizedClientKey = normalizeRealtimeClientKey(clientKey);
    if (normalizedClientKey) {
      const previousClientId = this.clientKeyToId.get(normalizedClientKey);
      if (previousClientId) {
        await this.closeClient(previousClientId);
      }
    } else if (this.clients.size >= SSE_MAX_CLIENTS_PER_BROKER) {
      return new Response(JSON.stringify({
        success: false,
        error: "too_many_connections",
        message: "Capacidad de conexiones SSE alcanzada. Intenta nuevamente en unos segundos.",
      }), {
        status: 503,
        headers: {
          "Content-Type": "application/json",
          "Retry-After": "10",
        },
      });
    }

    const clientId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const stream = new TransformStream();
    const writer = stream.writable.getWriter();
    const reconnectAfterMs = 1000 + Math.floor(Math.random() * 4000);

    const reconnectTimer = setTimeout(() => {
      this.closeClient(clientId, {
        type: "reconnect",
        message: "Reconexión requerida",
        reconnect_after_ms: reconnectAfterMs,
        timestamp: nowIso(),
      }).catch(() => { });
    }, SSE_MAX_CONNECTION_MS);

    this.clients.set(clientId, {
      writer,
      reconnectTimer,
      tenantId: normalizeRealtimeTenantId(tenantId),
      connectedAt: Date.now(),
      clientKey: normalizedClientKey,
    });
    if (normalizedClientKey) {
      this.clientKeyToId.set(normalizedClientKey, clientId);
    }

    await this.writeData(writer, {
      type: "connected",
      message: "Conexión en tiempo real establecida",
      tenant_id: normalizeRealtimeTenantId(tenantId),
      reconnect_after_ms: reconnectAfterMs,
      timestamp: nowIso(),
    });

    return new Response(stream.readable, {
      status: 200,
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  }

  async handlePublish(request) {
    let payload = {};
    try {
      payload = await request.json();
    } catch {
      return new Response(JSON.stringify({ success: false, error: "invalid_json" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (!payload || typeof payload !== "object" || !payload.type) {
      return new Response(JSON.stringify({ success: false, error: "missing_type" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const tenantId = normalizeRealtimeTenantId(payload.tenant_id);
    const delivered = await this.broadcastData(payload, tenantId);
    return new Response(JSON.stringify({ success: true, delivered }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  async broadcastData(payload, tenantId = DEFAULT_REALTIME_TENANT_ID) {
    const staleClientIds = [];
    let delivered = 0;
    for (const [clientId, client] of this.clients.entries()) {
      if (normalizeRealtimeTenantId(client.tenantId) !== normalizeRealtimeTenantId(tenantId)) {
        continue;
      }
      try {
        await this.writeData(client.writer, payload);
        delivered += 1;
      } catch {
        staleClientIds.push(clientId);
      }
    }
    for (const clientId of staleClientIds) {
      await this.closeClient(clientId);
    }
    return delivered;
  }

  async broadcastComment(comment) {
    const staleClientIds = [];
    for (const [clientId, client] of this.clients.entries()) {
      try {
        await this.writeChunkWithTimeout(
          client.writer,
          this.encoder.encode(`:${comment}\n\n`),
        );
      } catch {
        staleClientIds.push(clientId);
      }
    }
    for (const clientId of staleClientIds) {
      await this.closeClient(clientId);
    }
  }

  async writeChunkWithTimeout(writer, chunk, timeoutMs = SSE_CLIENT_WRITE_TIMEOUT_MS) {
    let timeoutId = null;
    try {
      await Promise.race([
        writer.write(chunk),
        new Promise((_, reject) => {
          timeoutId = setTimeout(() => {
            reject(new Error("SSE client write timeout"));
          }, timeoutMs);
        }),
      ]);
    } finally {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    }
  }

  async writeData(writer, payload) {
    await this.writeChunkWithTimeout(
      writer,
      this.encoder.encode(`data: ${JSON.stringify(payload)}\n\n`),
    );
  }

  async closeClient(clientId, finalPayload = null) {
    const client = this.clients.get(clientId);
    if (!client) return;
    this.clients.delete(clientId);
    if (client.clientKey && this.clientKeyToId.get(client.clientKey) === clientId) {
      this.clientKeyToId.delete(client.clientKey);
    }
    if (client.reconnectTimer) clearTimeout(client.reconnectTimer);
    try {
      if (finalPayload) {
        await this.writeData(client.writer, finalPayload);
      }
    } catch { }
    try {
      await client.writer.close();
    } catch { }
  }
}

async function sha256Hex(bytes) {
  if (!globalThis.crypto?.subtle) {
    return null;
  }

  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function hmacSha256Hex(secret, message) {
  const keyData = new TextEncoder().encode(secret);
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    keyData,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(message));
  return [...new Uint8Array(signature)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function timingSafeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;

  // Evitar salida temprana por longitud para reducir leaks por timing.
  const maxLen = Math.max(a.length, b.length);
  const paddedA = a.padEnd(maxLen, "\0");
  const paddedB = b.padEnd(maxLen, "\0");

  let mismatch = a.length !== b.length ? 1 : 0;
  for (let i = 0; i < maxLen; i += 1) {
    mismatch |= paddedA.charCodeAt(i) ^ paddedB.charCodeAt(i);
  }
  return mismatch === 0;
}

function bytesToBase64Url(bytes) {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlToBytes(input) {
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  const padding = normalized.length % 4 === 0 ? "" : "=".repeat(4 - (normalized.length % 4));
  const decoded = atob(`${normalized}${padding}`);
  const bytes = new Uint8Array(decoded.length);
  for (let i = 0; i < decoded.length; i += 1) {
    bytes[i] = decoded.charCodeAt(i);
  }
  return bytes;
}

function base64UrlEncodeUtf8(text) {
  return bytesToBase64Url(new TextEncoder().encode(text));
}

function base64UrlDecodeUtf8(input) {
  return new TextDecoder().decode(base64UrlToBytes(input));
}

function pemToArrayBuffer(pemText) {
  const normalizedPem = normalizeOptionalString(pemText, "").replace(/\\n/g, "\n");
  const base64Body = normalizedPem
    .replace(/-----BEGIN PRIVATE KEY-----/g, "")
    .replace(/-----END PRIVATE KEY-----/g, "")
    .replace(/\s+/g, "");

  if (!base64Body) {
    throw new HttpError(500, "FCM service account invalido: private_key vacia.");
  }

  const binary = atob(base64Body);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

function normalizeNotificationData(rawData) {
  if (!rawData || typeof rawData !== "object") {
    return {};
  }

  const normalized = {};
  for (const [key, value] of Object.entries(rawData)) {
    const normalizedKey = normalizeOptionalString(key, "");
    if (!normalizedKey) continue;
    if (value === null || value === undefined) continue;
    normalized[normalizedKey] = String(value);
  }
  return normalized;
}

// Single audit persistence path (audit_logs).
async function logAuditEvent(
  env,
  { action, username, success, details, computerName, ipAddress, platform, timestamp, tenantId },
  options = {},
) {
  const swallowErrors = options?.swallowErrors !== false;
  try {
    const detailsJson = details && typeof details === "object" ? JSON.stringify(details) : "{}";
    const normalizedTenantId = normalizeRealtimeTenantId(
      tenantId || details?.tenant_id || DEFAULT_REALTIME_TENANT_ID,
    );
    const normalizedTimestamp = normalizeOptionalString(timestamp, nowIso());
    const normalizedAction = normalizeOptionalString(action, "unknown");
    const normalizedUsername = normalizeOptionalString(username, "unknown");
    const normalizedComputerName = normalizeOptionalString(computerName, "");
    const normalizedIpAddress = normalizeOptionalString(ipAddress, "");
    const normalizedPlatform = normalizeOptionalString(platform, "");

    try {
      await env.DB.prepare(`
        INSERT INTO audit_logs (
          tenant_id,
          timestamp,
          action,
          username,
          success,
          details,
          computer_name,
          ip_address,
          platform
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
        .bind(
          normalizedTenantId,
          normalizedTimestamp,
          normalizedAction,
          normalizedUsername,
          success ? 1 : 0,
          detailsJson,
          normalizedComputerName,
          normalizedIpAddress,
          normalizedPlatform,
        )
        .run();
    } catch (error) {
      if (!isMissingTenantColumnError(error)) {
        throw error;
      }

      await env.DB.prepare(`
        INSERT INTO audit_logs (timestamp, action, username, success, details, computer_name, ip_address, platform)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `)
        .bind(
          normalizedTimestamp,
          normalizedAction,
          normalizedUsername,
          success ? 1 : 0,
          detailsJson,
          normalizedComputerName,
          normalizedIpAddress,
          normalizedPlatform,
        )
        .run();
    }
  } catch (err) {
    if (!swallowErrors) {
      throw err;
    }
    console.error("Failed to write audit log:", err);
  }
}

function normalizeFcmServiceAccount(env) {

  const raw = normalizeOptionalString(env.FCM_SERVICE_ACCOUNT_JSON, "");
  if (!raw) return null;

  let parsed = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new HttpError(
      500,
      "FCM service account invalido: FCM_SERVICE_ACCOUNT_JSON no contiene JSON valido.",
    );
  }

  const projectId = normalizeOptionalString(parsed?.project_id, "");
  const clientEmail = normalizeOptionalString(parsed?.client_email, "");
  const privateKey = normalizeOptionalString(parsed?.private_key, "");
  const tokenUri = normalizeOptionalString(parsed?.token_uri, FCM_OAUTH_AUDIENCE) || FCM_OAUTH_AUDIENCE;

  if (!projectId || !clientEmail || !privateKey) {
    throw new HttpError(
      500,
      "FCM service account invalido: faltan project_id, client_email o private_key.",
    );
  }

  return {
    projectId,
    clientEmail,
    privateKey,
    tokenUri,
  };
}

function buildFcmServiceAccountFingerprint(serviceAccount) {
  if (!serviceAccount) return "";
  return [
    normalizeOptionalString(serviceAccount.projectId, ""),
    normalizeOptionalString(serviceAccount.clientEmail, ""),
    normalizeOptionalString(serviceAccount.tokenUri, ""),
    normalizeOptionalString(serviceAccount.privateKey, ""),
  ].join("|");
}

function readCachedFcmAccessToken(fingerprint, nowSeconds) {
  if (!fcmAccessTokenCache || !fingerprint) return null;
  if (normalizeOptionalString(fcmAccessTokenCache.fingerprint, "") !== fingerprint) return null;
  if (!normalizeOptionalString(fcmAccessTokenCache.accessToken, "")) return null;
  if (!Number.isInteger(fcmAccessTokenCache.expiresAt)) return null;
  if (fcmAccessTokenCache.expiresAt <= nowSeconds + 60) return null;

  return {
    accessToken: fcmAccessTokenCache.accessToken,
    projectId: fcmAccessTokenCache.projectId,
  };
}

async function signFcmAssertion(privateKeyPem, unsignedToken) {
  if (!globalThis.crypto?.subtle) {
    throw new HttpError(500, "No hay soporte crypto para firmar push FCM.");
  }

  const cryptoKey = await crypto.subtle.importKey(
    "pkcs8",
    pemToArrayBuffer(privateKeyPem),
    {
      name: "RSASSA-PKCS1-v1_5",
      hash: "SHA-256",
    },
    false,
    ["sign"],
  );

  const signatureBytes = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    cryptoKey,
    new TextEncoder().encode(unsignedToken),
  );
  return bytesToBase64Url(new Uint8Array(signatureBytes));
}

async function getFcmAccessToken(env) {
  const serviceAccount = normalizeFcmServiceAccount(env);
  if (!serviceAccount) {
    return null;
  }

  const serviceAccountFingerprint = buildFcmServiceAccountFingerprint(serviceAccount);
  const nowSeconds = nowUnixSeconds();
  if (
    fcmAccessTokenCache &&
    normalizeOptionalString(fcmAccessTokenCache.fingerprint, "") !== serviceAccountFingerprint
  ) {
    // Secret rotado/cambiado: invalidar cache previo.
    fcmAccessTokenCache = null;
  }

  const cachedToken = readCachedFcmAccessToken(serviceAccountFingerprint, nowSeconds);
  if (cachedToken) {
    return cachedToken;
  }

  if (
    fcmAccessTokenRefreshState &&
    fcmAccessTokenRefreshState.fingerprint === serviceAccountFingerprint &&
    fcmAccessTokenRefreshState.promise
  ) {
    return fcmAccessTokenRefreshState.promise;
  }

  const refreshPromise = (async () => {
    const tokenRequestNow = nowUnixSeconds();
    const header = {
      alg: "RS256",
      typ: "JWT",
    };
    const payload = {
      iss: serviceAccount.clientEmail,
      scope: FCM_OAUTH_SCOPE,
      aud: serviceAccount.tokenUri,
      iat: tokenRequestNow,
      exp: tokenRequestNow + 3600,
    };

    const encodedHeader = base64UrlEncodeUtf8(JSON.stringify(header));
    const encodedPayload = base64UrlEncodeUtf8(JSON.stringify(payload));
    const unsignedToken = `${encodedHeader}.${encodedPayload}`;
    const signature = await signFcmAssertion(serviceAccount.privateKey, unsignedToken);
    const assertion = `${unsignedToken}.${signature}`;

    const tokenResponse = await fetch(serviceAccount.tokenUri, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: FCM_OAUTH_GRANT_TYPE,
        assertion,
      }).toString(),
    });

    let tokenJson = {};
    try {
      tokenJson = await tokenResponse.json();
    } catch {
      tokenJson = {};
    }

    if (!tokenResponse.ok) {
      const description =
        normalizeOptionalString(tokenJson?.error_description, "") ||
        normalizeOptionalString(tokenJson?.error, "") ||
        `HTTP ${tokenResponse.status}`;
      throw new HttpError(500, `No se pudo obtener access token FCM: ${description}`);
    }

    const accessToken = normalizeOptionalString(tokenJson?.access_token, "");
    const expiresIn = Number.parseInt(String(tokenJson?.expires_in ?? "0"), 10);

    if (!accessToken || !Number.isInteger(expiresIn) || expiresIn <= 0) {
      throw new HttpError(500, "Respuesta invalida al solicitar access token FCM.");
    }

    fcmAccessTokenCache = {
      fingerprint: serviceAccountFingerprint,
      projectId: serviceAccount.projectId,
      accessToken,
      expiresAt: tokenRequestNow + expiresIn,
    };

    return {
      accessToken,
      projectId: serviceAccount.projectId,
    };
  })();

  fcmAccessTokenRefreshState = {
    fingerprint: serviceAccountFingerprint,
    promise: refreshPromise,
  };

  try {
    return await refreshPromise;
  } finally {
    if (fcmAccessTokenRefreshState?.promise === refreshPromise) {
      fcmAccessTokenRefreshState = null;
    }
  }
}

function ensureDbBinding(env) {
  if (!env.DB) {
    throw new Error("La base de datos (D1) no esta vinculada a este Worker.");
  }
}

function ensureDeviceTokensTableAvailable(error) {
  const message = normalizeOptionalString(error?.message, "").toLowerCase();
  if (message.includes("no such table") && message.includes("device_tokens")) {
    throw new HttpError(
      500,
      "Falta esquema de push notifications en D1. Ejecuta las migraciones (incluyendo 0006_device_tokens.sql).",
    );
  }
  throw error;
}

function isMissingTenantColumnError(error) {
  const message = normalizeOptionalString(error?.message, "").toLowerCase();
  return message.includes("no such column") && message.includes("tenant_id");
}

async function ensureInstallationExistsForDelete(env, installationId, tenantId) {
  try {
    const { results } = await env.DB.prepare(`
      SELECT id
      FROM installations
      WHERE id = ?
        AND tenant_id = ?
      LIMIT 1
    `)
      .bind(installationId, tenantId)
      .all();
    if (results?.length) return true;
    return false;
  } catch (error) {
    if (!isMissingTenantColumnError(error)) {
      throw error;
    }
  }

  const { results } = await env.DB.prepare(`
    SELECT id
    FROM installations
    WHERE id = ?
    LIMIT 1
  `)
    .bind(installationId)
    .all();
  return Boolean(results?.length);
}

async function listIncidentPhotoR2KeysForInstallation(env, installationId, tenantId) {
  try {
    const { results } = await env.DB.prepare(`
      SELECT p.r2_key
      FROM incident_photos p
      INNER JOIN incidents i ON i.id = p.incident_id
      WHERE i.installation_id = ?
        AND i.tenant_id = ?
    `)
      .bind(installationId, tenantId)
      .all();
    return (results || [])
      .map((row) => normalizeOptionalString(row?.r2_key, ""))
      .filter((key) => key);
  } catch (error) {
    if (!isMissingTenantColumnError(error)) {
      throw error;
    }
  }

  const { results } = await env.DB.prepare(`
    SELECT p.r2_key
    FROM incident_photos p
    INNER JOIN incidents i ON i.id = p.incident_id
    WHERE i.installation_id = ?
  `)
    .bind(installationId)
    .all();
  return (results || [])
    .map((row) => normalizeOptionalString(row?.r2_key, ""))
    .filter((key) => key);
}

async function deleteIncidentPhotoObjectsFromR2(env, r2Keys) {
  const uniqueKeys = [...new Set((r2Keys || []).map((key) => normalizeOptionalString(key, "")).filter((key) => key))];
  if (uniqueKeys.length === 0) {
    return {
      attempted_count: 0,
      deleted_count: 0,
      error_count: 0,
      skipped: true,
    };
  }
  if (!env.INCIDENTS_BUCKET || typeof env.INCIDENTS_BUCKET.delete !== "function") {
    return {
      attempted_count: uniqueKeys.length,
      deleted_count: 0,
      error_count: 0,
      skipped: true,
    };
  }

  let deletedCount = 0;
  let errorCount = 0;
  for (const key of uniqueKeys) {
    if (!key) continue;
    try {
      await env.INCIDENTS_BUCKET.delete(key);
      deletedCount += 1;
    } catch (error) {
      errorCount += 1;
      console.error("[R2] failed to delete incident photo object", { key, error: String(error) });
    }
  }
  return {
    attempted_count: uniqueKeys.length,
    deleted_count: deletedCount,
    error_count: errorCount,
    skipped: false,
  };
}

async function deleteInstallationCascade(env, installationId, tenantId) {
  try {
    await env.DB.prepare(`
      DELETE FROM incident_photos
      WHERE incident_id IN (
        SELECT id
        FROM incidents
        WHERE installation_id = ?
          AND tenant_id = ?
      )
    `)
      .bind(installationId, tenantId)
      .run();

    await env.DB.prepare(`
      DELETE FROM incidents
      WHERE installation_id = ?
        AND tenant_id = ?
    `)
      .bind(installationId, tenantId)
      .run();

    await env.DB.prepare(`
      DELETE FROM installations
      WHERE id = ?
        AND tenant_id = ?
    `)
      .bind(installationId, tenantId)
      .run();
    return;
  } catch (error) {
    if (!isMissingTenantColumnError(error)) {
      throw error;
    }
  }

  await env.DB.prepare(`
    DELETE FROM incident_photos
    WHERE incident_id IN (
      SELECT id
      FROM incidents
      WHERE installation_id = ?
    )
  `)
    .bind(installationId)
    .run();

  await env.DB.prepare(`
    DELETE FROM incidents
    WHERE installation_id = ?
  `)
    .bind(installationId)
    .run();

  await env.DB.prepare(`
    DELETE FROM installations
    WHERE id = ?
  `)
    .bind(installationId)
    .run();
}

async function listOrphanIncidentPhotoRows(env, tenantId) {
  try {
    const { results } = await env.DB.prepare(`
      SELECT p.id, p.r2_key
      FROM incident_photos p
      LEFT JOIN incidents i ON i.id = p.incident_id
        AND i.tenant_id = p.tenant_id
      LEFT JOIN installations ins ON ins.id = i.installation_id
        AND ins.tenant_id = i.tenant_id
      WHERE p.tenant_id = ?
        AND (i.id IS NULL OR ins.id IS NULL)
    `)
      .bind(tenantId)
      .all();
    return {
      tenantScoped: true,
      rows: (results || [])
        .map((row) => ({
          id: Number.parseInt(String(row?.id ?? ""), 10),
          r2_key: normalizeOptionalString(row?.r2_key, ""),
        }))
        .filter((row) => Number.isInteger(row.id) && row.id > 0),
    };
  } catch (error) {
    if (!isMissingTenantColumnError(error)) {
      throw error;
    }
  }

  const { results } = await env.DB.prepare(`
    SELECT p.id, p.r2_key
    FROM incident_photos p
    LEFT JOIN incidents i ON i.id = p.incident_id
    LEFT JOIN installations ins ON ins.id = i.installation_id
    WHERE i.id IS NULL OR ins.id IS NULL
  `).all();
  return {
    tenantScoped: false,
    rows: (results || [])
      .map((row) => ({
        id: Number.parseInt(String(row?.id ?? ""), 10),
        r2_key: normalizeOptionalString(row?.r2_key, ""),
      }))
      .filter((row) => Number.isInteger(row.id) && row.id > 0),
  };
}

async function listOrphanIncidentIds(env, tenantId) {
  try {
    const { results } = await env.DB.prepare(`
      SELECT i.id
      FROM incidents i
      LEFT JOIN installations ins ON ins.id = i.installation_id
        AND ins.tenant_id = i.tenant_id
      WHERE i.tenant_id = ?
        AND ins.id IS NULL
    `)
      .bind(tenantId)
      .all();
    return {
      tenantScoped: true,
      ids: (results || [])
        .map((row) => Number.parseInt(String(row?.id ?? ""), 10))
        .filter((id) => Number.isInteger(id) && id > 0),
    };
  } catch (error) {
    if (!isMissingTenantColumnError(error)) {
      throw error;
    }
  }

  const { results } = await env.DB.prepare(`
    SELECT i.id
    FROM incidents i
    LEFT JOIN installations ins ON ins.id = i.installation_id
    WHERE ins.id IS NULL
  `).all();
  return {
    tenantScoped: false,
    ids: (results || [])
      .map((row) => Number.parseInt(String(row?.id ?? ""), 10))
      .filter((id) => Number.isInteger(id) && id > 0),
  };
}

async function deleteIncidentPhotoRowsById(env, photoIds, tenantId, tenantScoped = true) {
  const uniqueIds = [...new Set((photoIds || []).map((value) => Number.parseInt(String(value), 10)).filter((id) => Number.isInteger(id) && id > 0))];
  if (uniqueIds.length === 0) return 0;

  let deletedCount = 0;
  if (tenantScoped) {
    try {
      for (const photoId of uniqueIds) {
        await env.DB.prepare(`
          DELETE FROM incident_photos
          WHERE id = ?
            AND tenant_id = ?
        `)
          .bind(photoId, tenantId)
          .run();
        deletedCount += 1;
      }
      return deletedCount;
    } catch (error) {
      if (!isMissingTenantColumnError(error)) {
        throw error;
      }
      deletedCount = 0;
    }
  }

  for (const photoId of uniqueIds) {
    await env.DB.prepare(`
      DELETE FROM incident_photos
      WHERE id = ?
    `)
      .bind(photoId)
      .run();
    deletedCount += 1;
  }
  return deletedCount;
}

async function deleteIncidentsById(env, incidentIds, tenantId, tenantScoped = true) {
  const uniqueIds = [...new Set((incidentIds || []).map((value) => Number.parseInt(String(value), 10)).filter((id) => Number.isInteger(id) && id > 0))];
  if (uniqueIds.length === 0) return 0;

  let deletedCount = 0;
  if (tenantScoped) {
    try {
      for (const incidentId of uniqueIds) {
        await env.DB.prepare(`
          DELETE FROM incidents
          WHERE id = ?
            AND tenant_id = ?
        `)
          .bind(incidentId, tenantId)
          .run();
        deletedCount += 1;
      }
      return deletedCount;
    } catch (error) {
      if (!isMissingTenantColumnError(error)) {
        throw error;
      }
      deletedCount = 0;
    }
  }

  for (const incidentId of uniqueIds) {
    await env.DB.prepare(`
      DELETE FROM incidents
      WHERE id = ?
    `)
      .bind(incidentId)
      .run();
    deletedCount += 1;
  }
  return deletedCount;
}

async function cleanupOrphanInstallationArtifacts(env, tenantId, options = {}) {
  const dryRun = Boolean(options?.dryRun);
  const orphanPhotoResult = await listOrphanIncidentPhotoRows(env, tenantId);
  const orphanIncidentResult = await listOrphanIncidentIds(env, tenantId);
  const orphanPhotoRows = orphanPhotoResult.rows || [];
  const orphanIncidentIds = orphanIncidentResult.ids || [];
  const r2Keys = orphanPhotoRows.map((row) => row.r2_key).filter((key) => key);

  if (dryRun) {
    return {
      scanned_orphan_photo_rows: orphanPhotoRows.length,
      scanned_orphan_incidents: orphanIncidentIds.length,
      deleted_photo_rows: 0,
      deleted_incidents: 0,
      r2_attempted: r2Keys.length,
      r2_deleted: 0,
      r2_errors: 0,
      tenant_scoped: Boolean(orphanPhotoResult.tenantScoped && orphanIncidentResult.tenantScoped),
    };
  }

  const r2Result = await deleteIncidentPhotoObjectsFromR2(env, r2Keys);
  const deletedPhotoRows = await deleteIncidentPhotoRowsById(
    env,
    orphanPhotoRows.map((row) => row.id),
    tenantId,
    orphanPhotoResult.tenantScoped,
  );
  const deletedIncidents = await deleteIncidentsById(
    env,
    orphanIncidentIds,
    tenantId,
    orphanIncidentResult.tenantScoped,
  );

  return {
    scanned_orphan_photo_rows: orphanPhotoRows.length,
    scanned_orphan_incidents: orphanIncidentIds.length,
    deleted_photo_rows: deletedPhotoRows,
    deleted_incidents: deletedIncidents,
    r2_attempted: Number(r2Result?.attempted_count || 0),
    r2_deleted: Number(r2Result?.deleted_count || 0),
    r2_errors: Number(r2Result?.error_count || 0),
    tenant_scoped: Boolean(orphanPhotoResult.tenantScoped && orphanIncidentResult.tenantScoped),
  };
}

function normalizeFcmToken(value) {
  const token = normalizeOptionalString(value, "");
  if (!token) {
    throw new HttpError(400, "Campo 'fcm_token' es obligatorio.");
  }
  if (token.length < 20 || token.length > 4096) {
    throw new HttpError(400, "Campo 'fcm_token' invalido.");
  }
  return token;
}

function parseBooleanOrNull(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  const normalized = normalizeOptionalString(value, "").toLowerCase();
  if (!normalized) return null;
  if (["1", "true", "yes", "active", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "inactive", "off"].includes(normalized)) return false;
  return null;
}

function requireAdminRole(role) {
  if (!["admin", "super_admin"].includes(normalizeOptionalString(role, "").toLowerCase())) {
    throw new HttpError(403, "No tienes permisos para administrar usuarios web.");
  }
}

function requireSuperAdminRole(role) {
  if (normalizeOptionalString(role, "").toLowerCase() !== "super_admin") {
    throw new HttpError(403, "Solo super_admin puede eliminar incidencias.");
  }
}

function requireWebWriteRole(role) {
  if (!["admin", "super_admin"].includes(normalizeOptionalString(role, "").toLowerCase())) {
    throw new HttpError(403, "No tienes permisos para modificar datos.");
  }
}

async function upsertDeviceTokenForWebUser(
  env,
  {
    userId,
    fcmToken,
    tenantId = DEFAULT_REALTIME_TENANT_ID,
    deviceModel = "",
    appVersion = "",
    platform = "android",
  },
) {
  const registeredAt = nowIso();
  const normalizedTenantId = normalizeRealtimeTenantId(tenantId);
  try {
    try {
      await env.DB.prepare(`
        INSERT INTO device_tokens (
          tenant_id,
          user_id,
          fcm_token,
          device_model,
          app_version,
          platform,
          registered_at,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(fcm_token) DO UPDATE
        SET tenant_id = excluded.tenant_id,
            user_id = excluded.user_id,
            device_model = excluded.device_model,
            app_version = excluded.app_version,
            platform = excluded.platform,
            registered_at = excluded.registered_at,
            updated_at = excluded.updated_at
      `)
        .bind(
          normalizedTenantId,
          userId,
          fcmToken,
          normalizeOptionalString(deviceModel, ""),
          normalizeOptionalString(appVersion, ""),
          normalizeOptionalString(platform, "android"),
          registeredAt,
          registeredAt,
        )
        .run();
    } catch (error) {
      if (!isMissingTenantColumnError(error)) {
        throw error;
      }

      await env.DB.prepare(`
        INSERT INTO device_tokens (user_id, fcm_token, device_model, app_version, platform, registered_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(fcm_token) DO UPDATE
        SET user_id = excluded.user_id,
            device_model = excluded.device_model,
            app_version = excluded.app_version,
            platform = excluded.platform,
            registered_at = excluded.registered_at,
            updated_at = excluded.updated_at
      `)
        .bind(
          userId,
          fcmToken,
          normalizeOptionalString(deviceModel, ""),
          normalizeOptionalString(appVersion, ""),
          normalizeOptionalString(platform, "android"),
          registeredAt,
          registeredAt,
        )
        .run();
    }
  } catch (error) {
    ensureDeviceTokensTableAvailable(error);
  }
}

async function listDeviceTokensForWebRoles(
  env,
  roles = [],
  tenantId = DEFAULT_REALTIME_TENANT_ID,
) {
  const normalizedRoles = (roles || [])
    .map((role) => normalizeOptionalString(role, "").toLowerCase())
    .filter((role) => role);
  if (!normalizedRoles.length) return [];
  const normalizedTenantId = normalizeRealtimeTenantId(tenantId);

  const placeholders = normalizedRoles.map(() => "?").join(", ");

  try {
    const { results } = await env.DB.prepare(`
      SELECT DISTINCT dt.fcm_token
      FROM device_tokens dt
      INNER JOIN web_users wu ON wu.id = dt.user_id
      WHERE wu.is_active = 1
        AND wu.role IN (${placeholders})
        AND wu.tenant_id = ?
        AND dt.tenant_id = ?
        AND NULLIF(TRIM(dt.fcm_token), '') IS NOT NULL
    `)
      .bind(...normalizedRoles, normalizedTenantId, normalizedTenantId)
      .all();

    return (results || [])
      .map((row) => normalizeOptionalString(row?.fcm_token, ""))
      .filter((token) => token);
  } catch (error) {
    const message = normalizeOptionalString(error?.message, "").toLowerCase();
    if (message.includes("no such column") && message.includes("tenant_id")) {
      throw new HttpError(
        500,
        "Falta esquema multi-tenant en D1 para push notifications. Ejecuta migraciones recientes.",
      );
    }
    if (message.includes("no such table") && message.includes("web_users")) {
      ensureWebUsersTableAvailable(error);
    }
    ensureDeviceTokensTableAvailable(error);
  }
}

async function sendPushNotification(env, fcmTokens, notification) {
  const access = await getFcmAccessToken(env);
  if (!access) {
    return { sent: false, reason: "missing_fcm_service_account_json" };
  }

  const uniqueTokens = [...new Set(
    (Array.isArray(fcmTokens) ? fcmTokens : [])
      .map((token) => normalizeOptionalString(token, ""))
      .filter((token) => token),
  )];
  if (!uniqueTokens.length) {
    return { sent: false, reason: "no_device_tokens" };
  }

  const title = normalizeOptionalString(notification?.title, "");
  const body = normalizeOptionalString(notification?.body, "");
  if (!title || !body) {
    return { sent: false, reason: "invalid_notification_payload" };
  }

  const tokenSubset = uniqueTokens.slice(0, PUSH_NOTIFICATION_MAX_TOKENS_PER_REQUEST);
  const dataPayload = normalizeNotificationData(notification?.data);

  let successfulRequests = 0;
  for (const token of tokenSubset) {
    const response = await fetch(
      `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(access.projectId)}/messages:send`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${access.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: {
            token,
            notification: {
              title,
              body,
            },
            data: dataPayload,
            android: {
              priority: "HIGH",
              notification: {
                sound: "default",
                channel_id: "incidents",
              },
            },
          },
        }),
      },
    );

    if (response.ok) {
      successfulRequests += 1;
    }
  }

  return {
    sent: successfulRequests > 0,
    request_count: tokenSubset.length,
    successful_requests: successfulRequests,
    token_count: tokenSubset.length,
  };
}

async function sendLoanReminderEmail(env, { tenantId, dueSoonLoans = [], overdueLoans = [] }) {
  const recipients = normalizeEmailRecipients(env?.LOAN_REMINDER_EMAIL_TO);
  if (!env?.RESEND_API_KEY || !env?.RESEND_FROM_EMAIL) {
    return { delivered: false, skipped: true, reason: "resend_not_configured" };
  }
  if (!recipients.length) {
    return { delivered: false, skipped: true, reason: "loan_reminder_recipients_missing" };
  }

  const dueSoonCount = dueSoonLoans.length;
  const overdueCount = overdueLoans.length;
  if (!dueSoonCount && !overdueCount) {
    return { delivered: false, skipped: true, reason: "no_loans_to_notify" };
  }

  const subjectParts = [];
  if (overdueCount) subjectParts.push(`${overdueCount} vencido${overdueCount === 1 ? "" : "s"}`);
  if (dueSoonCount) subjectParts.push(`${dueSoonCount} por vencer`);
  const subject = `[SiteOps] Prestamos ${subjectParts.join(" | ")} | tenant ${tenantId}`;

  const lines = [`Tenant: ${tenantId}`, ""];

  if (overdueCount) {
    lines.push("Prestamos vencidos:");
    overdueLoans.forEach((loan) => {
      lines.push(
        `- ${loan.asset_external_code || `#${loan.asset_id}`}: ${loan.borrowing_client || "-"} | ` +
        `esperado ${normalizeOptionalString(loan.expected_return_at, "-")} | ` +
        `origen ${loan.original_client || "-"}`,
      );
    });
    lines.push("");
  }

  if (dueSoonCount) {
    lines.push("Prestamos proximos a vencer:");
    dueSoonLoans.forEach((loan) => {
      lines.push(
        `- ${loan.asset_external_code || `#${loan.asset_id}`}: ${loan.borrowing_client || "-"} | ` +
        `esperado ${normalizeOptionalString(loan.expected_return_at, "-")} | ` +
        `origen ${loan.original_client || "-"}`,
      );
    });
    lines.push("");
  }

  const response = await fetch(RESEND_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: env.RESEND_FROM_EMAIL,
      to: recipients,
      subject,
      text: lines.join("\n"),
    }),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    return {
      delivered: false,
      skipped: false,
      reason: normalizeOptionalString(errorText, `HTTP ${response.status}`),
    };
  }

  return {
    delivered: true,
    skipped: false,
    recipient_count: recipients.length,
  };
}

function normalizeIncidentStatus(value, fallback = "open") {
  const normalized = normalizeOptionalString(value, fallback).toLowerCase();
  if (!ALLOWED_INCIDENT_STATUSES.has(normalized)) {
    throw new HttpError(
      400,
      `Campo 'incident_status' invalido. Valores permitidos: ${[...ALLOWED_INCIDENT_STATUSES].join(", ")}.`,
    );
  }
  return normalized;
}

function normalizeResolutionNote(value) {
  const note = normalizeOptionalString(value, "").trim();
  if (note.length > 2000) {
    throw new HttpError(400, "Campo 'resolution_note' supera el limite permitido.");
  }
  return note;
}

function normalizeIncidentStatusPayload(data) {
  if (!data || typeof data !== "object") {
    throw new HttpError(400, "Payload invalido.");
  }

  const incidentStatus = normalizeIncidentStatus(data.incident_status ?? data.status, "open");
  const resolutionNote = normalizeResolutionNote(data.resolution_note);
  return {
    incidentStatus,
    resolutionNote: resolutionNote || null,
  };
}

function parseIncidentChecklistItems(rawValue) {
  if (rawValue === null || rawValue === undefined || rawValue === "") {
    return [];
  }

  let parsed = rawValue;
  if (typeof rawValue === "string") {
    try {
      parsed = JSON.parse(rawValue);
    } catch {
      return [];
    }
  }

  if (!Array.isArray(parsed)) {
    return [];
  }

  const deduped = [];
  const seen = new Set();
  for (const item of parsed) {
    const normalized = normalizeOptionalString(item, "").trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    deduped.push(normalized);
    if (deduped.length >= 30) break;
  }
  return deduped;
}

function normalizeIncidentEvidencePayload(data) {
  if (!data || typeof data !== "object") {
    throw new HttpError(400, "Payload invalido.");
  }

  const hasChecklistItems = Object.prototype.hasOwnProperty.call(data, "checklist_items");
  const hasEvidenceNote = Object.prototype.hasOwnProperty.call(data, "evidence_note");

  if (!hasChecklistItems && !hasEvidenceNote) {
    throw new HttpError(400, "Debes enviar checklist_items o evidence_note.");
  }

  let checklistItems = null;
  if (hasChecklistItems) {
    if (data.checklist_items === null) {
      checklistItems = [];
    } else if (!Array.isArray(data.checklist_items)) {
      throw new HttpError(400, "Campo 'checklist_items' invalido.");
    } else {
      checklistItems = [];
      const seen = new Set();
      for (const item of data.checklist_items) {
        const normalized = normalizeOptionalString(item, "").trim();
        if (!normalized || seen.has(normalized)) continue;
        if (normalized.length > 180) {
          throw new HttpError(400, "Cada item de checklist debe tener hasta 180 caracteres.");
        }
        seen.add(normalized);
        checklistItems.push(normalized);
        if (checklistItems.length > 30) {
          throw new HttpError(400, "Campo 'checklist_items' supera el maximo permitido (30).");
        }
      }
    }
  }

  let evidenceNote = null;
  if (hasEvidenceNote) {
    const normalizedNote = normalizeOptionalString(data.evidence_note, "").trim();
    if (normalizedNote.length > 2000) {
      throw new HttpError(400, "Campo 'evidence_note' supera el limite permitido.");
    }
    evidenceNote = normalizedNote || null;
  }

  return {
    hasChecklistItems,
    checklistItems,
    hasEvidenceNote,
    evidenceNote,
  };
}

function mapIncidentRow(incident, photos = undefined) {
  const safeIncident = incident && typeof incident === "object" ? incident : {};
  const { checklist_json: _ignoredChecklistJson, ...rest } = safeIncident;
  const gps = {
    ...buildDefaultGpsSnapshot(),
    gps_lat: safeIncident.gps_lat ?? null,
    gps_lng: safeIncident.gps_lng ?? null,
    gps_accuracy_m: safeIncident.gps_accuracy_m ?? null,
    gps_captured_at: safeIncident.gps_captured_at ?? null,
    gps_capture_source: normalizeOptionalString(safeIncident.gps_capture_source, "none").toLowerCase(),
    gps_capture_status: normalizeOptionalString(safeIncident.gps_capture_status, "pending").toLowerCase(),
    gps_capture_note: normalizeOptionalString(safeIncident.gps_capture_note, ""),
  };
  const geofence = {
    ...buildDefaultGeofenceSnapshot(),
    geofence_distance_m: safeIncident.geofence_distance_m ?? null,
    geofence_radius_m: safeIncident.geofence_radius_m ?? null,
    geofence_result: normalizeOptionalString(safeIncident.geofence_result, "not_applicable").toLowerCase(),
    geofence_checked_at: safeIncident.geofence_checked_at ?? null,
    geofence_override_note: normalizeOptionalString(safeIncident.geofence_override_note, ""),
    geofence_override_by: normalizeOptionalString(safeIncident.geofence_override_by, "") || null,
    geofence_override_at: safeIncident.geofence_override_at ?? null,
  };
  const normalizedStatus = normalizeOptionalString(safeIncident.incident_status, "open")
    .toLowerCase();
  const estimatedDurationSeconds = normalizeNonNegativeInteger(
    safeIncident.estimated_duration_seconds,
    Math.max(0, Number(safeIncident.time_adjustment_seconds) || 0),
  );

  const parseIsoMillis = (isoValue) => {
    if (!isoValue) return null;
    const parsed = Date.parse(String(isoValue));
    return Number.isFinite(parsed) ? parsed : null;
  };

  const createdAtIso = normalizeOptionalString(safeIncident.created_at, "").trim() || null;
  const statusUpdatedAtIso = normalizeOptionalString(safeIncident.status_updated_at, "").trim() || null;
  const resolvedAtIso = normalizeOptionalString(safeIncident.resolved_at, "").trim() || null;
  const workStartedAtIso = normalizeOptionalString(safeIncident.work_started_at, "").trim() || null;
  const workEndedAtIso = normalizeOptionalString(safeIncident.work_ended_at, "").trim() || null;

  const createdAtMs = parseIsoMillis(createdAtIso);
  const statusUpdatedAtMs = parseIsoMillis(statusUpdatedAtIso);
  const resolvedAtMs = parseIsoMillis(resolvedAtIso);
  const workStartedAtMs = parseIsoMillis(workStartedAtIso);
  const workEndedAtMs = parseIsoMillis(workEndedAtIso);

  const runtimeStartMs =
    workStartedAtMs ??
    (normalizedStatus === "in_progress" ? statusUpdatedAtMs : null) ??
    createdAtMs;
  const runtimeEndMs =
    workEndedAtMs ??
    resolvedAtMs ??
    (normalizedStatus === "in_progress" ? Date.now() : null);

  const persistedActualDuration = Number.parseInt(
    String(safeIncident.actual_duration_seconds ?? ""),
    10,
  );
  let derivedRuntimeDuration = null;
  if (
    Number.isFinite(runtimeStartMs) &&
    Number.isFinite(runtimeEndMs) &&
    runtimeEndMs >= runtimeStartMs
  ) {
    derivedRuntimeDuration = Math.floor((runtimeEndMs - runtimeStartMs) / 1000);
  }
  const actualDurationSeconds =
    Number.isInteger(persistedActualDuration) && persistedActualDuration >= 0
      ? normalizedStatus === "in_progress" && Number.isInteger(derivedRuntimeDuration) && derivedRuntimeDuration >= 0
        ? persistedActualDuration + derivedRuntimeDuration
        : persistedActualDuration
      : derivedRuntimeDuration;

  const mapped = {
    ...rest,
    ...gps,
    ...geofence,
    checklist_items: parseIncidentChecklistItems(safeIncident.checklist_json),
    evidence_note: normalizeOptionalString(safeIncident.evidence_note, "").trim() || null,
    estimated_duration_seconds: estimatedDurationSeconds,
    work_started_at: workStartedAtIso,
    work_ended_at: workEndedAtIso,
    actual_duration_seconds: actualDurationSeconds,
  };

  if (photos !== undefined) {
    mapped.photos = photos;
  }

  return mapped;
}

function validateIncidentPayload(data, options = {}) {
  if (!data || typeof data !== "object") {
    throw new HttpError(400, "Payload inválido.");
  }

  const note = typeof data.note === "string" ? data.note.trim() : "";
  if (!note) {
    throw new HttpError(400, "Campo 'note' es obligatorio.");
  }
  if (note.length > 5000) {
    throw new HttpError(400, "Campo 'note' supera el límite permitido.");
  }

  const timeAdjustment =
    data.time_adjustment_seconds === undefined ? 0 : Number(data.time_adjustment_seconds);
  if (!Number.isInteger(timeAdjustment) || timeAdjustment < -86400 || timeAdjustment > 86400) {
    throw new HttpError(400, "Campo 'time_adjustment_seconds' inválido.");
  }

  const estimatedDurationSeconds =
    data.estimated_duration_seconds === undefined
      ? Math.max(0, timeAdjustment)
      : Number(data.estimated_duration_seconds);
  if (
    !Number.isInteger(estimatedDurationSeconds) ||
    estimatedDurationSeconds < 0 ||
    estimatedDurationSeconds > MAX_INCIDENT_ESTIMATED_DURATION_SECONDS
  ) {
    throw new HttpError(400, "Campo 'estimated_duration_seconds' invalido.");
  }

  const severity = data.severity || "medium";
  if (!["low", "medium", "high", "critical"].includes(severity)) {
    throw new HttpError(400, "Campo 'severity' inválido.");
  }

  const source = data.source || options.defaultSource || "mobile";
  if (!["desktop", "mobile", "web"].includes(source)) {
    throw new HttpError(400, "Campo 'source' inválido.");
  }

  return {
    note,
    timeAdjustment,
    estimatedDurationSeconds,
    severity,
    source,
    incidentStatus: "open",
    applyToInstallation: Boolean(data.apply_to_installation),
    reporterUsername: normalizeOptionalString(
      data.reporter_username || data.username,
      normalizeOptionalString(options.defaultReporterUsername, "unknown"),
    ),
  };
}

async function handleSseEventsRoute(request, env, url, corsPolicy, routeParts) {
  if (routeParts.length !== 1 || routeParts[0] !== "events" || request.method !== "GET") {
    return null;
  }

  const tokenInQuery = normalizeOptionalString(url.searchParams.get("token"), "");
  if (tokenInQuery) {
    throw new HttpError(
      400,
      "No se permite token en query string para SSE. Usa Authorization Bearer o cookie de sesion.",
    );
  }

  // Verify authentication
  let sseWebSession = null;
  try {
    sseWebSession = await verifyWebAccessToken(request, env);
  } catch (err) {
    return jsonResponse(request, env, corsPolicy, { error: "Unauthorized" }, 401);
  }
  const sseTenantId = resolveRealtimeTenantId(request, sseWebSession);
  const sseClientKey = buildRealtimeClientKeyFromSession(sseWebSession);

  const brokerStreamResponse = await connectRealtimeBrokerStream(
    request,
    env,
    corsPolicy,
    sseTenantId,
    sseClientKey,
  );
  if (brokerStreamResponse) {
    return brokerStreamResponse;
  }
  if (!env.DB) {
    throw new Error("La base de datos (D1) no esta vinculada a este Worker.");
  }

  const encoder = new TextEncoder();
  let closed = false;
  let pollingInFlight = false;
  let pollTimer = null;
  let keepAlive = null;
  let forceCloseTimer = null;

  const stream = new ReadableStream({
    async start(controller) {
      const sendEvent = (payload) => {
        if (closed) return;
        const withTenant = {
          tenant_id: sseTenantId,
          ...payload,
        };
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(withTenant)}\n\n`));
      };
      const sendComment = (comment) => {
        if (closed) return;
        controller.enqueue(encoder.encode(`:${comment}\n\n`));
      };

      const sseState = await getSseLatestState(env, sseTenantId);

      // Send initial connection message
      sendEvent({
        type: "connected",
        message: "Conexion en tiempo real establecida",
        timestamp: nowIso()
      });
      sendEvent({
        type: "cursor",
        last_installation_id: sseState.lastInstallationId,
        last_incident_id: sseState.lastIncidentId,
        timestamp: nowIso(),
      });

      const pollAndEmit = async () => {
        if (closed || pollingInFlight) return;
        pollingInFlight = true;
        try {
          let emittedMutation = false;

          const newInstallations = await getInstallationsAfterId(
            env,
            sseState.lastInstallationId,
            25,
            sseTenantId,
          );
          for (const installation of newInstallations) {
            sseState.lastInstallationId = Math.max(sseState.lastInstallationId, Number(installation.id || 0));
            sendEvent({
              type: "installation_created",
              installation,
              timestamp: nowIso(),
            });
            emittedMutation = true;
          }

          const newIncidents = await getIncidentsAfterId(
            env,
            sseState.lastIncidentId,
            25,
            sseTenantId,
          );
          for (const incident of newIncidents) {
            sseState.lastIncidentId = Math.max(sseState.lastIncidentId, Number(incident.id || 0));
            sendEvent({
              type: "incident_created",
              incident,
              timestamp: nowIso(),
            });
            emittedMutation = true;
          }

          if (emittedMutation) {
            const statistics = await getSseStatisticsSnapshot(env, sseTenantId);
            sendEvent({
              type: "stats_update",
              statistics,
              timestamp: nowIso(),
            });
          }
        } catch (pollErr) {
          sendEvent({
            type: "error",
            message: "Error en sondeo de cambios SSE",
            timestamp: nowIso(),
          });
          console.error("[SSE] poll failed:", pollErr);
        } finally {
          pollingInFlight = false;
        }
      };

      // Try immediately so clients don't wait a full interval after connect.
      await pollAndEmit();
      pollTimer = setInterval(() => {
        pollAndEmit().catch(() => { });
      }, SSE_POLL_INTERVAL_MS);

      // Keep connection alive with ping every 30 seconds
      keepAlive = setInterval(() => {
        if (closed) {
          clearInterval(keepAlive);
          return;
        }
        try {
          sendComment("ping");
        } catch {
          clearInterval(keepAlive);
        }
      }, SSE_KEEP_ALIVE_INTERVAL_MS);

      // Close after 5 minutes (clients should reconnect)
      forceCloseTimer = setTimeout(() => {
        if (!closed) {
          closed = true;
          try {
            clearInterval(keepAlive);
            clearInterval(pollTimer);
            sendEvent({
              type: "reconnect",
              message: "Reconexion requerida",
              timestamp: nowIso()
            });
            controller.close();
          } catch { }
        }
      }, SSE_MAX_CONNECTION_MS);
    },
    cancel() {
      closed = true;
      if (keepAlive) clearInterval(keepAlive);
      if (pollTimer) clearInterval(pollTimer);
      if (forceCloseTimer) clearTimeout(forceCloseTimer);
    }
  });

  return new Response(stream, {
    headers: {
      ...corsHeaders(request, env, corsPolicy),
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive"
    }
  });
}

async function handleAssetsRoute(
  request,
  env,
  url,
  corsPolicy,
  routeParts,
  isWebRoute,
  webSession,
  realtimeTenantId,
) {
  if (routeParts.length >= 1 && routeParts[0] === "assets") {
    const assetsTenantId = normalizeRealtimeTenantId(
      isWebRoute ? webSession?.tenant_id : realtimeTenantId,
    );

    if (routeParts.length === 1 && request.method === "GET") {
      const limit = parsePageLimit(url.searchParams, { fallback: 100, max: 500 });
      const pageSize = limit + 1;
      const cursor = parseTimestampIdCursor(url.searchParams.get("cursor"));
      const filters = parseAssetSearchQuery(url.searchParams);

      let query = `
            SELECT
              id,
              tenant_id,
              external_code,
              brand,
              serial_number,
              model,
              client_name,
              notes,
              status,
              created_at,
              updated_at
            FROM assets
            WHERE tenant_id = ?
          `;
      const bindings = [assetsTenantId];

      if (filters.code) {
        query += " AND LOWER(external_code) = ?";
        bindings.push(filters.code);
      }

      if (filters.brand) {
        query += " AND LOWER(brand) = ?";
        bindings.push(filters.brand);
      }

      if (filters.status) {
        query += " AND status = ?";
        bindings.push(normalizeAssetStatus(filters.status));
      }

      if (filters.search) {
        query += `
              AND (
                LOWER(external_code) LIKE ?
                OR LOWER(brand) LIKE ?
                OR LOWER(serial_number) LIKE ?
                OR LOWER(model) LIKE ?
                OR LOWER(client_name) LIKE ?
              )
            `;
        const wildcard = `%${filters.search}%`;
        bindings.push(wildcard, wildcard, wildcard, wildcard, wildcard);
      }

      if (cursor) {
        query += " AND (updated_at < ? OR (updated_at = ? AND id < ?))";
        bindings.push(cursor.timestamp, cursor.timestamp, cursor.id);
      }

      query += " ORDER BY updated_at DESC, id DESC LIMIT ?";
      bindings.push(pageSize);

      let results;
      try {
        ({ results } = await env.DB.prepare(query).bind(...bindings).all());
      } catch (error) {
        if (isMissingAssetsTableError(error)) {
          throw new HttpError(
            503,
            "La tabla de equipos no existe. Ejecuta migraciones para habilitar assets.",
          );
        }
        throw error;
      }

      const rows = results || [];
      const hasMore = rows.length > limit;
      const items = hasMore ? rows.slice(0, limit) : rows;
      const nextCursor = hasMore
        ? buildTimestampIdCursor(
          items[items.length - 1].updated_at,
          items[items.length - 1].id,
        )
        : null;

      const response = jsonResponse(request, env, corsPolicy, {
        success: true,
        items,
      });
      appendPaginationHeader(response, nextCursor);
      return response;
    }

    if (routeParts.length === 1 && request.method === "POST") {
      if (!isWebRoute) {
        throw new HttpError(401, "Gestion de equipos requiere sesion web.");
      }
      requireAdminRole(webSession?.role);

      const data = await readJsonOrThrowBadRequest(request);
      const payload = normalizeAssetPayload(data);
      const createdAt = nowIso();
      const updatedAt = createdAt;
      const createdBy = normalizeWebUsername(webSession?.sub || "unknown");

      try {
        const insertResult = await env.DB.prepare(`
              INSERT INTO assets (
                tenant_id,
                external_code,
                brand,
                serial_number,
                model,
                client_name,
                notes,
                status,
                created_at,
                updated_at,
                created_by_username
              )
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `)
          .bind(
            assetsTenantId,
            payload.external_code,
            payload.brand,
            payload.serial_number,
            payload.model,
            payload.client_name,
            payload.notes,
            payload.status,
            createdAt,
            updatedAt,
            createdBy,
          )
          .run();

        return jsonResponse(request, env, corsPolicy, {
          success: true,
          asset: {
            id: insertResult?.meta?.last_row_id || null,
            tenant_id: assetsTenantId,
            external_code: payload.external_code,
            brand: payload.brand,
            serial_number: payload.serial_number,
            model: payload.model,
            client_name: payload.client_name,
            notes: payload.notes,
            status: payload.status,
            created_at: createdAt,
            updated_at: updatedAt,
            created_by_username: createdBy,
          },
        }, 201);
      } catch (error) {
        const message = normalizeOptionalString(error?.message, "").toLowerCase();
        if (message.includes("unique")) {
          throw new HttpError(409, "Ya existe un equipo con ese external_code.");
        }
        if (isMissingAssetsTableError(error)) {
          throw new HttpError(
            503,
            "La tabla de equipos no existe. Ejecuta migraciones para habilitar assets.",
          );
        }
        throw error;
      }
    }

    if (routeParts.length === 2 && routeParts[1] === "resolve" && request.method === "POST") {
      if (isWebRoute) {
        requireWebWriteRole(webSession?.role);
      }
      const data = await readJsonOrThrowBadRequest(request);
      const externalCode = normalizeAssetExternalCode(
        data?.external_code ?? data?.asset_id ?? data?.code,
      );
      const brand = normalizeOptionalString(data?.brand, "")
        .slice(0, ASSET_BRAND_MAX_LENGTH);
      const serialNumber = normalizeOptionalString(data?.serial_number, "")
        .slice(0, ASSET_SERIAL_MAX_LENGTH);
      const model = normalizeOptionalString(data?.model, "")
        .slice(0, ASSET_MODEL_MAX_LENGTH);
      const clientName = normalizeOptionalString(data?.client_name, "")
        .slice(0, ASSET_CLIENT_NAME_MAX_LENGTH);
      const notes = normalizeOptionalString(data?.notes, "")
        .slice(0, ASSET_NOTES_MAX_LENGTH);
      const status = Object.prototype.hasOwnProperty.call(data || {}, "status")
        ? normalizeAssetStatus(data?.status)
        : "active";
      const updateExisting = Boolean(data?.update_existing);
      const normalizedCode = externalCode.toLowerCase();
      const actorUsername = normalizeWebUsername(webSession?.sub || "unknown");
      const now = nowIso();
      const selectByCodeQuery = `
            SELECT
              id,
              tenant_id,
              external_code,
              brand,
              serial_number,
              model,
              client_name,
              notes,
              status,
              created_at,
              updated_at
            FROM assets
            WHERE tenant_id = ?
              AND LOWER(external_code) = ?
            LIMIT 1
          `;

      try {
        const { results: existingRows } = await env.DB.prepare(selectByCodeQuery)
          .bind(assetsTenantId, normalizedCode)
          .all();

        const existing = existingRows?.[0];
        if (existing) {
          const nextBrand = brand || existing.brand || "";
          const nextSerial = serialNumber || existing.serial_number || "";
          const nextModel = model || existing.model || "";
          const nextClient = clientName || existing.client_name || "";
          const nextNotes = notes || existing.notes || "";
          const nextStatus = status || existing.status || "active";
          const shouldPersistUpdate =
            updateExisting ||
            (!existing.brand && Boolean(brand)) ||
            (!existing.serial_number && Boolean(serialNumber)) ||
            (!existing.model && Boolean(model)) ||
            (!existing.client_name && Boolean(clientName)) ||
            (!existing.notes && Boolean(notes));

          if (shouldPersistUpdate) {
            await env.DB.prepare(`
                  UPDATE assets
                  SET brand = ?,
                      serial_number = ?,
                      model = ?,
                      client_name = ?,
                      notes = ?,
                      status = ?,
                      updated_at = ?,
                      updated_by_username = ?
                  WHERE id = ?
                    AND tenant_id = ?
                `)
              .bind(
                nextBrand,
                nextSerial,
                nextModel,
                nextClient,
                nextNotes,
                nextStatus,
                now,
                actorUsername,
                existing.id,
                assetsTenantId,
              )
              .run();

            const { results: refreshedRows } = await env.DB.prepare(selectByCodeQuery)
              .bind(assetsTenantId, normalizedCode)
              .all();
            return jsonResponse(request, env, corsPolicy, {
              success: true,
              created: false,
              asset: refreshedRows?.[0] || existing,
            });
          }

          return jsonResponse(request, env, corsPolicy, {
            success: true,
            created: false,
            asset: existing,
          });
        }

        const insertResult = await env.DB.prepare(`
              INSERT INTO assets (
                tenant_id,
                external_code,
                brand,
                serial_number,
                model,
                client_name,
                notes,
                status,
                created_at,
                updated_at,
                created_by_username
              )
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `)
          .bind(
            assetsTenantId,
            externalCode,
            brand,
            serialNumber,
            model,
            clientName,
            notes,
            status,
            now,
            now,
            actorUsername,
          )
          .run();

        return jsonResponse(request, env, corsPolicy, {
          success: true,
          created: true,
          asset: {
            id: insertResult?.meta?.last_row_id || null,
            tenant_id: assetsTenantId,
            external_code: externalCode,
            brand,
            serial_number: serialNumber,
            model,
            client_name: clientName,
            notes,
            status,
            created_at: now,
            updated_at: now,
            created_by_username: actorUsername,
          },
        }, 201);
      } catch (error) {
        const message = normalizeOptionalString(error?.message, "").toLowerCase();
        if (message.includes("unique")) {
          const { results: existingRows } = await env.DB.prepare(selectByCodeQuery)
            .bind(assetsTenantId, normalizedCode)
            .all();
          if (existingRows?.[0]) {
            return jsonResponse(request, env, corsPolicy, {
              success: true,
              created: false,
              asset: existingRows[0],
            });
          }
        }
        if (isMissingAssetsTableError(error)) {
          throw new HttpError(
            503,
            "La tabla de equipos no existe. Ejecuta migraciones para habilitar assets.",
          );
        }
        throw error;
      }
    }

    if (routeParts.length === 2) {
      if (routeParts[1] === "resolve") {
        throw new HttpError(405, "Metodo no permitido para /assets/resolve.");
      }
      const assetId = parsePositiveInt(routeParts[1], "asset_id");

      if (request.method === "GET") {
        let results;
        try {
          ({ results } = await env.DB.prepare(`
                SELECT
                  id,
                  tenant_id,
                  external_code,
                  brand,
                  serial_number,
                  model,
                  client_name,
                  notes,
                  status,
                  created_at,
                  updated_at
                FROM assets
                WHERE id = ?
                  AND tenant_id = ?
                LIMIT 1
              `)
            .bind(assetId, assetsTenantId)
            .all());
        } catch (error) {
          if (isMissingAssetsTableError(error)) {
            throw new HttpError(
              503,
              "La tabla de equipos no existe. Ejecuta migraciones para habilitar assets.",
            );
          }
          throw error;
        }

        const asset = results?.[0];
        if (!asset) {
          throw new HttpError(404, "Equipo no encontrado.");
        }
        return jsonResponse(request, env, corsPolicy, {
          success: true,
          asset,
        });
      }

      if (request.method === "PATCH") {
        if (!isWebRoute) {
          throw new HttpError(401, "Gestion de equipos requiere sesion web.");
        }
        requireAdminRole(webSession?.role);

        const data = await readJsonOrThrowBadRequest(request);
        const updates = normalizeAssetPayload(data, { allowPartial: true });
        const { results: existingRows } = await env.DB.prepare(`
              SELECT id, external_code, brand, serial_number, model, client_name, notes, status
              FROM assets
              WHERE id = ?
                AND tenant_id = ?
              LIMIT 1
            `)
          .bind(assetId, assetsTenantId)
          .all();
        const existing = existingRows?.[0];
        if (!existing) {
          throw new HttpError(404, "Equipo no encontrado.");
        }

        const nextExternalCode =
          updates.external_code === undefined ? existing.external_code : updates.external_code;
        const nextBrand = updates.brand === undefined ? existing.brand : updates.brand;
        const nextSerial =
          updates.serial_number === undefined ? existing.serial_number : updates.serial_number;
        const nextModel = updates.model === undefined ? existing.model : updates.model;
        const nextClient =
          updates.client_name === undefined ? existing.client_name : updates.client_name;
        const nextNotes = updates.notes === undefined ? existing.notes : updates.notes;
        const nextStatus = updates.status === undefined ? existing.status : updates.status;
        const nextUpdatedAt = nowIso();

        try {
          await env.DB.prepare(`
                UPDATE assets
                SET external_code = ?,
                    brand = ?,
                    serial_number = ?,
                    model = ?,
                    client_name = ?,
                    notes = ?,
                    status = ?,
                    updated_at = ?,
                    updated_by_username = ?
                WHERE id = ?
                  AND tenant_id = ?
              `)
            .bind(
              nextExternalCode,
              nextBrand,
              nextSerial,
              nextModel,
              nextClient,
              nextNotes,
              nextStatus,
              nextUpdatedAt,
              normalizeWebUsername(webSession?.sub || "unknown"),
              assetId,
              assetsTenantId,
            )
            .run();
        } catch (error) {
          const message = normalizeOptionalString(error?.message, "").toLowerCase();
          if (message.includes("unique")) {
            throw new HttpError(409, "Ya existe un equipo con ese external_code.");
          }
          throw error;
        }

        return jsonResponse(request, env, corsPolicy, {
          success: true,
          asset: {
            id: assetId,
            tenant_id: assetsTenantId,
            external_code: nextExternalCode,
            brand: nextBrand,
            serial_number: nextSerial,
            model: nextModel,
            client_name: nextClient,
            notes: nextNotes,
            status: nextStatus,
            updated_at: nextUpdatedAt,
          },
        });
      }

      if (request.method === "DELETE") {
        if (!isWebRoute) {
          throw new HttpError(401, "Gestion de equipos requiere sesion web.");
        }
        requireAdminRole(webSession?.role);

        const { results: existingRows } = await env.DB.prepare(`
              SELECT id
              FROM assets
              WHERE id = ?
                AND tenant_id = ?
              LIMIT 1
            `)
          .bind(assetId, assetsTenantId)
          .all();
        if (!existingRows?.[0]) {
          throw new HttpError(404, "Equipo no encontrado.");
        }

        await env.DB.prepare(`
              DELETE FROM assets
              WHERE id = ?
                AND tenant_id = ?
            `)
          .bind(assetId, assetsTenantId)
          .run();

        return jsonResponse(request, env, corsPolicy, {
          success: true,
          deleted_asset_id: assetId,
        });
      }
    }

    if (
      routeParts.length === 3 &&
      routeParts[2] === "incidents"
    ) {
      const assetId = parsePositiveInt(routeParts[1], "asset_id");
      if (request.method !== "GET" && request.method !== "POST") {
        throw new HttpError(405, "Metodo no permitido para /assets/:id/incidents.");
      }

      const incidentLimit = parsePageLimit(url.searchParams, { fallback: 100, max: 300 });

      try {
        const { results: assetRows } = await env.DB.prepare(`
              SELECT
                id,
                tenant_id,
                external_code,
                brand,
                serial_number,
                model,
                client_name,
                notes,
                status,
                created_at,
                updated_at
              FROM assets
              WHERE id = ?
                AND tenant_id = ?
              LIMIT 1
            `)
          .bind(assetId, assetsTenantId)
          .all();

        const asset = assetRows?.[0];
        if (!asset) {
          throw new HttpError(404, "Equipo no encontrado.");
        }

        if (request.method === "POST") {
          if (isWebRoute) {
            requireWebWriteRole(webSession?.role);
          }

          const data = await readJsonOrThrowBadRequest(request);
          const payload = validateIncidentPayload(data, {
            defaultSource: isWebRoute ? "web" : "mobile",
            defaultReporterUsername: webSession?.sub || "unknown",
          });
          const gps = normalizeGpsPayload(data?.gps);
          const requestedInstallationId = parseOptionalPositiveInt(
            data?.installation_id,
            "installation_id",
          );
          const createdAt = nowIso();
          const actorUsername = normalizeWebUsername(
            webSession?.sub || payload.reporterUsername || "unknown",
          );

          let resolvedInstallationId = requestedInstallationId;
          let installation = null;
          let contextRecordCreated = false;

          const loadInstallationById = async (installationId) => {
            const { results: installationRows } = await env.DB.prepare(`
                  SELECT id, notes, installation_time_seconds, site_lat, site_lng, site_radius_m
                  FROM installations
                  WHERE id = ?
                    AND tenant_id = ?
                  LIMIT 1
                `)
              .bind(installationId, assetsTenantId)
              .all();
            return installationRows?.[0] || null;
          };

          if (resolvedInstallationId !== null) {
            installation = await loadInstallationById(resolvedInstallationId);
            if (!installation) {
              throw new HttpError(404, "Instalacion no encontrada.");
            }
          } else {
            const { results: activeLinkRows } = await env.DB.prepare(`
                  SELECT installation_id
                  FROM asset_installation_links
                  WHERE tenant_id = ?
                    AND asset_id = ?
                    AND unlinked_at IS NULL
                  ORDER BY linked_at DESC, id DESC
                  LIMIT 1
                `)
              .bind(assetsTenantId, assetId)
              .all();
            const activeInstallationId = Number(activeLinkRows?.[0]?.installation_id);
            if (Number.isInteger(activeInstallationId) && activeInstallationId > 0) {
              resolvedInstallationId = activeInstallationId;
              installation = await loadInstallationById(activeInstallationId);
            }
          }

          if (!installation) {
            const normalizedAssetCode = normalizeOptionalString(asset.external_code, `#${assetId}`);
            const autoClientName =
              normalizeOptionalString(asset.client_name, "").trim() ||
              `Equipo ${normalizedAssetCode}`;
            const autoBrand = normalizeOptionalString(asset.brand, "").trim() || "ASSET";
            const autoVersion = normalizeOptionalString(asset.model, "").trim() || "N/A";
            const autoDescription = `Contexto automatico para incidencias del equipo ${normalizedAssetCode}`;
            const autoNotes = `Registro automatico generado desde incidencia de equipo ${normalizedAssetCode}.`;

            const insertRecordResult = await env.DB.prepare(`
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
                    gps_lat,
                    gps_lng,
                    gps_accuracy_m,
                    gps_captured_at,
                    gps_capture_source,
                    gps_capture_status,
                    gps_capture_note,
                    tenant_id
                  )
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `)
              .bind(
                createdAt,
                autoBrand,
                autoVersion,
                "asset_context",
                autoClientName,
                autoDescription,
                0,
                "asset",
                autoNotes,
                ...gpsBindValues(gps),
                assetsTenantId,
              )
              .run();

            resolvedInstallationId = Number(insertRecordResult?.meta?.last_row_id || 0);
            if (!Number.isInteger(resolvedInstallationId) || resolvedInstallationId <= 0) {
              throw new HttpError(500, "No se pudo crear contexto de instalacion para la incidencia.");
            }
            installation = {
              id: resolvedInstallationId,
              notes: autoNotes,
              installation_time_seconds: 0,
            };
            contextRecordCreated = true;

            await publishRealtimeEvent(env, {
              type: "installation_created",
              installation: {
                id: resolvedInstallationId,
                tenant_id: assetsTenantId,
                timestamp: createdAt,
                driver_brand: autoBrand,
                driver_version: autoVersion,
                status: "asset_context",
                client_name: autoClientName,
                driver_description: autoDescription,
                installation_time_seconds: 0,
                os_info: "asset",
                notes: autoNotes,
                ...gps,
                ...buildDefaultInstallationOperationalSummary(),
              },
            }, realtimeTenantId);
          }

          const geofence = evaluateGeofence({
            gps,
            installation,
            checkedAt: createdAt,
          });
          const requestIp = getClientIpForRateLimit(request);
          const geofenceOverride = resolveHardGeofenceOverride({
            env,
            tenantId: assetsTenantId,
            flow: GEOFENCE_FLOW_INCIDENTS,
            geofence,
            overrideNote: data?.geofence_override_note,
            actorUsername: payload.reporterUsername,
            appliedAt: createdAt,
          });

          await env.DB.prepare(`
                UPDATE asset_installation_links
                SET unlinked_at = ?
                WHERE tenant_id = ?
                  AND asset_id = ?
                  AND unlinked_at IS NULL
                  AND installation_id <> ?
              `)
            .bind(createdAt, assetsTenantId, assetId, resolvedInstallationId)
            .run();

          const { results: activeRows } = await env.DB.prepare(`
                SELECT id
                FROM asset_installation_links
                WHERE tenant_id = ?
                  AND asset_id = ?
                  AND installation_id = ?
                  AND unlinked_at IS NULL
                LIMIT 1
              `)
            .bind(assetsTenantId, assetId, resolvedInstallationId)
            .all();

          if (!activeRows?.[0]?.id) {
            await env.DB.prepare(`
                  INSERT INTO asset_installation_links (
                    tenant_id,
                    asset_id,
                    installation_id,
                    linked_at,
                    linked_by_username,
                    notes
                  )
                  VALUES (?, ?, ?, ?, ?, ?)
                `)
              .bind(
                assetsTenantId,
                assetId,
                resolvedInstallationId,
                createdAt,
                actorUsername,
                normalizeOptionalString(
                  data?.asset_link_note,
                  "Vinculo automatico desde incidencia de equipo",
                ).slice(0, 500),
              )
              .run();
          }

          let persistedAssetId = assetId;
          let insertResult;
          try {
            insertResult = await env.DB.prepare(`
                  INSERT INTO incidents (
                    installation_id,
                    asset_id,
                    tenant_id,
                    reporter_username,
                    note,
                    time_adjustment_seconds,
                    estimated_duration_seconds,
                    severity,
                    source,
                    created_at,
                    incident_status,
                    status_updated_at,
                    status_updated_by,
                    work_started_at,
                    work_ended_at,
                    actual_duration_seconds,
                    geofence_distance_m,
                    geofence_radius_m,
                    geofence_result,
                    geofence_checked_at,
                    geofence_override_note,
                    geofence_override_by,
                    geofence_override_at,
                    gps_lat,
                    gps_lng,
                    gps_accuracy_m,
                    gps_captured_at,
                    gps_capture_source,
                    gps_capture_status,
                    gps_capture_note
                  )
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `)
              .bind(
                resolvedInstallationId,
                assetId,
                assetsTenantId,
                payload.reporterUsername,
                payload.note,
                payload.timeAdjustment,
                payload.estimatedDurationSeconds,
                payload.severity,
                payload.source,
                createdAt,
                payload.incidentStatus,
                    createdAt,
                    payload.reporterUsername,
                    null,
                    null,
                    null,
                    geofence.geofence_distance_m,
                    geofence.geofence_radius_m,
                    geofence.geofence_result,
                    geofence.geofence_checked_at,
                    geofenceOverride.override_note,
                    geofenceOverride.override_by,
                    geofenceOverride.override_at,
                    ...gpsBindValues(gps),
                  )
              .run();
          } catch (error) {
            if (
              !isMissingIncidentAssetColumnError(error) &&
              !isMissingIncidentTimingColumnsError(error) &&
              !isMissingIncidentGeofenceOverrideColumnsError(error)
            ) {
              throw error;
            }
            try {
              insertResult = await env.DB.prepare(`
                    INSERT INTO incidents (
                      installation_id,
                      asset_id,
                      tenant_id,
                      reporter_username,
                      note,
                      time_adjustment_seconds,
                      severity,
                      source,
                      created_at,
                      incident_status,
                      status_updated_at,
                      status_updated_by,
                      geofence_distance_m,
                      geofence_radius_m,
                      geofence_result,
                      geofence_checked_at,
                      geofence_override_note,
                      geofence_override_by,
                      geofence_override_at,
                      gps_lat,
                      gps_lng,
                      gps_accuracy_m,
                      gps_captured_at,
                      gps_capture_source,
                      gps_capture_status,
                      gps_capture_note
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                  `)
                .bind(
                  resolvedInstallationId,
                  assetId,
                  assetsTenantId,
                  payload.reporterUsername,
                  payload.note,
                  payload.timeAdjustment,
                  payload.severity,
                  payload.source,
                      createdAt,
                      payload.incidentStatus,
                      createdAt,
                      payload.reporterUsername,
                      geofence.geofence_distance_m,
                      geofence.geofence_radius_m,
                      geofence.geofence_result,
                      geofence.geofence_checked_at,
                      geofenceOverride.override_note,
                      geofenceOverride.override_by,
                      geofenceOverride.override_at,
                      ...gpsBindValues(gps),
                    )
                .run();
            } catch (legacyError) {
              if (
                !isMissingIncidentAssetColumnError(legacyError) &&
                !isMissingIncidentGeofenceOverrideColumnsError(legacyError)
              ) {
                throw legacyError;
              }
              insertResult = await env.DB.prepare(`
                    INSERT INTO incidents (
                      installation_id,
                      tenant_id,
                      reporter_username,
                      note,
                      time_adjustment_seconds,
                      severity,
                      source,
                      created_at,
                      incident_status,
                      status_updated_at,
                      status_updated_by,
                      geofence_distance_m,
                      geofence_radius_m,
                      geofence_result,
                      geofence_checked_at,
                      geofence_override_note,
                      geofence_override_by,
                      geofence_override_at,
                      gps_lat,
                      gps_lng,
                      gps_accuracy_m,
                      gps_captured_at,
                      gps_capture_source,
                      gps_capture_status,
                      gps_capture_note
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                  `)
                .bind(
                  resolvedInstallationId,
                  assetsTenantId,
                  payload.reporterUsername,
                  payload.note,
                  payload.timeAdjustment,
                  payload.severity,
                  payload.source,
                      createdAt,
                      payload.incidentStatus,
                      createdAt,
                      payload.reporterUsername,
                      geofence.geofence_distance_m,
                      geofence.geofence_radius_m,
                      geofence.geofence_result,
                      geofence.geofence_checked_at,
                      geofenceOverride.override_note,
                      geofenceOverride.override_by,
                      geofenceOverride.override_at,
                      ...gpsBindValues(gps),
                    )
                .run();
              persistedAssetId = null;
            }
          }

          const incidentId = insertResult?.meta?.last_row_id || null;

          if (payload.applyToInstallation) {
            const currentNotes = normalizeOptionalString(installation.notes, "");
            const composedNotes = currentNotes
              ? `${currentNotes}\n[INCIDENT] ${payload.note}`
              : payload.note;
            const currentTime = Number(installation.installation_time_seconds || 0);
            const nextTime = Math.max(0, currentTime + payload.timeAdjustment);

            await env.DB.prepare(`
                  UPDATE installations
                  SET notes = ?, installation_time_seconds = ?
                  WHERE id = ?
                    AND tenant_id = ?
                `)
              .bind(composedNotes, nextTime, resolvedInstallationId, assetsTenantId)
              .run();
          }

          if (payload.severity === "critical") {
            try {
              const fcmTokens = await listDeviceTokensForWebRoles(
                env,
                CRITICAL_INCIDENT_PUSH_ROLES,
                assetsTenantId,
              );
              if (fcmTokens.length > 0) {
                await sendPushNotification(env, fcmTokens, {
                  title: "Incidencia critica",
                  body: `Nueva incidencia critica en instalacion #${resolvedInstallationId}`,
                  data: {
                    installation_id: String(resolvedInstallationId),
                    incident_id: String(incidentId || ""),
                    asset_id: persistedAssetId !== null ? String(persistedAssetId) : "",
                    severity: payload.severity,
                    source: payload.source,
                  },
                });
              }
            } catch {
              // Best effort: una falla de push no debe impedir registrar la incidencia.
            }
          }

          await logAuditEvent(env, {
            action: "create_incident",
            username: payload.reporterUsername,
            success: true,
            tenantId: assetsTenantId,
            details: {
              incident_id: incidentId,
              installation_id: resolvedInstallationId,
              asset_id: persistedAssetId,
              estimated_duration_seconds: payload.estimatedDurationSeconds,
              severity: payload.severity,
              source: payload.source,
              note_preview: payload.note.substring(0, 100),
              geofence_result: geofence.geofence_result,
              geofence_distance_m: geofence.geofence_distance_m,
              geofence_radius_m: geofence.geofence_radius_m,
              geofence_override_note: geofenceOverride.override_note,
              geofence_override_by: geofenceOverride.override_by,
              geofence_override_at: geofenceOverride.override_at,
              gps_accuracy_m: gps.gps_accuracy_m,
              tenant_id: assetsTenantId,
            },
            computerName: "",
            ipAddress: requestIp,
            platform: payload.source,
          });

          if (geofence.geofence_result === "outside") {
            await logAuditEvent(env, {
              action: "incident_geofence_warning",
              username: payload.reporterUsername,
              success: true,
              tenantId: assetsTenantId,
              details: {
                incident_id: incidentId,
                installation_id: resolvedInstallationId,
                asset_id: persistedAssetId,
                geofence_result: geofence.geofence_result,
                geofence_distance_m: geofence.geofence_distance_m,
                geofence_radius_m: geofence.geofence_radius_m,
                gps_accuracy_m: gps.gps_accuracy_m,
                tenant_id: assetsTenantId,
              },
              computerName: "",
              ipAddress: requestIp,
              platform: payload.source,
            });
          }

          if (geofenceOverride.override_applied) {
            await logAuditEvent(env, {
              action: "override_incident_geofence",
              username: payload.reporterUsername,
              success: true,
              tenantId: assetsTenantId,
              details: {
                incident_id: incidentId,
                installation_id: resolvedInstallationId,
                asset_id: persistedAssetId,
                geofence_distance_m: geofence.geofence_distance_m,
                geofence_radius_m: geofence.geofence_radius_m,
                gps_accuracy_m: gps.gps_accuracy_m,
                reason: geofenceOverride.override_note,
                override_by: geofenceOverride.override_by,
                override_at: geofenceOverride.override_at,
                tenant_id: assetsTenantId,
              },
              computerName: "",
              ipAddress: requestIp,
              platform: payload.source,
            });
          }

          const incidentEventPayload = mapIncidentRow({
            id: incidentId,
            installation_id: resolvedInstallationId,
            asset_id: persistedAssetId,
            reporter_username: payload.reporterUsername,
            note: payload.note,
            time_adjustment_seconds: payload.timeAdjustment,
            estimated_duration_seconds: payload.estimatedDurationSeconds,
            severity: payload.severity,
            source: payload.source,
            created_at: createdAt,
            incident_status: payload.incidentStatus,
            status_updated_at: createdAt,
            status_updated_by: payload.reporterUsername,
            resolved_at: null,
            resolved_by: null,
            resolution_note: null,
            checklist_json: null,
            evidence_note: null,
            ...buildDefaultGeofenceSnapshot(),
            ...geofence,
            geofence_override_note: geofenceOverride.override_note,
            geofence_override_by: geofenceOverride.override_by,
            geofence_override_at: geofenceOverride.override_at,
            ...gps,
          });

          await publishRealtimeEvent(env, {
            type: "incident_created",
            incident: incidentEventPayload,
          }, realtimeTenantId);
          if (payload.applyToInstallation) {
            await publishRealtimeEvent(env, {
              type: "installation_updated",
              installation: {
                id: resolvedInstallationId,
                notes: normalizeOptionalString(installation.notes, "")
                  ? `${normalizeOptionalString(installation.notes, "")}\n[INCIDENT] ${payload.note}`
                  : payload.note,
                installation_time_seconds: Math.max(
                  0,
                  Number(installation.installation_time_seconds || 0) + payload.timeAdjustment,
                ),
              },
            }, realtimeTenantId);
          }
          await syncPublicTrackingSnapshotForInstallation(env, {
            tenantId: assetsTenantId,
            installationId: resolvedInstallationId,
          });
          await publishRealtimeStatsUpdate(env, realtimeTenantId);

          return jsonResponse(request, env, corsPolicy, {
            success: true,
            incident: incidentEventPayload,
            installation_id: resolvedInstallationId,
            context_record_created: contextRecordCreated,
            asset,
          }, 201);
        }

        const { results: linkRows } = await env.DB.prepare(`
              SELECT
                l.id,
                l.tenant_id,
                l.asset_id,
                l.installation_id,
                l.linked_at,
                l.unlinked_at,
                l.linked_by_username,
                l.notes,
                inst.client_name AS installation_client_name,
                inst.driver_brand AS installation_brand,
                inst.driver_version AS installation_version,
                inst.status AS installation_status
              FROM asset_installation_links l
              LEFT JOIN installations inst
                ON inst.id = l.installation_id
               AND inst.tenant_id = l.tenant_id
              WHERE l.asset_id = ?
                AND l.tenant_id = ?
              ORDER BY l.linked_at DESC, l.id DESC
            `)
          .bind(assetId, assetsTenantId)
          .all();

        const links = linkRows || [];
        const activeLink = links.find((link) => !link.unlinked_at) || null;

        let incidents = [];
        try {
          const { results: incidentRows } = await env.DB.prepare(`
                SELECT
                  i.id,
                  i.installation_id,
                  i.asset_id,
                  i.reporter_username,
                  i.note,
                  i.time_adjustment_seconds,
                  i.estimated_duration_seconds,
                  i.severity,
                  i.source,
                  i.created_at,
                  i.incident_status,
                  i.status_updated_at,
                  i.status_updated_by,
                  i.resolved_at,
                  i.resolved_by,
                  i.resolution_note,
                  i.checklist_json,
                  i.evidence_note,
                  i.work_started_at,
                  i.work_ended_at,
                  i.actual_duration_seconds,
                  i.geofence_distance_m,
                  i.geofence_radius_m,
                  i.geofence_result,
                  i.geofence_checked_at,
                  i.geofence_override_note,
                  i.geofence_override_by,
                  i.geofence_override_at,
                  i.gps_lat,
                  i.gps_lng,
                  i.gps_accuracy_m,
                  i.gps_captured_at,
                  i.gps_capture_source,
                  i.gps_capture_status,
                  i.gps_capture_note,
                  inst.client_name AS installation_client_name,
                  inst.driver_brand AS installation_brand,
                  inst.driver_version AS installation_version
                FROM incidents i
                LEFT JOIN installations inst
                  ON inst.id = i.installation_id
                 AND inst.tenant_id = i.tenant_id
                WHERE i.tenant_id = ?
                  AND i.deleted_at IS NULL
                  AND (
                    i.asset_id = ?
                    OR EXISTS (
                      SELECT 1
                      FROM asset_installation_links l
                      WHERE l.tenant_id = ?
                        AND l.asset_id = ?
                        AND l.installation_id = i.installation_id
                        AND i.created_at >= l.linked_at
                        AND (l.unlinked_at IS NULL OR i.created_at <= l.unlinked_at)
                    )
                  )
                ORDER BY i.created_at DESC, i.id DESC
                LIMIT ?
              `)
            .bind(assetsTenantId, assetId, assetsTenantId, assetId, incidentLimit)
            .all();
          incidents = incidentRows || [];
        } catch (error) {
          if (!isMissingIncidentAssetColumnError(error)) {
            throw error;
          }
          const { results: legacyIncidentRows } = await env.DB.prepare(`
                SELECT
                  i.id,
                  i.installation_id,
                  i.reporter_username,
                  i.note,
                  i.time_adjustment_seconds,
                  i.estimated_duration_seconds,
                  i.severity,
                  i.source,
                  i.created_at,
                  i.incident_status,
                  i.status_updated_at,
                  i.status_updated_by,
                  i.resolved_at,
                  i.resolved_by,
                  i.resolution_note,
                  i.checklist_json,
                  i.evidence_note,
                  i.geofence_distance_m,
                  i.geofence_radius_m,
                  i.geofence_result,
                  i.geofence_checked_at,
                  i.geofence_override_note,
                  i.geofence_override_by,
                  i.geofence_override_at,
                  i.gps_lat,
                  i.gps_lng,
                  i.gps_accuracy_m,
                  i.gps_captured_at,
                  i.gps_capture_source,
                  i.gps_capture_status,
                  i.gps_capture_note,
                  inst.client_name AS installation_client_name,
                  inst.driver_brand AS installation_brand,
                  inst.driver_version AS installation_version
                FROM incidents i
                LEFT JOIN installations inst
                  ON inst.id = i.installation_id
                 AND inst.tenant_id = i.tenant_id
                WHERE i.tenant_id = ?
                  AND i.deleted_at IS NULL
                  AND EXISTS (
                    SELECT 1
                    FROM asset_installation_links l
                    WHERE l.tenant_id = ?
                      AND l.asset_id = ?
                      AND l.installation_id = i.installation_id
                      AND i.created_at >= l.linked_at
                      AND (l.unlinked_at IS NULL OR i.created_at <= l.unlinked_at)
                  )
                ORDER BY i.created_at DESC, i.id DESC
                LIMIT ?
              `)
            .bind(assetsTenantId, assetsTenantId, assetId, incidentLimit)
            .all();
          incidents = (legacyIncidentRows || []).map((row) => ({ ...row, asset_id: null }));
        }
        const incidentIds = incidents
          .map((incident) => Number(incident.id))
          .filter((incidentId) => Number.isInteger(incidentId) && incidentId > 0);

        const photosByIncident = {};
        if (incidentIds.length > 0) {
          const placeholders = incidentIds.map(() => "?").join(", ");
          const { results: photoRows } = await env.DB.prepare(`
                SELECT
                  id,
                  incident_id,
                  r2_key,
                  file_name,
                  content_type,
                  size_bytes,
                  sha256,
                  created_at
                FROM incident_photos
                WHERE incident_id IN (${placeholders})
                ORDER BY created_at ASC, id ASC
              `)
            .bind(...incidentIds)
            .all();

          for (const photo of photoRows || []) {
            if (!photosByIncident[photo.incident_id]) {
              photosByIncident[photo.incident_id] = [];
            }
            photosByIncident[photo.incident_id].push(photo);
          }
        }

        const enrichedIncidents = incidents.map((incident) =>
          mapIncidentRow(incident, photosByIncident[incident.id] || [])
        );

        return jsonResponse(request, env, corsPolicy, {
          success: true,
          asset,
          active_link: activeLink,
          links,
          incidents: enrichedIncidents,
        });
      } catch (error) {
        if (error instanceof HttpError) {
          throw error;
        }
        if (isMissingAssetsTableError(error)) {
          throw new HttpError(
            503,
            "La tabla de equipos no existe. Ejecuta migraciones para habilitar assets.",
          );
        }
        if (isMissingIncidentAssetColumnError(error)) {
          throw new HttpError(
            503,
            "La columna incidents.asset_id no existe. Ejecuta migraciones para habilitar incidencias por equipo.",
          );
        }
        throw error;
      }
    }

    if (
      routeParts.length === 3 &&
      routeParts[2] === "link-installation" &&
      request.method === "POST"
    ) {
      if (isWebRoute) {
        requireWebWriteRole(webSession?.role);
      }
      const assetId = parsePositiveInt(routeParts[1], "asset_id");
      const data = await readJsonOrThrowBadRequest(request);
      const installationId = parsePositiveInt(data?.installation_id, "installation_id");
      const linkedAt = nowIso();
      const linkedBy = normalizeWebUsername(webSession?.sub || "unknown");

      try {
        const { results: assetRows } = await env.DB.prepare(`
              SELECT id, external_code
              FROM assets
              WHERE id = ?
                AND tenant_id = ?
              LIMIT 1
            `)
          .bind(assetId, assetsTenantId)
          .all();
        if (!assetRows?.[0]) {
          throw new HttpError(404, "Equipo no encontrado.");
        }

        const { results: installationRows } = await env.DB.prepare(`
              SELECT id
              FROM installations
              WHERE id = ?
                AND tenant_id = ?
              LIMIT 1
            `)
          .bind(installationId, assetsTenantId)
          .all();
        if (!installationRows?.[0]) {
          throw new HttpError(404, "Instalacion no encontrada.");
        }

        await env.DB.prepare(`
              UPDATE asset_installation_links
              SET unlinked_at = ?
              WHERE tenant_id = ?
                AND asset_id = ?
                AND unlinked_at IS NULL
                AND installation_id <> ?
            `)
          .bind(linkedAt, assetsTenantId, assetId, installationId)
          .run();

        const { results: activeRows } = await env.DB.prepare(`
              SELECT id
              FROM asset_installation_links
              WHERE tenant_id = ?
                AND asset_id = ?
                AND installation_id = ?
                AND unlinked_at IS NULL
              LIMIT 1
            `)
          .bind(assetsTenantId, assetId, installationId)
          .all();

        let linkId = activeRows?.[0]?.id || null;
        if (!linkId) {
          const insertResult = await env.DB.prepare(`
                INSERT INTO asset_installation_links (
                  tenant_id,
                  asset_id,
                  installation_id,
                  linked_at,
                  linked_by_username,
                  notes
                )
                VALUES (?, ?, ?, ?, ?, ?)
              `)
            .bind(
              assetsTenantId,
              assetId,
              installationId,
              linkedAt,
              linkedBy,
              normalizeOptionalString(data?.notes, "").slice(0, 500),
            )
            .run();
          linkId = insertResult?.meta?.last_row_id || null;
        }

        return jsonResponse(request, env, corsPolicy, {
          success: true,
          link: {
            id: linkId,
            tenant_id: assetsTenantId,
            asset_id: assetId,
            installation_id: installationId,
            linked_at: linkedAt,
            linked_by_username: linkedBy,
          },
        });
      } catch (error) {
        if (error instanceof HttpError) {
          throw error;
        }
        if (isMissingAssetsTableError(error)) {
          throw new HttpError(
            503,
            "La tabla de equipos no existe. Ejecuta migraciones para habilitar assets.",
          );
        }
        throw error;
      }
    }
  }

  return null;
}
async function handleDriversRoute(
  request,
  env,
  url,
  corsPolicy,
  routeParts,
  isWebRoute,
  webSession,
) {
  if (routeParts.length >= 1 && routeParts[0] === "drivers") {
    if (!isWebRoute) {
      throw new HttpError(401, "Gestion de drivers requiere sesion web.");
    }

    const driversTenantId = normalizeRealtimeTenantId(webSession?.tenant_id);
    const driversBucket = getDriversBucketBinding(env);

    if (routeParts.length === 1 && request.method === "GET") {
      const limit = parsePageLimit(url.searchParams, { fallback: 100, max: 500 });
      const brandFilter = normalizeOptionalString(url.searchParams.get("brand"), "").toLowerCase();
      const versionFilter = normalizeOptionalString(url.searchParams.get("version"), "").toLowerCase();
      const searchFilter = normalizeOptionalString(url.searchParams.get("search"), "").toLowerCase();

      const manifest = await readDriverManifest(driversBucket);
      let items = (manifest.drivers || []).filter(
        (entry) => normalizeRealtimeTenantId(entry.tenant_id) === driversTenantId,
      );

      if (brandFilter) {
        items = items.filter(
          (entry) => normalizeOptionalString(entry.brand, "").toLowerCase() === brandFilter,
        );
      }
      if (versionFilter) {
        items = items.filter(
          (entry) => normalizeOptionalString(entry.version, "").toLowerCase() === versionFilter,
        );
      }
      if (searchFilter) {
        items = items.filter((entry) => {
          const haystack = [
            normalizeOptionalString(entry.brand, ""),
            normalizeOptionalString(entry.version, ""),
            normalizeOptionalString(entry.filename, ""),
            normalizeOptionalString(entry.description, ""),
          ]
            .join(" ")
            .toLowerCase();
          return haystack.includes(searchFilter);
        });
      }

      items.sort((a, b) => {
        const aTime = Date.parse(normalizeOptionalString(a.uploaded, "")) || 0;
        const bTime = Date.parse(normalizeOptionalString(b.uploaded, "")) || 0;
        return bTime - aTime;
      });

      const total = items.length;
      items = items.slice(0, limit);

      return jsonResponse(request, env, corsPolicy, {
        success: true,
        total,
        items: items.map((entry) => ({
          ...entry,
          download_url: `/web/drivers/download?key=${encodeURIComponent(entry.key)}`,
        })),
      });
    }

    if (routeParts.length === 1 && request.method === "POST") {
      requireAdminRole(webSession?.role);

      let formData;
      try {
        formData = await request.formData();
      } catch {
        throw new HttpError(400, "Payload multipart/form-data invalido.");
      }

      const brand = normalizeDriverBrand(formData.get("brand"));
      const version = normalizeDriverVersion(formData.get("version"));
      const description = normalizeDriverDescription(formData.get("description"));
      const fileField = formData.get("file");

      if (
        !fileField ||
        typeof fileField !== "object" ||
        typeof fileField.stream !== "function" ||
        typeof fileField.name !== "string"
      ) {
        throw new HttpError(400, "Campo 'file' es obligatorio.");
      }

      const fileSize = Math.max(0, Number(fileField.size) || 0);
      if (!fileSize) {
        throw new HttpError(400, "El archivo esta vacio.");
      }
      if (fileSize > MAX_DRIVER_UPLOAD_BYTES) {
        throw new HttpError(
          413,
          `Archivo demasiado grande (${(fileSize / (1024 * 1024)).toFixed(1)}MB). Maximo: ${(
            MAX_DRIVER_UPLOAD_BYTES /
            (1024 * 1024)
          ).toFixed(0)}MB.`,
        );
      }

      const safeFileName = sanitizeFileName(
        normalizeOptionalString(fileField.name, ""),
        `driver_${Date.now()}`,
      );
      const contentType = normalizeContentType(fileField.type) || "application/octet-stream";
      const driverKey = buildDriverStorageKey({
        tenantId: driversTenantId,
        brand,
        version,
        fileName: safeFileName,
      });
      const uploadedAt = nowIso();
      const uploadedBy = normalizeWebUsername(webSession?.sub || "unknown");

      await driversBucket.put(driverKey, fileField.stream(), {
        httpMetadata: { contentType },
      });

      const manifest = await readDriverManifest(driversBucket);
      const replacedEntries = (manifest.drivers || []).filter(
        (entry) =>
          normalizeRealtimeTenantId(entry.tenant_id) === driversTenantId &&
          normalizeOptionalString(entry.brand, "").toLowerCase() === brand.toLowerCase() &&
          normalizeOptionalString(entry.version, "").toLowerCase() === version.toLowerCase() &&
          normalizeOptionalString(entry.key, "") !== driverKey,
      );

      manifest.drivers = (manifest.drivers || []).filter((entry) => {
        return !(
          normalizeRealtimeTenantId(entry.tenant_id) === driversTenantId &&
          normalizeOptionalString(entry.brand, "").toLowerCase() === brand.toLowerCase() &&
          normalizeOptionalString(entry.version, "").toLowerCase() === version.toLowerCase()
        );
      });

      for (const staleEntry of replacedEntries) {
        const staleKey = normalizeOptionalString(staleEntry?.key, "");
        if (!staleKey) continue;
        try {
          await driversBucket.delete(staleKey);
        } catch {
          // Best effort cleanup.
        }
      }

      const driverEntry = {
        tenant_id: driversTenantId,
        brand,
        version,
        description,
        key: driverKey,
        filename: safeFileName,
        uploaded: uploadedAt,
        last_modified: formatLegacyDateTime(uploadedAt),
        size_bytes: fileSize,
        size_mb: Number((fileSize / (1024 * 1024)).toFixed(2)),
        uploaded_by_username: uploadedBy,
      };
      manifest.drivers.push(driverEntry);
      await writeDriverManifest(driversBucket, manifest);

      await logAuditEvent(env, {
        action: "upload_driver",
        username: uploadedBy,
        success: true,
        tenantId: driversTenantId,
        details: {
          tenant_id: driversTenantId,
          brand,
          version,
          key: driverKey,
          size_bytes: fileSize,
        },
        ipAddress: getClientIpForRateLimit(request),
        platform: "web",
      });

      return jsonResponse(request, env, corsPolicy, {
        success: true,
        driver: {
          ...driverEntry,
          download_url: `/web/drivers/download?key=${encodeURIComponent(driverKey)}`,
        },
      }, 201);
    }

    if (routeParts.length === 1 && request.method === "DELETE") {
      requireAdminRole(webSession?.role);

      const key = normalizeOptionalString(url.searchParams.get("key"), "");
      if (!key) {
        throw new HttpError(400, "Parametro 'key' es obligatorio.");
      }

      const manifest = await readDriverManifest(driversBucket);
      const found = (manifest.drivers || []).find(
        (entry) =>
          normalizeOptionalString(entry.key, "") === key &&
          normalizeRealtimeTenantId(entry.tenant_id) === driversTenantId,
      );
      if (!found) {
        throw new HttpError(404, "Driver no encontrado.");
      }

      await driversBucket.delete(key);
      manifest.drivers = (manifest.drivers || []).filter(
        (entry) =>
          !(
            normalizeOptionalString(entry.key, "") === key &&
            normalizeRealtimeTenantId(entry.tenant_id) === driversTenantId
          ),
      );
      await writeDriverManifest(driversBucket, manifest);

      await logAuditEvent(env, {
        action: "delete_driver",
        username: normalizeWebUsername(webSession?.sub || "unknown"),
        success: true,
        tenantId: driversTenantId,
        details: {
          tenant_id: driversTenantId,
          key,
          brand: found.brand || "",
          version: found.version || "",
        },
        ipAddress: getClientIpForRateLimit(request),
        platform: "web",
      });

      return jsonResponse(request, env, corsPolicy, {
        success: true,
        deleted_key: key,
      });
    }

    if (routeParts.length === 2 && routeParts[1] === "download" && request.method === "GET") {
      const key = normalizeOptionalString(url.searchParams.get("key"), "");
      if (!key) {
        throw new HttpError(400, "Parametro 'key' es obligatorio.");
      }

      const manifest = await readDriverManifest(driversBucket);
      const found = (manifest.drivers || []).find(
        (entry) =>
          normalizeOptionalString(entry.key, "") === key &&
          normalizeRealtimeTenantId(entry.tenant_id) === driversTenantId,
      );
      if (!found) {
        throw new HttpError(404, "Driver no encontrado.");
      }

      const object = await driversBucket.get(key);
      if (!object || !object.body) {
        throw new HttpError(404, "Archivo de driver no encontrado en R2.");
      }

      const safeName = sanitizeFileName(
        normalizeOptionalString(found.filename, ""),
        "driver",
      );

      return new Response(object.body, {
        status: 200,
        headers: {
          ...corsHeaders(request, env, corsPolicy),
          "Content-Type": object.httpMetadata?.contentType || "application/octet-stream",
          "Content-Disposition": `attachment; filename=\"${safeName}\"`,
          "Cache-Control": "private, max-age=300",
        },
      });
    }
  }

  return null;
}

async function handleLoansRoute(
  request,
  env,
  url,
  corsPolicy,
  routeParts,
  isWebRoute,
  webSession,
  realtimeTenantId,
) {
  if (!isWebRoute) return null;

  const loansTenantId = normalizeRealtimeTenantId(
    isWebRoute ? webSession?.tenant_id : realtimeTenantId,
  );
  const actorUsername = normalizeWebUsername(webSession?.sub || "unknown");

  if (routeParts.length === 1 && routeParts[0] === "loans" && request.method === "GET") {
    const requestedStatus = normalizeOptionalString(url.searchParams.get("status"), "").trim().toLowerCase();
    const limit = parsePageLimit(url.searchParams, { fallback: 100, max: 500 });
    const currentIso = nowIso();
    const dueSoonCutoffIso = new Date(
      new Date(currentIso).getTime() + LOAN_DUE_SOON_HOURS * 60 * 60 * 1000,
    ).toISOString();
    let query = `
      SELECT
        l.*,
        a.external_code AS asset_external_code,
        a.brand AS asset_brand,
        a.model AS asset_model
      FROM asset_loans l
      LEFT JOIN assets a ON a.id = l.asset_id AND a.tenant_id = l.tenant_id
      WHERE l.tenant_id = ?
    `;
    const bindings = [loansTenantId];

    if (requestedStatus === "active") {
      query += " AND l.returned_at IS NULL AND (l.expected_return_at IS NULL OR l.expected_return_at >= ?)";
      bindings.push(currentIso);
    } else if (requestedStatus === "due_soon") {
      query += " AND l.returned_at IS NULL AND l.expected_return_at IS NOT NULL AND l.expected_return_at >= ? AND l.expected_return_at <= ?";
      bindings.push(currentIso, dueSoonCutoffIso);
    } else if (requestedStatus === "overdue") {
      query += " AND l.returned_at IS NULL AND l.expected_return_at IS NOT NULL AND l.expected_return_at < ?";
      bindings.push(currentIso);
    } else if (requestedStatus === "returned") {
      query += " AND l.returned_at IS NOT NULL";
    }

    query += " ORDER BY l.loaned_at DESC LIMIT ?";
    bindings.push(limit);

    try {
      const { results } = await env.DB.prepare(query).bind(...bindings).all();
      return jsonResponse(request, env, corsPolicy, {
        success: true,
        items: (results || []).map((row) => mapLoanRow(row, currentIso)),
      });
    } catch (error) {
      if (String(error?.message || "").toLowerCase().includes("no such table")) {
        throw new HttpError(
          503,
          "La tabla de prestamos no existe. Ejecuta la migracion 0020_asset_loans.sql.",
        );
      }
      throw error;
    }
  }

  if (
    routeParts.length === 3 &&
    routeParts[0] === "assets" &&
    routeParts[2] === "loans" &&
    request.method === "GET"
  ) {
    const assetId = parsePositiveInt(routeParts[1], "asset_id");
    const currentIso = nowIso();

    try {
      const { results } = await env.DB.prepare(`
        SELECT
          l.*,
          a.external_code AS asset_external_code,
          a.brand AS asset_brand,
          a.model AS asset_model
        FROM asset_loans l
        LEFT JOIN assets a ON a.id = l.asset_id AND a.tenant_id = l.tenant_id
        WHERE l.tenant_id = ? AND l.asset_id = ?
        ORDER BY l.loaned_at DESC
        LIMIT 200
      `).bind(loansTenantId, assetId).all();

      const items = (results || []).map((row) => mapLoanRow(row, currentIso));
      return jsonResponse(request, env, corsPolicy, {
        success: true,
        items,
        active_count: items.filter((item) => item.status !== "returned").length,
        overdue_count: items.filter((item) => item.status === "overdue").length,
      });
    } catch (error) {
      if (String(error?.message || "").toLowerCase().includes("no such table")) {
        throw new HttpError(
          503,
          "La tabla de prestamos no existe. Ejecuta la migracion 0020_asset_loans.sql.",
        );
      }
      throw error;
    }
  }

  if (
    routeParts.length === 3 &&
    routeParts[0] === "assets" &&
    routeParts[2] === "loans" &&
    request.method === "POST"
  ) {
    requireWebWriteRole(webSession?.role);
    const assetId = parsePositiveInt(routeParts[1], "asset_id");
    const data = await readJsonOrThrowBadRequest(request);
    const borrowingClient = normalizeOptionalString(data?.borrowing_client, "").trim().slice(0, 180);
    if (!borrowingClient) {
      throw new HttpError(400, "Campo 'borrowing_client' es obligatorio.");
    }

    const expectedReturnAtRaw = normalizeOptionalString(data?.expected_return_at, "").trim();
    const expectedReturnAt = expectedReturnAtRaw || null;
    if (expectedReturnAt) {
      const parsedExpected = Date.parse(expectedReturnAt);
      if (!Number.isFinite(parsedExpected)) {
        throw new HttpError(400, "Campo 'expected_return_at' con formato invalido.");
      }
      if (expectedReturnAt <= nowIso()) {
        throw new HttpError(400, "La fecha de retorno debe ser futura.");
      }
    }

    const notes = normalizeOptionalString(data?.notes, "").trim().slice(0, 2000);
    const loanedAt = nowIso();
    let assetRow = null;

    try {
      const { results } = await env.DB.prepare(`
        SELECT id, external_code, client_name, brand, model
        FROM assets
        WHERE id = ? AND tenant_id = ?
        LIMIT 1
      `).bind(assetId, loansTenantId).all();
      assetRow = results?.[0] || null;
    } catch {
      assetRow = null;
    }

    if (!assetRow) {
      throw new HttpError(404, "Equipo no encontrado.");
    }

    const originalClient = normalizeOptionalString(assetRow.client_name, "").trim();

    try {
      const { results: activeLoans } = await env.DB.prepare(`
        SELECT id
        FROM asset_loans
        WHERE tenant_id = ? AND asset_id = ? AND returned_at IS NULL
        LIMIT 1
      `).bind(loansTenantId, assetId).all();

      if (activeLoans?.length) {
        throw new HttpError(
          409,
          "El equipo ya tiene un prestamo activo. Registra la devolucion primero.",
        );
      }
    } catch (error) {
      if (error instanceof HttpError) throw error;
      if (String(error?.message || "").toLowerCase().includes("no such table")) {
        throw new HttpError(
          503,
          "La tabla de prestamos no existe. Ejecuta la migracion 0020_asset_loans.sql.",
        );
      }
      throw error;
    }

    const insertResult = await env.DB.prepare(`
      INSERT INTO asset_loans (
        tenant_id,
        asset_id,
        original_client,
        borrowing_client,
        loaned_at,
        expected_return_at,
        loaned_by_username,
        notes,
        status
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active')
    `)
      .bind(
        loansTenantId,
        assetId,
        originalClient,
        borrowingClient,
        loanedAt,
        expectedReturnAt,
        actorUsername,
        notes,
      )
      .run();

    const loanId = insertResult?.meta?.last_row_id || null;

    await logAuditEvent(env, {
      action: "create_asset_loan",
      username: actorUsername,
      success: true,
      tenantId: loansTenantId,
      details: {
        loan_id: loanId,
        asset_id: assetId,
        external_code: assetRow.external_code,
        original_client: originalClient,
        borrowing_client: borrowingClient,
        expected_return_at: expectedReturnAt,
        tenant_id: loansTenantId,
      },
      ipAddress: getClientIpForRateLimit(request),
      platform: "web",
    });

    await publishRealtimeEvent(env, {
      type: "asset_loan_created",
      loan: {
        id: loanId,
        asset_id: assetId,
        asset_external_code: assetRow.external_code,
        original_client: originalClient,
        borrowing_client: borrowingClient,
        loaned_at: loanedAt,
        expected_return_at: expectedReturnAt,
        loaned_by_username: actorUsername,
        notes,
        status: "active",
      },
    }, realtimeTenantId);

    return jsonResponse(request, env, corsPolicy, {
      success: true,
      loan: {
        id: loanId,
        tenant_id: loansTenantId,
        asset_id: assetId,
        asset_external_code: assetRow.external_code,
        original_client: originalClient,
        borrowing_client: borrowingClient,
        loaned_at: loanedAt,
        expected_return_at: expectedReturnAt,
        loaned_by_username: actorUsername,
        notes,
        status: "active",
      },
    }, 201);
  }

  if (
    routeParts.length === 3 &&
    routeParts[0] === "loans" &&
    routeParts[2] === "return" &&
    request.method === "PATCH"
  ) {
    requireWebWriteRole(webSession?.role);
    const loanId = parsePositiveInt(routeParts[1], "loan_id");
    const data = await readJsonOrThrowBadRequest(request);
    const returnNotes = normalizeOptionalString(data?.return_notes, "").trim().slice(0, 2000);
    const returnedAt = nowIso();

    const { results: loanRows } = await env.DB.prepare(`
      SELECT l.*, a.external_code AS asset_external_code
      FROM asset_loans l
      LEFT JOIN assets a ON a.id = l.asset_id AND a.tenant_id = l.tenant_id
      WHERE l.id = ? AND l.tenant_id = ?
      LIMIT 1
    `).bind(loanId, loansTenantId).all();

    const loan = loanRows?.[0];
    if (!loan) {
      throw new HttpError(404, "Prestamo no encontrado.");
    }
    if (normalizeOptionalString(loan.returned_at, "").trim()) {
      throw new HttpError(409, "Este prestamo ya fue devuelto.");
    }

    await env.DB.prepare(`
      UPDATE asset_loans
      SET returned_at = ?, returned_by_username = ?, return_notes = ?, status = 'returned'
      WHERE id = ? AND tenant_id = ?
    `).bind(returnedAt, actorUsername, returnNotes, loanId, loansTenantId).run();

    await logAuditEvent(env, {
      action: "return_asset_loan",
      username: actorUsername,
      success: true,
      tenantId: loansTenantId,
      details: {
        loan_id: loanId,
        asset_id: loan.asset_id,
        external_code: loan.asset_external_code,
        borrowing_client: loan.borrowing_client,
        returned_at: returnedAt,
        tenant_id: loansTenantId,
      },
      ipAddress: getClientIpForRateLimit(request),
      platform: "web",
    });

    await publishRealtimeEvent(env, {
      type: "asset_loan_returned",
      loan: {
        id: loanId,
        asset_id: loan.asset_id,
        asset_external_code: loan.asset_external_code,
        borrowing_client: loan.borrowing_client,
        returned_at: returnedAt,
        returned_by_username: actorUsername,
        return_notes: returnNotes,
        status: "returned",
      },
    }, realtimeTenantId);

    return jsonResponse(request, env, corsPolicy, {
      success: true,
      loan: {
        id: loanId,
        asset_id: loan.asset_id,
        original_client: loan.original_client,
        borrowing_client: loan.borrowing_client,
        loaned_at: loan.loaned_at,
        expected_return_at: loan.expected_return_at,
        returned_at: returnedAt,
        returned_by_username: actorUsername,
        return_notes: returnNotes,
        status: "returned",
      },
    });
  }

  return null;
}

async function listPendingAssetLoanReminders(env, currentIso = nowIso()) {
  const currentDate = new Date(currentIso);
  const currentTime = Number.isFinite(currentDate.getTime()) ? currentDate.getTime() : Date.now();
  const dueSoonCutoffIso = new Date(currentTime + LOAN_DUE_SOON_HOURS * 60 * 60 * 1000).toISOString();
  const overdueRepeatCutoffIso = new Date(currentTime - LOAN_OVERDUE_REPEAT_HOURS * 60 * 60 * 1000).toISOString();

  try {
    const { results } = await env.DB.prepare(`
      SELECT
        l.*,
        a.external_code AS asset_external_code,
        a.brand AS asset_brand,
        a.model AS asset_model
      FROM asset_loans l
      LEFT JOIN assets a ON a.id = l.asset_id AND a.tenant_id = l.tenant_id
      WHERE l.returned_at IS NULL
        AND l.expected_return_at IS NOT NULL
      ORDER BY l.expected_return_at ASC, l.id ASC
    `).all();

    return (results || [])
      .map((row) => {
        const reminderType = resolveLoanReminderType(row, currentIso, {
          dueSoonCutoffIso,
          overdueRepeatCutoffIso,
        });
        return reminderType
          ? {
            ...mapLoanRow(row, currentIso),
            tenant_id: row.tenant_id,
            reminder_type: reminderType,
          }
          : null;
      })
      .filter(Boolean);
  } catch (error) {
    if (String(error?.message || "").toLowerCase().includes("no such table")) {
      return [];
    }
    throw error;
  }
}

async function markAssetLoanReminderSent(env, loan, reminderType, sentAt = nowIso()) {
  const loanId = Number.parseInt(String(loan?.id ?? ""), 10);
  const tenantId = normalizeRealtimeTenantId(loan?.tenant_id);
  if (!Number.isInteger(loanId) || loanId <= 0) return false;

  if (reminderType === "overdue") {
    await env.DB.prepare(`
      UPDATE asset_loans
      SET overdue_reminded_at = ?
      WHERE id = ? AND tenant_id = ?
    `).bind(sentAt, loanId, tenantId).run();
    return true;
  }

  await env.DB.prepare(`
    UPDATE asset_loans
    SET due_soon_reminded_at = ?
    WHERE id = ? AND tenant_id = ?
  `).bind(sentAt, loanId, tenantId).run();
  return true;
}

function buildAssetLoanReminderPushPayload(reminderType, loans) {
  const count = loans.length;
  if (reminderType === "overdue") {
    return {
      title: "Prestamos vencidos",
      body: count === 1
        ? `1 equipo ya supero la fecha de devolucion.`
        : `${count} equipos ya superaron la fecha de devolucion.`,
      data: {
        type: "asset_loan_overdue",
        count: String(count),
      },
    };
  }
  return {
    title: "Prestamos por vencer",
    body: count === 1
      ? `1 equipo vence dentro de ${LOAN_DUE_SOON_HOURS}h.`
      : `${count} equipos vencen dentro de ${LOAN_DUE_SOON_HOURS}h.`,
    data: {
      type: "asset_loan_due_soon",
      count: String(count),
    },
  };
}

async function processAssetLoanReminders(env, currentIso = nowIso()) {
  if (!env?.DB) {
    return {
      processed: false,
      reason: "missing_db",
      due_soon_count: 0,
      overdue_count: 0,
      tenants_notified: 0,
    };
  }

  const reminderRows = await listPendingAssetLoanReminders(env, currentIso);
  if (!reminderRows.length) {
    return {
      processed: true,
      due_soon_count: 0,
      overdue_count: 0,
      tenants_notified: 0,
    };
  }

  const tenantGroups = new Map();
  reminderRows.forEach((loan) => {
    const tenantId = normalizeRealtimeTenantId(loan?.tenant_id);
    const existing = tenantGroups.get(tenantId) || { dueSoon: [], overdue: [] };
    if (loan.reminder_type === "overdue") {
      existing.overdue.push(loan);
    } else {
      existing.dueSoon.push(loan);
    }
    tenantGroups.set(tenantId, existing);
  });

  let tenantsNotified = 0;
  for (const [tenantId, group] of tenantGroups.entries()) {
    const dueSoonLoans = group.dueSoon;
    const overdueLoans = group.overdue;
    const fcmTokens = await listDeviceTokensForWebRoles(env, ["admin", "super_admin"], tenantId);

    const dueSoonPush = dueSoonLoans.length
      ? await sendPushNotification(env, fcmTokens, buildAssetLoanReminderPushPayload("due_soon", dueSoonLoans))
      : { sent: false, reason: "no_due_soon_loans" };
    const overduePush = overdueLoans.length
      ? await sendPushNotification(env, fcmTokens, buildAssetLoanReminderPushPayload("overdue", overdueLoans))
      : { sent: false, reason: "no_overdue_loans" };

    const emailResult = await sendLoanReminderEmail(env, {
      tenantId,
      dueSoonLoans,
      overdueLoans,
    });
    const dueSoonDelivered = Boolean(dueSoonPush?.sent) || Boolean(emailResult?.delivered);
    const overdueDelivered = Boolean(overduePush?.sent) || Boolean(emailResult?.delivered);

    if (dueSoonDelivered) {
      for (const loan of dueSoonLoans) {
        await markAssetLoanReminderSent(env, loan, "due_soon", currentIso);
      }
    }
    if (overdueDelivered) {
      for (const loan of overdueLoans) {
        await markAssetLoanReminderSent(env, loan, "overdue", currentIso);
      }
    }

    if (dueSoonLoans.length && dueSoonDelivered) {
      await logAuditEvent(env, {
        action: "asset_loan_due_soon_reminder_sent",
        username: "system",
        success: true,
        tenantId,
        details: {
          tenant_id: tenantId,
          count: dueSoonLoans.length,
          loan_ids: dueSoonLoans.map((loan) => loan.id),
          push_sent: Boolean(dueSoonPush?.sent),
          email_delivered: Boolean(emailResult?.delivered),
        },
        platform: "system",
        timestamp: currentIso,
      });
    }

    if (overdueLoans.length && overdueDelivered) {
      await logAuditEvent(env, {
        action: "asset_loan_overdue_reminder_sent",
        username: "system",
        success: true,
        tenantId,
        details: {
          tenant_id: tenantId,
          count: overdueLoans.length,
          loan_ids: overdueLoans.map((loan) => loan.id),
          push_sent: Boolean(overduePush?.sent),
          email_delivered: Boolean(emailResult?.delivered),
        },
        platform: "system",
        timestamp: currentIso,
      });
    }

    await publishRealtimeEvent(env, {
      type: "asset_loan_reminder_summary",
      tenant_id: tenantId,
      summary: {
        due_soon_count: dueSoonLoans.length,
        overdue_count: overdueLoans.length,
        due_soon_delivered: dueSoonDelivered,
        overdue_delivered: overdueDelivered,
      },
    }, tenantId);

    if (dueSoonDelivered || overdueDelivered) {
      tenantsNotified += 1;
    }
  }

  return {
    processed: true,
    due_soon_count: reminderRows.filter((loan) => loan.reminder_type === "due_soon").length,
    overdue_count: reminderRows.filter((loan) => loan.reminder_type === "overdue").length,
    tenants_notified: tenantsNotified,
  };
}

const authSecurityHelpers = createAuthSecurityHelpers({
  HttpError,
  DEFAULT_REALTIME_TENANT_ID,
  WEB_LOGIN_RATE_LIMIT_MAX_ATTEMPTS,
  WEB_LOGIN_RATE_LIMIT_LOCKOUT_SECONDS,
  WEB_PASSWORD_VERIFY_RATE_LIMIT_MAX_ATTEMPTS,
  WEB_PASSWORD_VERIFY_RATE_LIMIT_LOCKOUT_SECONDS,
  WEB_AUTH_ALLOW_INSECURE_FALLBACK_ENV,
  AUTH_NONCE_TTL_SECONDS,
  AUTH_NONCE_PATTERN,
  AUTH_NONCE_MAX_LENGTH,
  MAX_AUTH_INMEM_NONCE_TRACKED,
  normalizeOptionalString,
  normalizeRealtimeTenantId,
  normalizeWebUsername,
  nowUnixSeconds,
  sha256Hex,
  sanitizeStorageSegment,
  logAuditEvent,
});

const {
  getClientIpForRateLimit,
  buildWebLoginRateLimitIdentifier,
  buildWebBootstrapRateLimitIdentifier,
  buildWebPasswordVerifyRateLimitIdentifier,
  buildWebAuthFailureAuditDetails,
  logWebAuditEvent,
  consumeAuthReplayNonce,
  checkWebLoginRateLimit,
  recordFailedWebLoginAttempt,
  clearWebLoginRateLimit,
  checkWebPasswordVerifyRateLimit,
  recordFailedWebPasswordVerifyAttempt,
  clearWebPasswordVerifyRateLimit,
} = authSecurityHelpers;

const webUserAuthHelpers = createWebUserAuthHelpers({
  HttpError,
  WEB_USERNAME_PATTERN,
  WEB_PASSWORD_MIN_LENGTH,
  WEB_PASSWORD_SPECIAL_CHARS,
  WEB_PASSWORD_PBKDF2_ITERATIONS,
  WEB_PASSWORD_KEY_LENGTH_BYTES,
  WEB_DEFAULT_ROLE,
  WEB_HASH_TYPE_PBKDF2,
  WEB_HASH_TYPE_BCRYPT,
  WEB_HASH_TYPE_LEGACY_PBKDF2,
  WEB_ALLOWED_HASH_TYPES,
  normalizeOptionalString,
  normalizeRealtimeTenantId,
  normalizeWebUsername,
  nowIso,
  timingSafeEqual,
  buildUsernameIdCursor,
  bytesToBase64Url,
  base64UrlToBytes,
});

const {
  ensureWebUsersTableAvailable,
  validateWebUsername,
  validateWebPassword,
  normalizeWebRole,
  countWebUsers,
  getWebUserByUsername,
  getWebUserById,
  serializeWebUser,
  listWebUsers,
  createWebUser,
  normalizeActiveFlag,
  normalizeImportedWebUser,
  upsertWebUserFromImport,
  updateWebUserRoleAndStatus,
  forceResetWebUserPassword,
  authenticateWebUserByCredentials,
  verifyCurrentWebUserPassword,
} = webUserAuthHelpers;

const webSessionHelpers = createWebSessionHelpers({
  HttpError,
  DEFAULT_REALTIME_TENANT_ID,
  WEB_DEFAULT_ROLE,
  WEB_BEARER_TOKEN_TYPE,
  WEB_ACCESS_TTL_SECONDS,
  WEB_SESSION_COOKIE_NAME,
  WEB_SESSION_STORE_TTL_SECONDS,
  normalizeOptionalString,
  normalizeRealtimeTenantId,
  nowUnixSeconds,
  normalizeWebUsername,
  hmacSha256Hex,
  timingSafeEqual,
  base64UrlEncodeUtf8,
  base64UrlDecodeUtf8,
  serializeWebUser,
  getWebUserById,
  getWebUserByUsername,
  ensureDbBinding,
  normalizeActiveFlag,
});

const {
  ensureWebSessionSecret,
  buildWebSessionCookie,
  buildWebSessionCookieClearHeader,
  rotateWebSessionVersion,
  invalidateWebSessionVersion,
  buildWebSessionAuthPayload,
  buildWebSessionStatusPayload,
  buildWebAccessToken,
  verifyWebAccessToken,
  resolveCurrentWebSessionUser,
} = webSessionHelpers;

const { verifyAuth: verifyLegacyAuth } = createLegacyAuthHelpers({
  HttpError,
  LEGACY_API_TENANT_ENV_NAME,
  AUTH_WINDOW_SECONDS,
  AUTH_NONCE_PATTERN,
  AUTH_NONCE_MAX_LENGTH,
  MAX_AUTH_INMEM_BODY_HASH_BYTES,
  EMPTY_BODY_SHA256_HEX,
  normalizeOptionalString,
  normalizeRealtimeTenantId,
  nowUnixSeconds,
  timingSafeEqual,
  sha256Hex,
  hmacSha256Hex,
  consumeAuthReplayNonce,
});

const upsertImportedWebUser = (env, importedUser) =>
  upsertWebUserFromImport(env, importedUser, invalidateWebSessionVersion);

const webAuthRouteHandlers = createWebAuthRouteHandlers({
  HttpError,
  DEFAULT_REALTIME_TENANT_ID,
  WEB_DEFAULT_ROLE,
  MAX_WEB_AUTH_DEFAULT_BODY_BYTES,
  MAX_WEB_AUTH_IMPORT_BODY_BYTES,
  jsonResponse,
  normalizeOptionalString,
  normalizeRealtimeTenantId,
  parsePageLimit,
  parseUsernameIdCursor,
  readJsonOrThrowBadRequest,
  ensureWebSessionSecret,
  normalizeWebUsername,
  validateWebUsername,
  buildWebLoginRateLimitIdentifier,
  buildWebBootstrapRateLimitIdentifier,
  ensureDbBinding,
  checkWebLoginRateLimit,
  authenticateWebUserByCredentials,
  recordFailedWebLoginAttempt,
  logWebAuditEvent,
  buildWebAuthFailureAuditDetails,
  clearWebLoginRateLimit,
  rotateWebSessionVersion,
  buildWebAccessToken,
  buildWebSessionAuthPayload,
  buildWebSessionCookie,
  verifyWebAccessToken,
  buildWebPasswordVerifyRateLimitIdentifier,
  checkWebPasswordVerifyRateLimit,
  verifyCurrentWebUserPassword,
  recordFailedWebPasswordVerifyAttempt,
  clearWebPasswordVerifyRateLimit,
  countWebUsers,
  timingSafeEqual,
  validateWebPassword,
  normalizeWebRole,
  createWebUser,
  canManageAllTenants,
  listWebUsers,
  requireAdminRole,
  requireSuperAdminRole,
  assertSameTenantOrSuperAdmin,
  getWebUserById,
  parsePositiveInt,
  parseBooleanOrNull,
  normalizeActiveFlag,
  updateWebUserRoleAndStatus,
  invalidateWebSessionVersion,
  serializeWebUser,
  forceResetWebUserPassword,
  normalizeImportedWebUser,
  upsertWebUserFromImport: upsertImportedWebUser,
  buildWebSessionCookieClearHeader,
  resolveCurrentWebSessionUser,
  buildWebSessionStatusPayload,
});

const systemRouteHandlers = createSystemRouteHandlers({
  jsonResponse,
});

const devicesRouteHandlers = createDevicesRouteHandlers({
  jsonResponse,
  normalizeFcmToken,
  readJsonOrThrowBadRequest,
  upsertDeviceTokenForWebUser,
});

const statisticsRouteHandlers = createStatisticsRouteHandlers({
  jsonResponse,
  textResponse,
});

const lookupRouteHandlers = createLookupRouteHandlers({
  jsonResponse,
  isMissingAssetsTableError,
});

const maintenanceRouteHandlers = createMaintenanceRouteHandlers({
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
});

const auditLogsRouteHandlers = createAuditLogsRouteHandlers({
  jsonResponse,
  readJsonOrThrowBadRequest,
  requireAdminRole,
  normalizeWebUsername,
  logAuditEvent,
  parsePageLimit,
  parseTimestampIdCursor,
  buildTimestampIdCursor,
  appendPaginationHeader,
});

const publicTrackingRouteHandlers = createPublicTrackingRouteHandlers({
  HttpError,
  jsonResponse,
  textResponse,
  requireAdminRole,
  parsePositiveInt,
  getClientIpForRateLimit,
  issuePublicTrackingLink,
  revokePublicTrackingLink,
  getActivePublicTrackingLink,
  resolvePublicTrackingRequest,
  renderPublicTrackingHtml,
  publicTrackingHeaders,
  logAuditEvent,
  resolvePublicTrackingOrigin,
});

const recordsRouteHandlers = createRecordsRouteHandlers({
  jsonResponse,
  readJsonOrThrowBadRequest,
  requireWebWriteRole,
  normalizeRealtimeTenantId,
  normalizeInstallationPayload,
  buildDefaultInstallationOperationalSummary,
  publishRealtimeEvent,
  publishRealtimeStatsUpdate,
  syncPublicTrackingSnapshotForInstallation,
});

const installationsRouteHandlers = createInstallationsRouteHandlers({
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
});

const conformitiesRouteHandlers = createConformitiesRouteHandlers({
  buildGpsMapsUrl,
  buildGpsMetadataSnapshot,
  evaluateGeofence,
  jsonResponse,
  corsHeaders,
  parsePositiveInt,
  normalizeOptionalString,
  normalizeGpsPayload,
  normalizeRealtimeTenantId,
  requireWebWriteRole,
  readJsonOrThrowBadRequest,
  logAuditEvent,
  getClientIpForRateLimit,
  nowIso,
  loadInstallationConformityContext,
  loadLatestInstallationConformity,
  loadInstallationConformityPdfById,
  persistInstallationConformity,
  storeSignatureAsset,
  generateConformityPdf,
  storeConformityPdf,
  sendConformityEmail,
  syncPublicTrackingSnapshotForInstallation,
});

const incidentsRouteHandlers = createIncidentsRouteHandlers({
  jsonResponse,
  parsePositiveInt,
  requireWebWriteRole,
  requireAdminRole,
  requireSuperAdminRole,
  readJsonOrThrowBadRequest,
  validateIncidentPayload,
  parseOptionalPositiveInt,
  nowIso,
  isMissingIncidentAssetColumnError,
  isMissingIncidentTimingColumnsError,
  normalizeIncidentEvidencePayload,
  normalizeIncidentStatusPayload,
  evaluateGeofence,
  loadIncidentForTenant,
  loadIncidentTimingFieldsForTenant,
  parseIncidentChecklistItems,
  normalizeOptionalString,
  listDeviceTokensForWebRoles,
  criticalIncidentPushRoles: CRITICAL_INCIDENT_PUSH_ROLES,
  sendPushNotification,
  logAuditEvent,
  getClientIpForRateLimit,
  mapIncidentRow,
  publishRealtimeEvent,
  publishRealtimeStatsUpdate,
  allowedPhotoTypes: ALLOWED_INCIDENT_PHOTO_TYPES,
  normalizeContentType,
  validateAndProcessPhoto,
  requireIncidentsBucketOperation,
  loadIncidentByIdForTenant,
  extensionFromType,
  resolveIncidentPhotoMetadata,
  buildIncidentPhotoDescriptor,
  buildIncidentPhotoFileName,
  buildIncidentR2Key,
  sha256Hex,
  loadIncidentPhotoByIdForTenant,
  recoverIncidentPhotosFromStorageForTenant,
  sanitizeFileName,
  corsHeaders,
  syncPublicTrackingSnapshotForInstallation,
});

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const pathParts = url.pathname.split("/").filter((part) => part !== "");
    const isWebRoute = pathParts[0] === "web";
    const routeParts = isWebRoute ? pathParts.slice(1) : pathParts;
    const corsPolicy = buildCorsPolicy(isWebRoute, routeParts);

    if (request.method === "OPTIONS") {
      const origin = normalizeOptionalString(request.headers.get("Origin"), "");
      const preflightHeaders = corsHeaders(request, env, corsPolicy);
      if (origin && !preflightHeaders["Access-Control-Allow-Origin"]) {
        return new Response("Origin no permitido.", { status: 403 });
      }
      return new Response(null, {
        status: 204,
        headers: preflightHeaders,
      });
    }

    try {
      const serviceMetadataResponse = systemRouteHandlers.handleServiceMetadataRoute(
        request,
        env,
        corsPolicy,
        routeParts,
      );
      if (serviceMetadataResponse) {
        return serviceMetadataResponse;
      }

      const healthCheckResponse = systemRouteHandlers.handleHealthCheckRoute(
        request,
        env,
        corsPolicy,
        routeParts,
      );
      if (healthCheckResponse) {
        return healthCheckResponse;
      }

      const dashboardAssetResponse = await serveDashboardStaticAsset(request, env, corsPolicy, routeParts);
      if (dashboardAssetResponse) {
        return dashboardAssetResponse;
      }

      const sseEventsResponse = await handleSseEventsRoute(
        request,
        env,
        url,
        corsPolicy,
        routeParts,
      );
      if (sseEventsResponse) {
        return sseEventsResponse;
      }

      const publicTrackingPublicResponse = await publicTrackingRouteHandlers.handlePublicTrackingPublicRoute(
        request,
        env,
        corsPolicy,
        routeParts,
      );
      if (publicTrackingPublicResponse) {
        return publicTrackingPublicResponse;
      }
      if (isWebRoute) {
        const webAuthResponse = await webAuthRouteHandlers.handleWebAuthRoute(
          request,
          env,
          routeParts,
          corsPolicy,
        );
        if (webAuthResponse) {
          return applyNoStoreHeaders(webAuthResponse);
        }
      }

      if (!env.DB) {
        throw new Error("La base de datos (D1) no esta vinculada a este Worker.");
      }

      let webSession = null;
      let realtimeTenantId = DEFAULT_REALTIME_TENANT_ID;
      if (isWebRoute) {
        webSession = await verifyWebAccessToken(request, env);
        realtimeTenantId = resolveRealtimeTenantId(request, webSession);
      } else {
        realtimeTenantId = await verifyLegacyAuth(request, env, url);
      }
      const incidentsTenantId = normalizeRealtimeTenantId(
        isWebRoute ? webSession?.tenant_id : realtimeTenantId,
      );


      const lookupTenantId = normalizeRealtimeTenantId(
        isWebRoute ? webSession?.tenant_id : realtimeTenantId,
      );
      const lookupResponse = await lookupRouteHandlers.handleLookupRoute(
        request,
        env,
        url,
        corsPolicy,
        routeParts,
        lookupTenantId,
      );
      if (lookupResponse) {
        return lookupResponse;
      }

      const assetsResponse = await handleAssetsRoute(
        request,
        env,
        url,
        corsPolicy,
        routeParts,
        isWebRoute,
        webSession,
        realtimeTenantId,
      );
      if (assetsResponse) {
        return assetsResponse;
      }
      const loansResponse = await handleLoansRoute(
        request,
        env,
        url,
        corsPolicy,
        routeParts,
        isWebRoute,
        webSession,
        realtimeTenantId,
      );
      if (loansResponse) {
        return loansResponse;
      }
      const driversResponse = await handleDriversRoute(
        request,
        env,
        url,
        corsPolicy,
        routeParts,
        isWebRoute,
        webSession,
      );
      if (driversResponse) {
        return driversResponse;
      }
      const installationsResponse = await installationsRouteHandlers.handleInstallationsRoute(
        request,
        env,
        url,
        corsPolicy,
        routeParts,
        isWebRoute,
        webSession,
        realtimeTenantId,
      );
      if (installationsResponse) {
        return installationsResponse;
      }
      const maintenanceResponse = await maintenanceRouteHandlers.handleMaintenanceCleanupRoute(
        request,
        env,
        corsPolicy,
        routeParts,
        isWebRoute,
        webSession,
        realtimeTenantId,
      );
      if (maintenanceResponse) {
        return maintenanceResponse;
      }
      const auditLogsResponse = await auditLogsRouteHandlers.handleAuditLogsRoute(
        request,
        env,
        url,
        corsPolicy,
        routeParts,
        isWebRoute,
        webSession,
        realtimeTenantId,
      );
      if (auditLogsResponse) {
        return auditLogsResponse;
      }
      const publicTrackingWebResponse = await publicTrackingRouteHandlers.handlePublicTrackingWebRoute(
        request,
        env,
        url,
        corsPolicy,
        routeParts,
        isWebRoute,
        webSession,
      );
      if (publicTrackingWebResponse) {
        return publicTrackingWebResponse;
      }
      const devicesResponse = await devicesRouteHandlers.handleDevicesRoute(
        request,
        env,
        corsPolicy,
        routeParts,
        isWebRoute,
        webSession,
      );
      if (devicesResponse) {
        return devicesResponse;
      }
      const recordsResponse = await recordsRouteHandlers.handleRecordsRoute(
        request,
        env,
        corsPolicy,
        routeParts,
        isWebRoute,
        webSession,
        realtimeTenantId,
      );
      if (recordsResponse) {
        return recordsResponse;
      }
      const installationIncidentsResponse = await incidentsRouteHandlers.handleInstallationIncidentsRoute(
        request,
        env,
        corsPolicy,
        routeParts,
        isWebRoute,
        webSession,
        incidentsTenantId,
        realtimeTenantId,
      );
      if (installationIncidentsResponse) {
        return installationIncidentsResponse;
      }
      const incidentDetailResponse = await incidentsRouteHandlers.handleIncidentDetailRoute(
        request,
        env,
        corsPolicy,
        routeParts,
        incidentsTenantId,
      );
      if (incidentDetailResponse) {
        return incidentDetailResponse;
      }
      const incidentEvidenceResponse = await incidentsRouteHandlers.handleIncidentEvidenceRoute(
        request,
        env,
        corsPolicy,
        routeParts,
        isWebRoute,
        webSession,
        incidentsTenantId,
        realtimeTenantId,
      );
      if (incidentEvidenceResponse) {
        return incidentEvidenceResponse;
      }
      const incidentDeleteResponse = await incidentsRouteHandlers.handleIncidentDeleteRoute(
        request,
        env,
        corsPolicy,
        routeParts,
        isWebRoute,
        webSession,
        incidentsTenantId,
        realtimeTenantId,
      );
      if (incidentDeleteResponse) {
        return incidentDeleteResponse;
      }
      const incidentStatusResponse = await incidentsRouteHandlers.handleIncidentStatusRoute(
        request,
        env,
        corsPolicy,
        routeParts,
        isWebRoute,
        webSession,
        incidentsTenantId,
        realtimeTenantId,
      );
      if (incidentStatusResponse) {
        return incidentStatusResponse;
      }
      const incidentPhotosResponse = await incidentsRouteHandlers.handleIncidentPhotosRoute(
        request,
        env,
        corsPolicy,
        routeParts,
        isWebRoute,
        webSession,
        incidentsTenantId,
      );
      if (incidentPhotosResponse) {
        return incidentPhotosResponse;
      }
      const installationConformityResponse =
        await conformitiesRouteHandlers.handleInstallationConformityRoute(
          request,
          env,
          corsPolicy,
          routeParts,
          isWebRoute,
          webSession,
        );
      if (installationConformityResponse) {
        return installationConformityResponse;
      }

      const installationByIdResponse = await installationsRouteHandlers.handleInstallationByIdRoute(
        request,
        env,
        corsPolicy,
        routeParts,
        isWebRoute,
        webSession,
        realtimeTenantId,
      );
      if (installationByIdResponse) {
        return installationByIdResponse;
      }
      const statisticsTrendResponse = await statisticsRouteHandlers.handleStatisticsTrendRoute(
        request,
        env,
        url,
        corsPolicy,
        routeParts,
        isWebRoute,
        webSession,
        realtimeTenantId,
      );
      if (statisticsTrendResponse) {
        return statisticsTrendResponse;
      }
      const statisticsResponse = await statisticsRouteHandlers.handleStatisticsRoute(
        request,
        env,
        url,
        corsPolicy,
        routeParts,
        isWebRoute,
        webSession,
        realtimeTenantId,
      );
      if (statisticsResponse) {
        return statisticsResponse;
      }

      return textResponse(request, env, corsPolicy, "Ruta no encontrada.", 404);
    } catch (error) {
      const errorStatus = Number.isInteger(error?.status) ? error.status : null;
      if (error instanceof HttpError || errorStatus !== null) {
        return jsonResponse(request, env, corsPolicy,
          {
            success: false,
            error: {
              code: errorCodeFromHttpStatus(errorStatus ?? error.status),
              message: error.message,
            },
          },
          errorStatus ?? error.status,
        );
      }

      console.error("[worker] unhandled error", {
        method: request.method,
        path: new URL(request.url).pathname,
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });

      return jsonResponse(request, env, corsPolicy,
        {
          success: false,
          error: {
            code: "INTERNAL_ERROR",
            message: "Error interno del servidor.",
          },
        },
        500,
      );
    }
  },
  async scheduled(controller, env, ctx) {
    const run = processAssetLoanReminders(env, nowIso());
    if (ctx && typeof ctx.waitUntil === "function") {
      ctx.waitUntil(run);
    }

    try {
      const summary = await run;
      console.info("[asset-loans] reminder run completed", {
        cron: controller?.cron || null,
        ...summary,
      });
      return summary;
    } catch (error) {
      console.error("[asset-loans] reminder run failed", {
        cron: controller?.cron || null,
        message: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  },
};
