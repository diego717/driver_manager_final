import bcrypt from "bcryptjs";

const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
const MIN_PHOTO_BYTES = 1024;
const ALLOWED_PHOTO_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const AUTH_WINDOW_SECONDS = 300;
const WEB_ACCESS_TTL_SECONDS = 8 * 60 * 60;
const WEB_SESSION_COOKIE_NAME = "__Host-web_session";
const WEB_SESSION_STORE_TTL_SECONDS = WEB_ACCESS_TTL_SECONDS + 60;
const WEB_LOGIN_RATE_LIMIT_MAX_ATTEMPTS = 5;
const WEB_LOGIN_RATE_LIMIT_LOCKOUT_SECONDS = 15 * 60;
const WEB_PASSWORD_MIN_LENGTH = 12;
const WEB_PASSWORD_SPECIAL_CHARS = "!@#$%^&*()_+-=[]{}|;:,.<>?";
const WEB_PASSWORD_PBKDF2_ITERATIONS = 100000;
const WEB_PASSWORD_KEY_LENGTH_BYTES = 32;
const WEB_USERNAME_PATTERN = /^[a-z0-9._-]{3,64}$/;
const WEB_DEFAULT_ROLE = "admin";
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
const SSE_POLL_INTERVAL_MS = 4000;
const SSE_KEEP_ALIVE_INTERVAL_MS = 30000;
const SSE_MAX_CONNECTION_MS = 5 * 60 * 1000;
const REALTIME_BROKER_INSTANCE = "global";
const DEFAULT_REALTIME_TENANT_ID = "default";

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const CONTROLLED_DASHBOARD_ORIGINS = [
  "https://dashboard.driver-manager.app",
  "https://dashboard.drivermanager.app",
];
const CONTROLLED_MOBILE_ORIGINS = [
  "https://mobile.driver-manager.app",
  "https://app.driver-manager.app",
  "capacitor://localhost",
];

function isLocalhostOrigin(origin) {
  if (!origin) return false;
  try {
    const parsed = new URL(origin);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return false;
    }
    const host = normalizeOptionalString(parsed.hostname, "").toLowerCase();
    return host === "localhost" || host === "127.0.0.1" || host === "::1";
  } catch {
    return false;
  }
}

function getAllowedCorsOrigins(request, env) {
  void request;
  const allowed = new Set([...CONTROLLED_DASHBOARD_ORIGINS, ...CONTROLLED_MOBILE_ORIGINS]);

  const extraOrigins = normalizeOptionalString(env?.CORS_ALLOWED_ORIGINS, "");
  if (extraOrigins) {
    for (const origin of extraOrigins.split(",")) {
      const normalized = origin.trim();
      if (normalized) {
        allowed.add(normalized);
      }
    }
  }

  return allowed;
}

function buildCorsPolicy(isWebRoute, routeParts) {
  const headers = new Set();
  const methods = new Set(["OPTIONS"]);

  if (routeParts.length === 0 || (routeParts.length === 1 && routeParts[0] === "health")) {
    methods.add("GET");
    return { methods: [...methods], headers: [] };
  }

  const first = routeParts[0] || "";
  const isPhotoUpload = routeParts.length === 3 && first === "incidents" && routeParts[2] === "photos";
  const isRecordById = routeParts.length === 2 && first === "installations";

  if (isWebRoute) {
    headers.add("Authorization");
    headers.add("X-Client-Platform");
  } else {
    headers.add("X-API-Token");
    headers.add("X-Request-Timestamp");
    headers.add("X-Request-Signature");
  }

  if (isPhotoUpload || first === "records" || first === "devices" || first === "audit-logs" || first === "auth" || first === "installations") {
    headers.add("Content-Type");
  }
  if (isPhotoUpload) {
    headers.add("X-File-Name");
  }

  if (
    ["dashboard", "dashboard.css", "dashboard.js", "dashboard-pwa.js", "manifest.json", "events", "sw.js"].includes(
      first,
    )
  ) {
    methods.add("GET");
  } else if (first === "installations" && !isRecordById) {
    methods.add("GET");
    methods.add("POST");
  } else if (isRecordById) {
    methods.add("GET");
    methods.add("PUT");
    methods.add("DELETE");
  } else if (["records", "devices", "audit-logs"].includes(first)) {
    methods.add(first === "audit-logs" ? "GET" : "POST");
    methods.add("POST");
  } else if (first === "statistics" || first === "photos" || first === "lookup") {
    methods.add("GET");
  } else if (first === "incidents") {
    methods.add("GET");
    methods.add("POST");
  } else if (first === "auth") {
    methods.add("GET");
    methods.add("POST");
    methods.add("PATCH");
  }

  return {
    methods: [...methods],
    headers: [...headers],
  };
}

function corsHeaders(request, env, corsPolicy = { methods: ["OPTIONS"], headers: [] }) {
  const origin = normalizeOptionalString(request?.headers?.get("Origin"), "");
  if (!origin) return {};

  const allowedOrigins = getAllowedCorsOrigins(request, env);
  // Always allow localhost origins for dev tooling (Expo web / local dashboard).
  // This avoids browser-side "Failed to fetch" caused by preflight 403 in local workflows.
  const isAllowedLocalhostOrigin = isLocalhostOrigin(origin);
  if (!allowedOrigins.has(origin) && !isAllowedLocalhostOrigin) {
    return {};
  }

  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": corsPolicy.methods.join(", "),
    "Access-Control-Allow-Headers": corsPolicy.headers.join(", "),
    Vary: "Origin",
  };
}

function jsonResponse(request, env, corsPolicy, body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders(request, env, corsPolicy),
      "Content-Type": "application/json",
    },
  });
}

function textResponse(request, env, corsPolicy, text, status = 200) {
  return new Response(text, {
    status,
    headers: corsHeaders(request, env, corsPolicy),
  });
}

function dashboardAssetSecurityHeaders() {
  return {
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Permissions-Policy": "geolocation=(), microphone=(), camera=()",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": [
      "default-src 'self'",
      "base-uri 'self'",
      "frame-ancestors 'none'",
      "object-src 'none'",
      "img-src 'self' data: blob:",
      "font-src 'self' data:",
      "connect-src 'self'",
      "script-src 'self' https://cdn.jsdelivr.net",
      "style-src 'self'",
      "manifest-src 'self'",
    ].join("; "),
  };
}

const DASHBOARD_ASSET_PATHS = {
  dashboard: "/dashboard.html",
  "dashboard.css": "/dashboard.css",
  "dashboard.js": "/dashboard.js",
  "dashboard-pwa.js": "/dashboard-pwa.js",
  "manifest.json": "/manifest.json",
  "sw.js": "/sw.js",
};

function resolveDashboardAssetPath(routeParts) {
  if (!Array.isArray(routeParts) || routeParts.length !== 1) return null;
  return DASHBOARD_ASSET_PATHS[routeParts[0]] || null;
}

function dashboardAssetContentType(assetPath) {
  if (assetPath === "/dashboard.html") return "text/html; charset=utf-8";
  if (assetPath === "/dashboard.css") return "text/css; charset=utf-8";
  if (assetPath === "/dashboard.js" || assetPath === "/dashboard-pwa.js" || assetPath === "/sw.js") {
    return "application/javascript; charset=utf-8";
  }
  if (assetPath === "/manifest.json") return "application/manifest+json; charset=utf-8";
  return null;
}

function dashboardAssetCacheControl(assetPath) {
  if (assetPath === "/dashboard.html") return "public, max-age=0, must-revalidate";
  if (assetPath === "/sw.js") return "no-cache";
  return "public, max-age=31536000, immutable";
}

function dashboardFallbackHtml() {
  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Driver Manager Dashboard</title>
</head>
<body>
  <main>
    <h1>Driver Manager Dashboard</h1>
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
    if (assetPath === "/dashboard.html") {
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

  const assetUrl = new URL(request.url);
  assetUrl.pathname = assetPath;
  assetUrl.search = "";
  const assetResponse = await env.ASSETS.fetch(new Request(assetUrl.toString(), request));
  if (assetResponse.status === 404) return null;

  const headers = new Headers(assetResponse.headers);
  const contentType = dashboardAssetContentType(assetPath);
  if (contentType) headers.set("Content-Type", contentType);
  headers.set("Cache-Control", dashboardAssetCacheControl(assetPath));

  const cors = corsHeaders(request, env, corsPolicy);
  for (const [key, value] of Object.entries(cors)) headers.set(key, value);
  for (const [key, value] of Object.entries(dashboardAssetSecurityHeaders())) headers.set(key, value);

  return new Response(request.method === "HEAD" ? null : assetResponse.body, {
    status: assetResponse.status,
    headers,
  });
}

function parsePositiveInt(value, label) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new HttpError(400, `${label} invÃ¡lido.`);
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

function extensionFromType(contentType) {
  if (contentType === "image/png") return "png";
  if (contentType === "image/webp") return "webp";
  return "jpg";
}

function detectPhotoContentTypeFromMagicBytes(bodyBuffer) {
  const bytes = new Uint8Array(bodyBuffer);
  if (bytes.length < 12) return "";

  const isJpeg = bytes[0] === 0xff && bytes[1] === 0xd8;
  const isPng =
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a;
  const isWebp =
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50;

  if (isJpeg) return "image/jpeg";
  if (isPng) return "image/png";
  if (isWebp) return "image/webp";
  return "";
}

function validateAndProcessPhoto(bodyBuffer, declaredContentType) {
  const sizeBytes = bodyBuffer.byteLength;
  if (!sizeBytes) {
    throw new HttpError(400, "La imagen esta vacia.");
  }
  if (sizeBytes < MIN_PHOTO_BYTES) {
    throw new HttpError(400, "Imagen demasiado pequena o corrupta.");
  }
  if (sizeBytes > MAX_PHOTO_BYTES) {
    throw new HttpError(
      413,
      `Imagen demasiado grande (${(sizeBytes / (1024 * 1024)).toFixed(1)}MB). Maximo: 5MB.`,
    );
  }

  const detectedContentType = detectPhotoContentTypeFromMagicBytes(bodyBuffer);
  if (!detectedContentType) {
    throw new HttpError(400, "El archivo no es una imagen valida.");
  }

  if (!ALLOWED_PHOTO_TYPES.has(detectedContentType)) {
    throw new HttpError(400, "Tipo de imagen no permitido.");
  }

  if (declaredContentType && declaredContentType !== detectedContentType) {
    throw new HttpError(400, "El Content-Type no coincide con el archivo de imagen.");
  }

  return {
    sizeBytes,
    contentType: detectedContentType,
  };
}

function nowIso() {
  return new Date().toISOString();
}

function nowUnixSeconds() {
  return Math.floor(Date.now() / 1000);
}

function normalizeOptionalString(value, fallback = "") {
  if (value === null || value === undefined) return fallback;
  return String(value).trim();
}

function normalizeRealtimeTenantId(value) {
  const raw = normalizeOptionalString(value, "").toLowerCase();
  if (!raw) return DEFAULT_REALTIME_TENANT_ID;
  const normalized = raw.replace(/[^a-z0-9._-]/g, "_").slice(0, 64);
  return normalized || DEFAULT_REALTIME_TENANT_ID;
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

function containsAnyChar(input, allowedChars) {
  for (let i = 0; i < input.length; i += 1) {
    if (allowedChars.includes(input[i])) return true;
  }
  return false;
}

function normalizeRateLimitCounter(value) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isInteger(parsed) || parsed < 0) {
    return 0;
  }
  return parsed;
}

function getRateLimitKv(env) {
  const kv = env.RATE_LIMIT_KV;
  if (!kv) return null;
  if (
    typeof kv.get !== "function" ||
    typeof kv.put !== "function" ||
    typeof kv.delete !== "function"
  ) {
    return null;
  }
  return kv;
}

function getClientIpForRateLimit(request) {
  const cfIp = normalizeOptionalString(request.headers.get("CF-Connecting-IP"), "");
  if (cfIp) return cfIp;

  const forwardedFor = normalizeOptionalString(request.headers.get("X-Forwarded-For"), "");
  if (forwardedFor) {
    const first = forwardedFor.split(",", 1)[0]?.trim();
    if (first) return first;
  }

  return "unknown";
}

function buildWebLoginRateLimitKey(identifier) {
  return `web_login_attempts:${identifier}`;
}

function buildWebLoginRateLimitIdentifier(request, username) {
  return `${getClientIpForRateLimit(request)}:${normalizeWebUsername(username)}`;
}

async function checkWebLoginRateLimit(env, identifier) {
  const kv = getRateLimitKv(env);
  if (!kv) return;

  const key = buildWebLoginRateLimitKey(identifier);
  const attempts = normalizeRateLimitCounter(await kv.get(key));
  if (attempts >= WEB_LOGIN_RATE_LIMIT_MAX_ATTEMPTS) {
    throw new HttpError(429, "Demasiados intentos fallidos. Intenta en 15 minutos.");
  }
}

async function recordFailedWebLoginAttempt(env, identifier) {
  const kv = getRateLimitKv(env);
  if (!kv) return;

  const key = buildWebLoginRateLimitKey(identifier);
  const currentAttempts = normalizeRateLimitCounter(await kv.get(key));
  await kv.put(key, String(currentAttempts + 1), {
    expirationTtl: WEB_LOGIN_RATE_LIMIT_LOCKOUT_SECONDS,
  });
}

async function clearWebLoginRateLimit(env, identifier) {
  const kv = getRateLimitKv(env);
  if (!kv) return;

  const key = buildWebLoginRateLimitKey(identifier);
  await kv.delete(key);
}

function normalizeNonNegativeInteger(value, fallback = 0) {
  if (value === null || value === undefined || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, Math.trunc(parsed));
}

function normalizeInstallationPayload(data, defaultStatus = "unknown") {
  const source = data && typeof data === "object" ? data : {};

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
  };
}

function parseDateOrNull(value) {
  if (!value) return null;
  const parsed = new Date(String(value));
  if (Number.isNaN(parsed.getTime())) {
    throw new HttpError(400, "Fecha invalida en filtros.");
  }
  return parsed;
}

function parseOptionalPositiveInt(value, label) {
  if (value === null || value === undefined || value === "") return null;
  return parsePositiveInt(value, label);
}

async function readJsonOrThrowBadRequest(request, message = "Payload invalido.") {
  try {
    return await request.json();
  } catch {
    throw new HttpError(400, message);
  }
}

function parsePageLimit(searchParams, options = {}) {
  const fallback = Number.isInteger(options.fallback) ? options.fallback : 100;
  const max = Number.isInteger(options.max) ? options.max : 500;
  const requested = parseOptionalPositiveInt(searchParams.get("limit"), "limit");
  if (requested === null) return fallback;
  return Math.min(requested, max);
}

function encodeCursorPart(value) {
  return encodeURIComponent(String(value ?? ""));
}

function decodeCursorPart(value) {
  return decodeURIComponent(value);
}

function buildTimestampIdCursor(timestamp, id) {
  return `${encodeCursorPart(timestamp)}|${encodeCursorPart(id)}`;
}

function parseTimestampIdCursor(rawCursor) {
  const cursor = normalizeOptionalString(rawCursor, "");
  if (!cursor) return null;

  const parts = cursor.split("|");
  if (parts.length !== 2) {
    throw new HttpError(400, "Cursor invalido.");
  }

  let timestamp = "";
  let idText = "";
  try {
    timestamp = decodeCursorPart(parts[0]);
    idText = decodeCursorPart(parts[1]);
  } catch {
    throw new HttpError(400, "Cursor invalido.");
  }

  if (!timestamp || Number.isNaN(Date.parse(timestamp))) {
    throw new HttpError(400, "Cursor invalido.");
  }

  const id = Number.parseInt(idText, 10);
  if (!Number.isInteger(id) || id <= 0) {
    throw new HttpError(400, "Cursor invalido.");
  }

  return { timestamp, id };
}

function buildUsernameIdCursor(username, id) {
  return `${encodeCursorPart(username)}|${encodeCursorPart(id)}`;
}

function parseUsernameIdCursor(rawCursor) {
  const cursor = normalizeOptionalString(rawCursor, "");
  if (!cursor) return null;

  const parts = cursor.split("|");
  if (parts.length !== 2) {
    throw new HttpError(400, "Cursor invalido.");
  }

  let username = "";
  let idText = "";
  try {
    username = decodeCursorPart(parts[0]);
    idText = decodeCursorPart(parts[1]);
  } catch {
    throw new HttpError(400, "Cursor invalido.");
  }

  if (!username) {
    throw new HttpError(400, "Cursor invalido.");
  }

  const id = Number.parseInt(idText, 10);
  if (!Number.isInteger(id) || id <= 0) {
    throw new HttpError(400, "Cursor invalido.");
  }

  return { username, id };
}

function appendPaginationHeader(response, nextCursor) {
  if (!response || !nextCursor) return response;
  response.headers.set("X-Next-Cursor", nextCursor);

  const expose = response.headers.get("Access-Control-Expose-Headers");
  if (!expose) {
    response.headers.set("Access-Control-Expose-Headers", "X-Next-Cursor");
    return response;
  }

  const normalized = expose.toLowerCase();
  if (!normalized.split(",").map((item) => item.trim()).includes("x-next-cursor")) {
    response.headers.set("Access-Control-Expose-Headers", `${expose}, X-Next-Cursor`);
  }
  return response;
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
      notes
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
  const { results } = await env.DB.prepare(`
    SELECT
      id,
      installation_id,
      reporter_username,
      note,
      time_adjustment_seconds,
      severity,
      source,
      created_at
    FROM incidents
    WHERE tenant_id = ?
      AND id > ?
    ORDER BY id ASC
    LIMIT ?
  `)
    .bind(normalizedTenantId, lastId, limit)
    .all();

  return results || [];
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
  return computeStatistics(installations || []);
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

async function connectRealtimeBrokerStream(request, env, corsPolicy, tenantId = DEFAULT_REALTIME_TENANT_ID) {
  const broker = getRealtimeBrokerStub(env);
  if (!broker || typeof broker.fetch !== "function") return null;

  const brokerUrl = new URL("https://realtime/connect");
  brokerUrl.searchParams.set("tenant_id", normalizeRealtimeTenantId(tenantId));
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

    this.keepAliveTimer = setInterval(() => {
      this.broadcastComment("ping").catch(() => {});
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
    return this.handleConnectWithTenant(tenantId);
  }

  async handleConnectWithTenant(tenantId) {
    const clientId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const stream = new TransformStream();
    const writer = stream.writable.getWriter();

    const reconnectTimer = setTimeout(() => {
      this.closeClient(clientId, {
        type: "reconnect",
        message: "Reconexión requerida",
        timestamp: nowIso(),
      }).catch(() => {});
    }, SSE_MAX_CONNECTION_MS);

    this.clients.set(clientId, {
      writer,
      reconnectTimer,
      tenantId: normalizeRealtimeTenantId(tenantId),
      connectedAt: Date.now(),
    });

    await this.writeData(writer, {
      type: "connected",
      message: "Conexión en tiempo real establecida",
      tenant_id: normalizeRealtimeTenantId(tenantId),
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
        await client.writer.write(this.encoder.encode(`:${comment}\n\n`));
      } catch {
        staleClientIds.push(clientId);
      }
    }
    for (const clientId of staleClientIds) {
      await this.closeClient(clientId);
    }
  }

  async writeData(writer, payload) {
    await writer.write(this.encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
  }

  async closeClient(clientId, finalPayload = null) {
    const client = this.clients.get(clientId);
    if (!client) return;
    this.clients.delete(clientId);
    if (client.reconnectTimer) clearTimeout(client.reconnectTimer);
    try {
      if (finalPayload) {
        await this.writeData(client.writer, finalPayload);
      }
    } catch {}
    try {
      await client.writer.close();
    } catch {}
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
  { action, username, success, details, computerName, ipAddress, platform, timestamp },
  options = {},
) {
  const swallowErrors = options?.swallowErrors !== false;
  try {
    const detailsJson = details && typeof details === "object" ? JSON.stringify(details) : "{}";
    await env.DB.prepare(`
      INSERT INTO audit_logs (timestamp, action, username, success, details, computer_name, ip_address, platform)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `)
      .bind(
        normalizeOptionalString(timestamp, nowIso()),
        normalizeOptionalString(action, "unknown"),
        normalizeOptionalString(username, "unknown"),
        success ? 1 : 0,
        detailsJson,
        normalizeOptionalString(computerName, ""),
        normalizeOptionalString(ipAddress, ""),
        normalizeOptionalString(platform, "")
      )
      .run();
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

  const nowSeconds = nowUnixSeconds();
  if (
    fcmAccessTokenCache &&
    fcmAccessTokenCache.projectId === serviceAccount.projectId &&
    normalizeOptionalString(fcmAccessTokenCache.accessToken, "") &&
    Number.isInteger(fcmAccessTokenCache.expiresAt) &&
    fcmAccessTokenCache.expiresAt > nowSeconds + 60
  ) {
    return {
      accessToken: fcmAccessTokenCache.accessToken,
      projectId: serviceAccount.projectId,
    };
  }

  const header = {
    alg: "RS256",
    typ: "JWT",
  };
  const payload = {
    iss: serviceAccount.clientEmail,
    scope: FCM_OAUTH_SCOPE,
    aud: serviceAccount.tokenUri,
    iat: nowSeconds,
    exp: nowSeconds + 3600,
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
    projectId: serviceAccount.projectId,
    accessToken,
    expiresAt: nowSeconds + expiresIn,
  };

  return {
    accessToken,
    projectId: serviceAccount.projectId,
  };
}

function bytesToHex(bytes) {
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function isLikelyLegacyPbkdf2Hex(hash) {
  return /^[a-f0-9]{128,}$/i.test(normalizeOptionalString(hash, ""));
}

function detectWebPasswordHashType(storedHashRaw) {
  const storedHash = normalizeOptionalString(storedHashRaw, "");
  if (!storedHash) return WEB_HASH_TYPE_PBKDF2;
  if (storedHash.startsWith(`${WEB_HASH_TYPE_PBKDF2}$`)) return WEB_HASH_TYPE_PBKDF2;
  if (storedHash.startsWith("$2a$") || storedHash.startsWith("$2b$") || storedHash.startsWith("$2y$")) {
    return WEB_HASH_TYPE_BCRYPT;
  }
  if (isLikelyLegacyPbkdf2Hex(storedHash)) return WEB_HASH_TYPE_LEGACY_PBKDF2;
  return WEB_HASH_TYPE_PBKDF2;
}

function normalizeWebHashType(input, storedHashRaw = "") {
  const requested = normalizeOptionalString(input, "").toLowerCase();
  if (WEB_ALLOWED_HASH_TYPES.has(requested)) return requested;
  return detectWebPasswordHashType(storedHashRaw);
}

function getBearerToken(request) {
  const authorization = request.headers.get("Authorization") || "";
  const [scheme, token] = authorization.trim().split(/\s+/, 2);
  if (!scheme || !token) return "";
  if (scheme.toLowerCase() !== "bearer") return "";
  return token;
}

function parseCookies(request) {
  const cookieHeader = request.headers.get("Cookie") || "";
  if (!cookieHeader) return {};

  return cookieHeader.split(";").reduce((acc, pair) => {
    const [rawName, ...rawValue] = pair.split("=");
    const name = normalizeOptionalString(rawName, "");
    if (!name) return acc;
    acc[name] = decodeURIComponent(rawValue.join("=") || "");
    return acc;
  }, {});
}

function getWebSessionTokenFromRequest(request) {
  const bearer = getBearerToken(request);
  if (bearer) return bearer;

  const cookies = parseCookies(request);
  return normalizeOptionalString(cookies[WEB_SESSION_COOKIE_NAME], "");
}

function buildWebSessionCookie(token, maxAgeSeconds = WEB_ACCESS_TTL_SECONDS) {
  return `${WEB_SESSION_COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAgeSeconds}`;
}

function buildWebSessionCookieClearHeader() {
  return `${WEB_SESSION_COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
}

function getWebSessionStore(env) {
  if (env.WEB_SESSION_KV && typeof env.WEB_SESSION_KV.get === "function") {
    return env.WEB_SESSION_KV;
  }
  const fallbackKv = getRateLimitKv(env);
  if (fallbackKv) return fallbackKv;
  return null;
}

function buildWebSessionVersionKey(userId) {
  return `web_session_active:${userId}`;
}

async function rotateWebSessionVersion(env, userId) {
  const store = getWebSessionStore(env);
  const nextVersion = nowUnixSeconds();
  if (!store || !Number.isInteger(userId) || userId <= 0) {
    return nextVersion;
  }

  await store.put(buildWebSessionVersionKey(userId), String(nextVersion), {
    expirationTtl: WEB_SESSION_STORE_TTL_SECONDS,
  });
  return nextVersion;
}

async function invalidateWebSessionVersion(env, userId) {
  const store = getWebSessionStore(env);
  if (!store || !Number.isInteger(userId) || userId <= 0) return;

  await store.delete(buildWebSessionVersionKey(userId));
}

async function resolveActiveWebSessionVersion(env, userId) {
  const store = getWebSessionStore(env);
  if (!store || !Number.isInteger(userId) || userId <= 0) return null;

  const raw = await store.get(buildWebSessionVersionKey(userId));
  const parsed = Number.parseInt(String(raw ?? ""), 10);
  if (!Number.isInteger(parsed) || parsed <= 0) return null;
  return parsed;
}

function ensureWebSessionSecret(env) {
  if (!env.WEB_SESSION_SECRET) {
    throw new HttpError(500, "Autenticacion web no configurada. Define WEB_SESSION_SECRET.");
  }
}

function ensureDbBinding(env) {
  if (!env.DB) {
    throw new Error("La base de datos (D1) no esta vinculada a este Worker.");
  }
}

function ensureWebUsersTableAvailable(error) {
  const message = normalizeOptionalString(error?.message, "").toLowerCase();
  if (
    (message.includes("no such table") && message.includes("web_users")) ||
    (message.includes("no such column") && message.includes("password_hash_type")) ||
    (message.includes("no such column") && message.includes("tenant_id"))
  ) {
    throw new HttpError(
      500,
      "Falta esquema de usuarios web en D1. Ejecuta las migraciones (npm run d1:migrate o d1:migrate:remote).",
    );
  }
  throw error;
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

function validateWebUsername(usernameRaw) {
  const username = normalizeWebUsername(usernameRaw);
  if (!WEB_USERNAME_PATTERN.test(username)) {
    throw new HttpError(
      400,
      "Username invalido. Usa 3-64 caracteres: letras, numeros, punto, guion o guion bajo.",
    );
  }
  return username;
}

function validateWebPassword(passwordRaw, fieldName = "password") {
  const password = normalizeOptionalString(passwordRaw, "");
  const errors = [];

  if (password.length < WEB_PASSWORD_MIN_LENGTH) {
    errors.push(`Debe tener al menos ${WEB_PASSWORD_MIN_LENGTH} caracteres.`);
  }
  if (!/[A-Z]/.test(password)) {
    errors.push("Debe contener al menos una letra mayuscula.");
  }
  if (!/[a-z]/.test(password)) {
    errors.push("Debe contener al menos una letra minuscula.");
  }
  if (!/\d/.test(password)) {
    errors.push("Debe contener al menos un numero.");
  }
  if (!containsAnyChar(password, WEB_PASSWORD_SPECIAL_CHARS)) {
    errors.push("Debe contener al menos un caracter especial.");
  }

  if (errors.length > 0) {
    throw new HttpError(400, `Campo '${fieldName}' invalido. ${errors.join(" ")}`);
  }

  return password;
}

function parseWebPasswordHash(storedHash) {
  const [algorithm, iterationsRaw, saltEncoded, keyEncoded] = normalizeOptionalString(
    storedHash,
    "",
  ).split("$", 4);

  const iterations = Number.parseInt(iterationsRaw, 10);
  if (
    algorithm !== WEB_HASH_TYPE_PBKDF2 ||
    !Number.isInteger(iterations) ||
    iterations < 10000 ||
    !saltEncoded ||
    !keyEncoded
  ) {
    return null;
  }

  try {
    return {
      iterations,
      saltBytes: base64UrlToBytes(saltEncoded),
      keyEncoded,
    };
  } catch {
    return null;
  }
}

async function deriveWebPasswordKey(password, saltBytes, iterations, keyLengthBytes = WEB_PASSWORD_KEY_LENGTH_BYTES) {
  if (!globalThis.crypto?.subtle) {
    throw new HttpError(500, "No hay soporte crypto para autenticacion web.");
  }

  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    { name: "PBKDF2" },
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: saltBytes,
      iterations,
    },
    keyMaterial,
    keyLengthBytes * 8,
  );
  return new Uint8Array(bits);
}

async function hashWebPassword(password) {
  if (!globalThis.crypto?.getRandomValues) {
    throw new HttpError(500, "No hay soporte crypto para autenticacion web.");
  }

  const saltBytes = crypto.getRandomValues(new Uint8Array(16));
  const derivedBytes = await deriveWebPasswordKey(
    password,
    saltBytes,
    WEB_PASSWORD_PBKDF2_ITERATIONS,
  );
  return `${WEB_HASH_TYPE_PBKDF2}$${WEB_PASSWORD_PBKDF2_ITERATIONS}$${bytesToBase64Url(saltBytes)}$${bytesToBase64Url(derivedBytes)}`;
}

async function verifyLegacyPbkdf2HexPassword(password, storedHashRaw) {
  const storedHash = normalizeOptionalString(storedHashRaw, "").toLowerCase();
  if (!isLikelyLegacyPbkdf2Hex(storedHash) || storedHash.length < 128) return false;

  const saltText = storedHash.slice(0, 64);
  const expectedKeyHex = storedHash.slice(64);
  const keyLengthBytes = Math.max(1, Math.floor(expectedKeyHex.length / 2));
  const derivedBytes = await deriveWebPasswordKey(
    password,
    new TextEncoder().encode(saltText),
    100000,
    keyLengthBytes,
  );
  const candidateHex = bytesToHex(derivedBytes);
  return timingSafeEqual(candidateHex, expectedKeyHex);
}

async function verifyBcryptPassword(password, storedHashRaw) {
  const storedHash = normalizeOptionalString(storedHashRaw, "");
  if (!storedHash) return false;
  try {
    return await bcrypt.compare(password, storedHash);
  } catch {
    return false;
  }
}

async function verifyWebPassword(password, storedHash, hashTypeRaw = "") {
  const hashType = normalizeWebHashType(hashTypeRaw, storedHash);
  if (hashType === WEB_HASH_TYPE_BCRYPT) {
    return verifyBcryptPassword(password, storedHash);
  }
  if (hashType === WEB_HASH_TYPE_LEGACY_PBKDF2) {
    return verifyLegacyPbkdf2HexPassword(password, storedHash);
  }

  const parsed = parseWebPasswordHash(storedHash);
  if (!parsed) return false;

  const derivedBytes = await deriveWebPasswordKey(password, parsed.saltBytes, parsed.iterations);
  const candidateKey = bytesToBase64Url(derivedBytes);
  return timingSafeEqual(candidateKey, parsed.keyEncoded);
}

function normalizeWebRole(roleRaw) {
  const role = normalizeOptionalString(roleRaw, WEB_DEFAULT_ROLE).toLowerCase();
  if (!["admin", "viewer", "super_admin"].includes(role)) {
    throw new HttpError(400, "Rol web invalido.");
  }
  return role;
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

async function countWebUsers(env) {
  try {
    const { results } = await env.DB.prepare("SELECT COUNT(*) AS total FROM web_users").all();
    return Number(results?.[0]?.total || 0);
  } catch (error) {
    ensureWebUsersTableAvailable(error);
  }
}

async function getWebUserByUsername(env, username) {
  try {
    const { results } = await env.DB.prepare(`
      SELECT id, username, password_hash, password_hash_type, role, is_active, created_at, updated_at, last_login_at, tenant_id
      FROM web_users
      WHERE username = ?
      LIMIT 1
    `)
      .bind(username)
      .all();
    return results?.[0] || null;
  } catch (error) {
    ensureWebUsersTableAvailable(error);
  }
}

async function getWebUserById(env, userId) {
  try {
    const { results } = await env.DB.prepare(`
      SELECT id, username, password_hash, password_hash_type, role, is_active, created_at, updated_at, last_login_at, tenant_id
      FROM web_users
      WHERE id = ?
      LIMIT 1
    `)
      .bind(userId)
      .all();
    return results?.[0] || null;
  } catch (error) {
    ensureWebUsersTableAvailable(error);
  }
}

function serializeWebUser(rawUser) {
  if (!rawUser) return null;
  return {
    id: Number(rawUser.id),
    username: rawUser.username,
    role: normalizeWebRole(rawUser.role || WEB_DEFAULT_ROLE),
    tenant_id: normalizeRealtimeTenantId(rawUser.tenant_id),
    is_active: normalizeActiveFlag(rawUser.is_active, 1) === 1,
    created_at: normalizeOptionalString(rawUser.created_at, ""),
    updated_at: normalizeOptionalString(rawUser.updated_at, ""),
    last_login_at: rawUser.last_login_at || null,
  };
}

async function listWebUsers(env, options = {}) {
  const tenantId = normalizeOptionalString(options?.tenantId, "");
  const limit = Number.isInteger(options?.limit) ? options.limit : 100;
  const cursor = options?.cursor || null;
  const pageSize = limit + 1;
  try {
    let query = `
      SELECT id, username, role, is_active, created_at, updated_at, last_login_at, tenant_id
      FROM web_users
    `;
    const bindings = [];

    if (tenantId) {
      query += " WHERE tenant_id = ?";
      bindings.push(normalizeRealtimeTenantId(tenantId));
    }

    if (cursor) {
      query += tenantId ? " AND " : " WHERE ";
      query += "(username > ? OR (username = ? AND id > ?))";
      bindings.push(cursor.username, cursor.username, cursor.id);
    }

    query += `
      ORDER BY username ASC, id ASC
      LIMIT ?
    `;
    bindings.push(pageSize);

    const queryResult = await env.DB.prepare(query).bind(...bindings).all();
    const rows = queryResult.results || [];
    const hasMore = rows.length > limit;
    const users = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore
      ? buildUsernameIdCursor(users[users.length - 1].username, users[users.length - 1].id)
      : null;

    return {
      users: users.map((row) => serializeWebUser(row)),
      hasMore,
      nextCursor,
    };
  } catch (error) {
    ensureWebUsersTableAvailable(error);
  }
}

async function createWebUser(env, { username, password, role, tenantId }) {
  const createdAt = nowIso();
  const passwordHash = await hashWebPassword(password);
  const passwordHashType = WEB_HASH_TYPE_PBKDF2;
  const normalizedTenantId = normalizeRealtimeTenantId(tenantId);

  try {
    const existing = await getWebUserByUsername(env, username);
    if (existing) {
      throw new HttpError(409, "El usuario web ya existe.");
    }

    const insertResult = await env.DB.prepare(`
      INSERT INTO web_users (username, password_hash, password_hash_type, role, tenant_id, is_active, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 1, ?, ?)
    `)
      .bind(username, passwordHash, passwordHashType, role, normalizedTenantId, createdAt, createdAt)
      .run();

    return {
      id: Number(insertResult?.meta?.last_row_id || 0),
      username,
      password_hash_type: passwordHashType,
      role,
      tenant_id: normalizedTenantId,
      is_active: 1,
      created_at: createdAt,
      updated_at: createdAt,
      last_login_at: null,
    };
  } catch (error) {
    if (error instanceof HttpError) throw error;
    ensureWebUsersTableAvailable(error);
  }
}

function normalizeActiveFlag(value, fallback = 1) {
  if (value === null || value === undefined) return fallback;
  if (typeof value === "boolean") return value ? 1 : 0;
  const normalized = normalizeOptionalString(value, "").toLowerCase();
  if (["1", "true", "yes", "active"].includes(normalized)) return 1;
  if (["0", "false", "no", "inactive"].includes(normalized)) return 0;
  return fallback;
}

function normalizeImportedWebUser(rawUser) {
  if (!rawUser || typeof rawUser !== "object") {
    throw new HttpError(400, "Usuario importado invalido.");
  }

  const username = validateWebUsername(rawUser.username);
  const passwordHash = normalizeOptionalString(rawUser.password_hash, "");
  if (!passwordHash) {
    throw new HttpError(400, `Usuario '${username}' sin password_hash.`);
  }

  const passwordHashType = normalizeWebHashType(rawUser.password_hash_type, passwordHash);
  if (!WEB_ALLOWED_HASH_TYPES.has(passwordHashType)) {
    throw new HttpError(400, `Tipo de hash invalido para '${username}'.`);
  }

  return {
    username,
    passwordHash,
    passwordHashType,
    role: normalizeWebRole(rawUser.role || WEB_DEFAULT_ROLE),
    isActive: normalizeActiveFlag(rawUser.is_active, 1),
    tenantId: normalizeRealtimeTenantId(rawUser.tenant_id),
  };
}

async function upsertWebUserFromImport(env, importedUser) {
  const existing = await getWebUserByUsername(env, importedUser.username);
  const now = nowIso();

  if (existing) {
    await env.DB.prepare(`
      UPDATE web_users
      SET password_hash = ?, password_hash_type = ?, role = ?, tenant_id = ?, is_active = ?, updated_at = ?
      WHERE id = ?
    `)
      .bind(
        importedUser.passwordHash,
        importedUser.passwordHashType,
        importedUser.role,
        importedUser.tenantId,
        importedUser.isActive,
        now,
        Number(existing.id),
      )
      .run();

    return "updated";
  }

  await env.DB.prepare(`
    INSERT INTO web_users (username, password_hash, password_hash_type, role, tenant_id, is_active, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `)
    .bind(
      importedUser.username,
      importedUser.passwordHash,
      importedUser.passwordHashType,
      importedUser.role,
      importedUser.tenantId,
      importedUser.isActive,
      now,
      now,
    )
    .run();
  return "created";
}

async function touchWebUserLastLogin(env, userId) {
  const now = nowIso();
  try {
    await env.DB.prepare(`
      UPDATE web_users
      SET last_login_at = ?, updated_at = ?
      WHERE id = ?
    `)
      .bind(now, now, userId)
      .run();
  } catch (error) {
    ensureWebUsersTableAvailable(error);
  }
}

async function migrateWebUserPasswordHashToPbkdf2(env, { userId, password }) {
  const now = nowIso();
  const passwordHash = await hashWebPassword(password);
  try {
    await env.DB.prepare(`
      UPDATE web_users
      SET password_hash = ?, password_hash_type = ?, updated_at = ?
      WHERE id = ?
    `)
      .bind(passwordHash, WEB_HASH_TYPE_PBKDF2, now, userId)
      .run();
  } catch (error) {
    ensureWebUsersTableAvailable(error);
  }
}

async function updateWebUserRoleAndStatus(env, { userId, role, isActive }) {
  const now = nowIso();
  try {
    await env.DB.prepare(`
      UPDATE web_users
      SET role = ?, is_active = ?, updated_at = ?
      WHERE id = ?
    `)
      .bind(role, isActive, now, userId)
      .run();
  } catch (error) {
    ensureWebUsersTableAvailable(error);
  }
}

async function forceResetWebUserPassword(env, { userId, newPassword }) {
  const now = nowIso();
  const passwordHash = await hashWebPassword(newPassword);
  const passwordHashType = WEB_HASH_TYPE_PBKDF2;

  try {
    await env.DB.prepare(`
      UPDATE web_users
      SET password_hash = ?, password_hash_type = ?, updated_at = ?
      WHERE id = ?
    `)
      .bind(passwordHash, passwordHashType, now, userId)
      .run();
  } catch (error) {
    ensureWebUsersTableAvailable(error);
  }
}

async function buildWebAccessToken(env, sessionUser = {}) {
  ensureWebSessionSecret(env);

  const iat = nowUnixSeconds();
  const exp = iat + WEB_ACCESS_TTL_SECONDS;
  const sub = normalizeWebUsername(sessionUser.username || "web-user") || "web-user";
  const role = normalizeOptionalString(sessionUser.role, WEB_DEFAULT_ROLE) || WEB_DEFAULT_ROLE;
  const payload = {
    scope: "web",
    sub,
    role,
    iat,
    exp,
  };

  if (Number.isInteger(sessionUser.user_id) && sessionUser.user_id > 0) {
    payload.user_id = sessionUser.user_id;
  }
  if (Number.isInteger(sessionUser.session_version) && sessionUser.session_version > 0) {
    payload.sv = sessionUser.session_version;
  }
  if (normalizeOptionalString(sessionUser.tenant_id, "")) {
    payload.tenant_id = normalizeRealtimeTenantId(sessionUser.tenant_id);
  }

  const encodedPayload = base64UrlEncodeUtf8(JSON.stringify(payload));
  const signature = await hmacSha256Hex(env.WEB_SESSION_SECRET, encodedPayload);

  return {
    token: `${encodedPayload}.${signature}`,
    expires_in: WEB_ACCESS_TTL_SECONDS,
    expires_at: new Date(exp * 1000).toISOString(),
    sub,
    role,
    tenant_id: payload.tenant_id || DEFAULT_REALTIME_TENANT_ID,
  };
}

async function verifyWebAccessToken(request, env) {
  ensureWebSessionSecret(env);

  const token = getWebSessionTokenFromRequest(request);
  if (!token) {
    throw new HttpError(401, "Falta token Bearer o cookie de sesion web.");
  }

  const [encodedPayload, signature] = token.split(".", 2);
  if (!encodedPayload || !signature) {
    throw new HttpError(401, "Token web invalido.");
  }

  const expectedSignature = await hmacSha256Hex(env.WEB_SESSION_SECRET, encodedPayload);
  if (!timingSafeEqual(signature.toLowerCase(), expectedSignature.toLowerCase())) {
    throw new HttpError(401, "Token web invalido.");
  }

  let payload = null;
  try {
    payload = JSON.parse(base64UrlDecodeUtf8(encodedPayload));
  } catch {
    throw new HttpError(401, "Token web invalido.");
  }

  if (!payload || payload.scope !== "web") {
    throw new HttpError(401, "Token web invalido.");
  }

  const exp = Number(payload.exp);
  if (!Number.isInteger(exp) || exp <= nowUnixSeconds()) {
    throw new HttpError(401, "Sesion web expirada.");
  }

  const userId = Number.isInteger(payload.user_id) ? payload.user_id : null;
  const tokenSessionVersion = Number(payload.sv || 0);
  if (
    getWebSessionStore(env) &&
    userId &&
    Number.isInteger(tokenSessionVersion) &&
    tokenSessionVersion > 0
  ) {
    const activeSessionVersion = await resolveActiveWebSessionVersion(env, userId);
    if (!activeSessionVersion || activeSessionVersion !== tokenSessionVersion) {
      throw new HttpError(401, "Sesion web invalida o cerrada.");
    }
  }

  return {
    scope: "web",
    sub: normalizeWebUsername(payload.sub || payload.username || "web-user") || "web-user",
    role: normalizeOptionalString(payload.role, WEB_DEFAULT_ROLE) || WEB_DEFAULT_ROLE,
    tenant_id: normalizeRealtimeTenantId(payload.tenant_id),
    user_id: userId,
    session_version: Number.isInteger(tokenSessionVersion) ? tokenSessionVersion : null,
    iat: Number(payload.iat || 0),
    exp,
  };
}

async function authenticateWebUserByCredentials(env, { username, password }) {
  const user = await getWebUserByUsername(env, username);
  if (!user) {
    throw new HttpError(401, "Credenciales web invalidas.");
  }
  if (!user.is_active) {
    throw new HttpError(403, "Usuario web inactivo.");
  }

  const hashType = normalizeWebHashType(user.password_hash_type, user.password_hash);
  const validPassword = await verifyWebPassword(
    password,
    user.password_hash,
    hashType,
  );
  if (!validPassword) {
    throw new HttpError(401, "Credenciales web invalidas.");
  }

  // Migrar hashes legacy bcrypt a PBKDF2 al primer login exitoso.
  if (hashType === WEB_HASH_TYPE_BCRYPT) {
    await migrateWebUserPasswordHashToPbkdf2(env, {
      userId: Number(user.id),
      password,
    });
    user.password_hash_type = WEB_HASH_TYPE_PBKDF2;
  }

  await touchWebUserLastLogin(env, Number(user.id));
  return user;
}

async function upsertDeviceTokenForWebUser(
  env,
  { userId, fcmToken, deviceModel = "", appVersion = "", platform = "android" },
) {
  const registeredAt = nowIso();
  try {
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
  } catch (error) {
    ensureDeviceTokensTableAvailable(error);
  }
}

async function listDeviceTokensForWebRoles(env, roles = []) {
  const normalizedRoles = (roles || [])
    .map((role) => normalizeOptionalString(role, "").toLowerCase())
    .filter((role) => role);
  if (!normalizedRoles.length) return [];

  const placeholders = normalizedRoles.map(() => "?").join(", ");

  try {
    const { results } = await env.DB.prepare(`
      SELECT DISTINCT dt.fcm_token
      FROM device_tokens dt
      INNER JOIN web_users wu ON wu.id = dt.user_id
      WHERE wu.is_active = 1
        AND wu.role IN (${placeholders})
        AND NULLIF(TRIM(dt.fcm_token), '') IS NOT NULL
    `)
      .bind(...normalizedRoles)
      .all();

    return (results || [])
      .map((row) => normalizeOptionalString(row?.fcm_token, ""))
      .filter((token) => token);
  } catch (error) {
    const message = normalizeOptionalString(error?.message, "").toLowerCase();
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

async function handleWebAuthRoute(request, env, pathParts, corsPolicy) {
  if (pathParts.length < 2 || pathParts[0] !== "auth") {
    return null;
  }

  if (pathParts[1] === "login" && request.method === "POST") {
    ensureWebSessionSecret(env);

    let body = {};
    try {
      body = await request.json();
    } catch {
      throw new HttpError(400, "Payload invalido.");
    }

    const providedPassword = normalizeOptionalString(body?.password, "");
    if (!providedPassword) {
      throw new HttpError(400, "Campo 'password' es obligatorio.");
    }

    const providedUsername = normalizeWebUsername(body?.username);
    if (!providedUsername) {
      throw new HttpError(400, "Campo 'username' es obligatorio.");
    }

    const username = validateWebUsername(providedUsername);
    const rateLimitIdentifier = buildWebLoginRateLimitIdentifier(request, username);

    ensureDbBinding(env);
    await checkWebLoginRateLimit(env, rateLimitIdentifier);

    let user = null;
    try {
      user = await authenticateWebUserByCredentials(env, {
        username,
        password: providedPassword,
      });
    } catch (error) {
      if (error instanceof HttpError && (error.status === 401 || error.status === 403)) {
        await recordFailedWebLoginAttempt(env, rateLimitIdentifier);
        
        // Log audit event for failed login
        await logAuditEvent(env, {
          action: "web_login_failed",
          username: username,
          success: false,
          details: {
            reason: error.message,
            status_code: error.status
          },
          ipAddress: getClientIpForRateLimit(request),
          platform: "web"
        });
      }
      throw error;
    }

    await clearWebLoginRateLimit(env, rateLimitIdentifier);
    
    // Log audit event for successful login
    await logAuditEvent(env, {
      action: "web_login_success",
      username: user.username,
      success: true,
      details: {
        role: user.role,
        user_id: Number(user.id)
      },
      ipAddress: getClientIpForRateLimit(request),
      platform: "web"
    });
    
    const sessionVersion = await rotateWebSessionVersion(env, Number(user.id));
    const token = await buildWebAccessToken(env, {
      username: user.username,
      role: user.role,
      user_id: Number(user.id),
      session_version: sessionVersion,
      tenant_id: user.tenant_id,
    });

    const response = jsonResponse(
      request,
      env,
      corsPolicy,
      {
        success: true,
        access_token: token.token,
        token_type: "Bearer",
        expires_in: token.expires_in,
        expires_at: token.expires_at,
        user: {
          id: Number(user.id),
          username: user.username,
          role: user.role,
          tenant_id: normalizeRealtimeTenantId(user.tenant_id),
        },
      },
      200,
    );
    response.headers.append("Set-Cookie", buildWebSessionCookie(token.token, token.expires_in));
    return response;
  }

  if (pathParts[1] === "bootstrap" && request.method === "POST") {
    ensureDbBinding(env);

    if (!env.WEB_LOGIN_PASSWORD) {
      throw new HttpError(
        500,
        "Bootstrap no configurado. Define WEB_LOGIN_PASSWORD para inicializar el primer usuario web.",
      );
    }

    let body = {};
    try {
      body = await request.json();
    } catch {
      throw new HttpError(400, "Payload invalido.");
    }

    const bootstrapPassword = normalizeOptionalString(body?.bootstrap_password, "");
    if (!bootstrapPassword) {
      throw new HttpError(400, "Campo 'bootstrap_password' es obligatorio.");
    }
    if (!timingSafeEqual(bootstrapPassword, String(env.WEB_LOGIN_PASSWORD))) {
      throw new HttpError(401, "Bootstrap password invalido.");
    }

    const userCount = await countWebUsers(env);
    if (userCount > 0) {
      throw new HttpError(409, "Bootstrap ya ejecutado. La tabla web_users ya tiene usuarios.");
    }

    const username = validateWebUsername(body?.username);
    const password = validateWebPassword(body?.password);
    const role = normalizeWebRole(body?.role || WEB_DEFAULT_ROLE);
    const tenantId = normalizeRealtimeTenantId(body?.tenant_id);
    const createdUser = await createWebUser(env, { username, password, role, tenantId });

    const sessionVersion = await rotateWebSessionVersion(env, Number(createdUser.id));
    const token = await buildWebAccessToken(env, {
      username: createdUser.username,
      role: createdUser.role,
      user_id: Number(createdUser.id),
      session_version: sessionVersion,
      tenant_id: createdUser.tenant_id,
    });

    const response = jsonResponse(
      request,
      env,
      corsPolicy,
      {
        success: true,
        bootstrapped: true,
        user: {
          id: createdUser.id,
          username: createdUser.username,
          role: createdUser.role,
          tenant_id: createdUser.tenant_id,
        },
        access_token: token.token,
        token_type: "Bearer",
        expires_in: token.expires_in,
        expires_at: token.expires_at,
      },
      201,
    );
    response.headers.append("Set-Cookie", buildWebSessionCookie(token.token, token.expires_in));
    return response;
  }

  if (pathParts[1] === "users" && pathParts.length === 2 && request.method === "GET") {
    ensureDbBinding(env);

    const session = await verifyWebAccessToken(request, env);
    requireAdminRole(session.role);
    const searchParams = new URL(request.url).searchParams;

    const requestTenantFilter = normalizeOptionalString(
      searchParams.get("tenant_id"),
      "",
    );
    const limit = parsePageLimit(searchParams, { fallback: 100, max: 500 });
    const cursor = parseUsernameIdCursor(searchParams.get("cursor"));
    const usersPage = await listWebUsers(env, {
      tenantId: canManageAllTenants(session.role)
        ? requestTenantFilter || null
        : normalizeRealtimeTenantId(session.tenant_id),
      limit,
      cursor,
    });
    return jsonResponse(request, env, corsPolicy,
      {
        success: true,
        users: usersPage.users,
        pagination: {
          limit,
          has_more: usersPage.hasMore,
          next_cursor: usersPage.nextCursor,
        },
      },
      200,
    );
  }

  if (pathParts[1] === "users" && pathParts.length === 2 && request.method === "POST") {
    ensureDbBinding(env);

    const session = await verifyWebAccessToken(request, env);
    requireAdminRole(session.role);

    let body = {};
    try {
      body = await request.json();
    } catch {
      throw new HttpError(400, "Payload invalido.");
    }

    const username = validateWebUsername(body?.username);
    const password = validateWebPassword(body?.password);
    const role = normalizeWebRole(body?.role || "viewer");
    const sessionTenantId = normalizeRealtimeTenantId(session.tenant_id);
    const requestedTenantId = normalizeOptionalString(body?.tenant_id, "");
    const targetTenantId = requestedTenantId
      ? normalizeRealtimeTenantId(requestedTenantId)
      : sessionTenantId;
    assertSameTenantOrSuperAdmin(session, targetTenantId);

    const createdUser = await createWebUser(env, {
      username,
      password,
      role,
      tenantId: targetTenantId,
    });

    // Log audit event for user creation
    await logAuditEvent(env, {
      action: "web_user_created",
      username: session.sub,
      success: true,
      details: {
        created_user: createdUser.username,
        created_user_id: createdUser.id,
        created_role: createdUser.role,
        performed_by: session.sub,
        performed_by_role: session.role
      },
      ipAddress: getClientIpForRateLimit(request),
      platform: "web"
    });

    return jsonResponse(request, env, corsPolicy,
      {
        success: true,
        user: {
          id: createdUser.id,
          username: createdUser.username,
          role: createdUser.role,
          tenant_id: createdUser.tenant_id,
        },
      },
      201,
    );
  }

  if (pathParts[1] === "users" && pathParts.length === 3 && request.method === "PATCH") {
    ensureDbBinding(env);

    const session = await verifyWebAccessToken(request, env);
    requireAdminRole(session.role);

    const userId = parsePositiveInt(pathParts[2], "user_id");
    const existingUser = await getWebUserById(env, userId);
    if (!existingUser) {
      throw new HttpError(404, "Usuario web no encontrado.");
    }
    assertSameTenantOrSuperAdmin(session, existingUser.tenant_id);

    let body = {};
    try {
      body = await request.json();
    } catch {
      throw new HttpError(400, "Payload invalido.");
    }

    const requestedRole = body?.role === undefined ? null : normalizeWebRole(body.role);
    const requestedActive = parseBooleanOrNull(body?.is_active);
    if (requestedRole === null && requestedActive === null) {
      throw new HttpError(400, "Debes enviar al menos uno de: role, is_active.");
    }

    const nextRole = requestedRole === null ? existingUser.role : requestedRole;
    const nextIsActive =
      requestedActive === null ? normalizeActiveFlag(existingUser.is_active, 1) : requestedActive ? 1 : 0;

    if (session.user_id && Number(session.user_id) === userId && nextIsActive === 0) {
      throw new HttpError(400, "No puedes desactivar tu propio usuario.");
    }
    if (
      session.user_id &&
      Number(session.user_id) === userId &&
      !["admin", "super_admin"].includes(nextRole)
    ) {
      throw new HttpError(400, "No puedes quitarte permisos de administrador.");
    }

    await updateWebUserRoleAndStatus(env, {
      userId,
      role: nextRole,
      isActive: nextIsActive,
    });

    // Log audit event for user update
    await logAuditEvent(env, {
      action: "web_user_updated",
      username: session.sub,
      success: true,
      details: {
        updated_user_id: userId,
        updated_user: existingUser.username,
        old_role: existingUser.role,
        new_role: nextRole,
        old_active: Boolean(existingUser.is_active),
        new_active: Boolean(nextIsActive),
        performed_by: session.sub,
        performed_by_role: session.role
      },
      ipAddress: getClientIpForRateLimit(request),
      platform: "web"
    });

    const updatedUser = await getWebUserById(env, userId);
    return jsonResponse(request, env, corsPolicy,
      {
        success: true,
        user: serializeWebUser(updatedUser),
      },
      200,
    );
  }

  if (
    pathParts[1] === "users" &&
    pathParts.length === 4 &&
    pathParts[3] === "force-password" &&
    request.method === "POST"
  ) {
    ensureDbBinding(env);

    const session = await verifyWebAccessToken(request, env);
    requireAdminRole(session.role);

    const userId = parsePositiveInt(pathParts[2], "user_id");
    const existingUser = await getWebUserById(env, userId);
    if (!existingUser) {
      throw new HttpError(404, "Usuario web no encontrado.");
    }
    assertSameTenantOrSuperAdmin(session, existingUser.tenant_id);

    let body = {};
    try {
      body = await request.json();
    } catch {
      throw new HttpError(400, "Payload invalido.");
    }

    const newPassword = validateWebPassword(body?.new_password, "new_password");
    await forceResetWebUserPassword(env, { userId, newPassword });

    // Log audit event for password reset
    await logAuditEvent(env, {
      action: "web_password_reset",
      username: session.sub,
      success: true,
      details: {
        target_user_id: userId,
        target_user: existingUser.username,
        performed_by: session.sub,
        performed_by_role: session.role
      },
      ipAddress: getClientIpForRateLimit(request),
      platform: "web"
    });

    const updatedUser = await getWebUserById(env, userId);
    return jsonResponse(request, env, corsPolicy,
      {
        success: true,
        user: serializeWebUser(updatedUser),
      },
      200,
    );
  }

  if (pathParts[1] === "import-users" && request.method === "POST") {
    ensureDbBinding(env);

    const session = await verifyWebAccessToken(request, env);
    if (!["admin", "super_admin"].includes(session.role)) {
      throw new HttpError(403, "No tienes permisos para importar usuarios web.");
    }

    let body = {};
    try {
      body = await request.json();
    } catch {
      throw new HttpError(400, "Payload invalido.");
    }

    const users = Array.isArray(body?.users) ? body.users : [];
    if (!users.length) {
      throw new HttpError(400, "Debes enviar al menos un usuario en 'users'.");
    }
    if (users.length > 1000) {
      throw new HttpError(400, "El lote supera el maximo permitido (1000 usuarios).");
    }

    let created = 0;
    let updated = 0;
    const sessionTenantId = normalizeRealtimeTenantId(session.tenant_id);
    const processedUsers = [];
    for (const rawUser of users) {
      const imported = normalizeImportedWebUser(rawUser);
      const targetTenantId = imported.tenantId || sessionTenantId;
      assertSameTenantOrSuperAdmin(session, targetTenantId);
      imported.tenantId = normalizeRealtimeTenantId(targetTenantId);
      const result = await upsertWebUserFromImport(env, imported);
      if (result === "created") created += 1;
      if (result === "updated") updated += 1;
      processedUsers.push({
        username: imported.username,
        role: imported.role,
        tenant_id: imported.tenantId,
        is_active: imported.isActive,
        password_hash_type: imported.passwordHashType,
      });
    }

    // Log audit event for user import
    await logAuditEvent(env, {
      action: "web_users_imported",
      username: session.sub,
      success: true,
      details: {
        total_imported: processedUsers.length,
        created,
        updated,
        performed_by: session.sub,
        performed_by_role: session.role
      },
      ipAddress: getClientIpForRateLimit(request),
      platform: "web"
    });

    return jsonResponse(request, env, corsPolicy,
      {
        success: true,
        imported: processedUsers.length,
        created,
        updated,
        users: processedUsers,
      },
      200,
    );
  }

  if (pathParts[1] === "logout" && request.method === "POST") {
    const payload = await verifyWebAccessToken(request, env);
    if (payload.user_id) {
      await invalidateWebSessionVersion(env, Number(payload.user_id));
    }

    const response = jsonResponse(request, env, corsPolicy, {
      success: true,
      logged_out: true,
    });
    response.headers.append("Set-Cookie", buildWebSessionCookieClearHeader());
    return response;
  }

  if (pathParts[1] === "me" && request.method === "GET") {
    const payload = await verifyWebAccessToken(request, env);
    return jsonResponse(request, env, corsPolicy,{
      success: true,
      authenticated: true,
      scope: payload.scope,
      username: payload.sub,
      role: payload.role,
      tenant_id: normalizeRealtimeTenantId(payload.tenant_id),
      expires_at: new Date(Number(payload.exp) * 1000).toISOString(),
    });
  }

  return null;
}

async function verifyAuth(request, env, url) {
  const clientPlatform = (request.headers.get("X-Client-Platform") || "").toLowerCase();
  if (clientPlatform === "mobile") {
    throw new HttpError(
      410,
      "Autenticacion HMAC deshabilitada para clientes moviles. Usa /web/* con Bearer de sesion corta.",
    );
  }

  const expectedToken = env.DRIVER_MANAGER_API_TOKEN || env.API_TOKEN;
  const expectedSecret = env.DRIVER_MANAGER_API_SECRET || env.API_SECRET;

  // Nunca permitir acceso sin credenciales de API configuradas.
  if (!expectedToken || !expectedSecret) {
    throw new HttpError(
      503,
      "API no configurada correctamente. Define DRIVER_MANAGER_API_TOKEN y DRIVER_MANAGER_API_SECRET.",
    );
  }

  const token = request.headers.get("X-API-Token");
  const timestampRaw = request.headers.get("X-Request-Timestamp");
  const signature = request.headers.get("X-Request-Signature");

  if (!token || !timestampRaw || !signature) {
    throw new HttpError(401, "Faltan headers de autenticaciÃ³n.");
  }

  if (!timingSafeEqual(token, expectedToken)) {
    throw new HttpError(401, "Token invÃ¡lido.");
  }

  const timestamp = Number.parseInt(timestampRaw, 10);
  if (!Number.isInteger(timestamp)) {
    throw new HttpError(401, "Timestamp invÃ¡lido.");
  }

  const drift = Math.abs(nowUnixSeconds() - timestamp);
  if (drift > AUTH_WINDOW_SECONDS) {
    throw new HttpError(401, "Timestamp fuera de ventana permitida.");
  }

  const bodyBytes = await request.clone().arrayBuffer();
  const bodyHash = (await sha256Hex(bodyBytes)) || "";
  const canonical = `${request.method.toUpperCase()}|${url.pathname}|${timestamp}|${bodyHash}`;
  const expectedSignature = await hmacSha256Hex(expectedSecret, canonical);

  if (!timingSafeEqual(signature.toLowerCase(), expectedSignature.toLowerCase())) {
    throw new HttpError(401, "Firma invÃ¡lida.");
  }
}

function buildIncidentR2Key(installationId, incidentId, extension) {
  const timestamp = nowIso().replace(/[-:.TZ]/g, "");
  const randomPart = Math.random().toString(36).slice(2, 10);
  return `incidents/${installationId}/${incidentId}/${timestamp}_${randomPart}.${extension}`;
}

function validateIncidentPayload(data, options = {}) {
  if (!data || typeof data !== "object") {
    throw new HttpError(400, "Payload invÃ¡lido.");
  }

  const note = typeof data.note === "string" ? data.note.trim() : "";
  if (!note) {
    throw new HttpError(400, "Campo 'note' es obligatorio.");
  }
  if (note.length > 5000) {
    throw new HttpError(400, "Campo 'note' supera el lÃ­mite permitido.");
  }

  const timeAdjustment =
    data.time_adjustment_seconds === undefined ? 0 : Number(data.time_adjustment_seconds);
  if (!Number.isInteger(timeAdjustment) || timeAdjustment < -86400 || timeAdjustment > 86400) {
    throw new HttpError(400, "Campo 'time_adjustment_seconds' invÃ¡lido.");
  }

  const severity = data.severity || "medium";
  if (!["low", "medium", "high", "critical"].includes(severity)) {
    throw new HttpError(400, "Campo 'severity' invÃ¡lido.");
  }

  const source = data.source || options.defaultSource || "mobile";
  if (!["desktop", "mobile", "web"].includes(source)) {
    throw new HttpError(400, "Campo 'source' invÃ¡lido.");
  }

  return {
    note,
    timeAdjustment,
    severity,
    source,
    applyToInstallation: Boolean(data.apply_to_installation),
    reporterUsername: normalizeOptionalString(
      data.reporter_username || data.username,
      normalizeOptionalString(options.defaultReporterUsername, "unknown"),
    ),
  };
}

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
      if (routeParts.length === 0 && request.method === "GET") {
        return jsonResponse(request, env, corsPolicy,{
          service: "driver-manager-api",
          status: "ok",
          docs: {
            health: "/health",
            web_login: "/web/auth/login",
            web_bootstrap: "/web/auth/bootstrap",
            web_users: "/web/auth/users",
            web_user_update: "/web/auth/users/:user_id",
            web_user_force_password: "/web/auth/users/:user_id/force-password",
            web_import_users: "/web/auth/import-users",
            installations: "/installations",
            web_installations: "/web/installations",
            web_devices: "/web/devices",
            web_lookup: "/web/lookup?type=asset&code=EQ-123",
            audit_logs: "/audit-logs",
            web_audit_logs: "/web/audit-logs",
          },
        });
      }

      if (routeParts.length === 1 && routeParts[0] === "health" && request.method === "GET") {
        return jsonResponse(request, env, corsPolicy,{ ok: true, now: nowIso() });
      }

      const dashboardAssetResponse = await serveDashboardStaticAsset(request, env, corsPolicy, routeParts);
      if (dashboardAssetResponse) {
        return dashboardAssetResponse;
      }

      // SSE endpoint for real-time updates
      if (routeParts.length === 1 && routeParts[0] === "events" && request.method === "GET") {
        // Verify authentication
        let sseWebSession = null;
        try {
          sseWebSession = await verifyWebAccessToken(request, env);
        } catch (err) {
          return jsonResponse(request, env, corsPolicy,{ error: "Unauthorized" }, 401);
        }
        const sseTenantId = resolveRealtimeTenantId(request, sseWebSession);

        const brokerStreamResponse = await connectRealtimeBrokerStream(
          request,
          env,
          corsPolicy,
          sseTenantId,
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
              message: "Conexión en tiempo real establecida",
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
              pollAndEmit().catch(() => {});
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
                    message: "Reconexión requerida",
                    timestamp: nowIso()
                  });
                  controller.close();
                } catch {}
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
      if (isWebRoute) {
        const webAuthResponse = await handleWebAuthRoute(request, env, routeParts, corsPolicy);
        if (webAuthResponse) {
          return webAuthResponse;
        }
      }

      if (!env.DB) {
        throw new Error("La base de datos (D1) no esta vinculada a este Worker.");
      }

      let webSession = null;
      if (isWebRoute) {
        webSession = await verifyWebAccessToken(request, env);
      } else {
        await verifyAuth(request, env, url);
      }
      const realtimeTenantId = resolveRealtimeTenantId(request, webSession);


      if (routeParts.length === 1 && routeParts[0] === "lookup" && request.method === "GET") {
        const requestedType = normalizeOptionalString(url.searchParams.get("type"), "").toLowerCase();
        const code = normalizeOptionalString(url.searchParams.get("code"), "").trim();

        if (!code) {
          throw new HttpError(400, "Parametro 'code' es obligatorio.");
        }

        if (requestedType && requestedType !== "installation" && requestedType !== "asset") {
          throw new HttpError(400, "Parametro 'type' invalido. Usa installation o asset.");
        }

        const normalizedCode = code.toLowerCase();

        if (requestedType === "installation") {
          const asNumber = Number.parseInt(code, 10);
          if (!Number.isInteger(asNumber) || asNumber <= 0) {
            throw new HttpError(400, "Codigo de instalacion invalido.");
          }

          const { results } = await env.DB.prepare(`
            SELECT id, timestamp, status, client_name, driver_brand, driver_version
            FROM installations
            WHERE id = ?
            LIMIT 1
          `)
            .bind(asNumber)
            .all();

          if (!results?.[0]) {
            throw new HttpError(404, "Instalacion no encontrada.");
          }

          return jsonResponse(request, env, corsPolicy, {
            success: true,
            match: {
              type: "installation",
              installation_id: results[0].id,
            },
          });
        }

        const wildcard = `%${code}%`;
        const { results: installationMatches } = await env.DB.prepare(`
          SELECT id
          FROM installations
          WHERE LOWER(client_name) = ?
             OR LOWER(driver_description) = ?
             OR LOWER(notes) = ?
             OR client_name LIKE ?
             OR driver_description LIKE ?
             OR notes LIKE ?
          ORDER BY id DESC
          LIMIT 1
        `)
          .bind(
            normalizedCode,
            normalizedCode,
            normalizedCode,
            wildcard,
            wildcard,
            wildcard,
          )
          .all();

        const installationId = installationMatches?.[0]?.id || null;

        return jsonResponse(request, env, corsPolicy, {
          success: true,
          match: {
            type: "asset",
            asset_id: code,
            external_code: code,
            installation_id: installationId,
          },
        });
      }

      if (routeParts.length === 1 && routeParts[0] === "installations") {
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

          let query = "SELECT * FROM installations WHERE 1 = 1";
          const bindings = [];

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

          const response = jsonResponse(request, env, corsPolicy, items);
          appendPaginationHeader(response, nextCursor);
          return response;
        }

        if (request.method === "POST") {
          const data = await readJsonOrThrowBadRequest(request);
          const payload = normalizeInstallationPayload(data, "unknown");

          const insertResult = await env.DB.prepare(`
            INSERT INTO installations (timestamp, driver_brand, driver_version, status, client_name, driver_description, installation_time_seconds, os_info, notes)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
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
            )
            .run();
          const installationId = insertResult?.meta?.last_row_id || null;
          const installationEventPayload = {
            id: installationId,
            ...payload,
          };

          // Log audit event for installation creation
          await logAuditEvent(env, {
            action: "installation_created",
            username: webSession?.sub || "api",
            success: true,
            details: {
              driver_brand: payload.driver_brand,
              driver_version: payload.driver_version,
              status: payload.status,
              client_name: payload.client_name
            },
            ipAddress: getClientIpForRateLimit(request),
            platform: isWebRoute ? "web" : "api"
          });

          await publishRealtimeEvent(env, {
            type: "installation_created",
            installation: installationEventPayload,
          }, realtimeTenantId);
          await publishRealtimeStatsUpdate(env, realtimeTenantId);

          return jsonResponse(request, env, corsPolicy,{ success: true }, 201);
        }
      }

      if (routeParts.length === 1 && routeParts[0] === "audit-logs") {
        if (request.method === "POST") {
          const data = await request.json();

          const action = normalizeOptionalString(data?.action, "");
          const username = normalizeOptionalString(data?.username, "");

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
              details: rawDetails,
              computerName: data?.computer_name,
              ipAddress: data?.ip_address,
              platform: data?.platform,
            },
            { swallowErrors: false },
          );

          return jsonResponse(request, env, corsPolicy,{ success: true }, 201);

        }

        if (request.method === "GET") {
          const limit = parsePageLimit(url.searchParams, { fallback: 100, max: 500 });
          const cursor = parseTimestampIdCursor(url.searchParams.get("cursor"));
          const pageSize = limit + 1;

          let query = `
            SELECT id, timestamp, action, username, success, details, computer_name, ip_address, platform
            FROM audit_logs
          `;
          const bindings = [];
          if (cursor) {
            query += " WHERE (timestamp < ? OR (timestamp = ? AND id < ?))";
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

      if (routeParts.length === 1 && routeParts[0] === "devices" && request.method === "POST") {
        if (!isWebRoute || !webSession?.user_id) {
          throw new HttpError(401, "Registro de dispositivos requiere token Bearer web.");
        }

        let data = {};
        try {
          data = await request.json();
        } catch {
          throw new HttpError(400, "Payload invalido.");
        }

        const fcmToken = normalizeFcmToken(data?.fcm_token);
        await upsertDeviceTokenForWebUser(env, {
          userId: Number(webSession.user_id),
          fcmToken,
          deviceModel: data?.device_model,
          appVersion: data?.app_version,
          platform: data?.platform || "android",
        });

        return jsonResponse(request, env, corsPolicy,
          {
            success: true,
            registered: true,
          },
          200,
        );
      }

      if (routeParts.length === 1 && routeParts[0] === "records" && request.method === "POST") {
        const data = await readJsonOrThrowBadRequest(request);
        const payload = normalizeInstallationPayload(data, "manual");

        if (!payload.driver_brand) payload.driver_brand = "N/A";
        if (!payload.driver_version) payload.driver_version = "N/A";
        if (!payload.driver_description) payload.driver_description = "Registro manual";
        if (!payload.client_name) payload.client_name = "Sin cliente";
        if (!payload.os_info) payload.os_info = "manual";

        const insertResult = await env.DB.prepare(`
          INSERT INTO installations (timestamp, driver_brand, driver_version, status, client_name, driver_description, installation_time_seconds, os_info, notes)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
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
          )
          .run();
        const record = {
          id: insertResult?.meta?.last_row_id || null,
          ...payload,
        };

        await publishRealtimeEvent(env, {
          type: "installation_created",
          installation: record,
        }, realtimeTenantId);
        await publishRealtimeStatsUpdate(env, realtimeTenantId);

        return jsonResponse(request, env, corsPolicy,
          {
            success: true,
            record,
          },
          201,
        );
      }

      if (
        routeParts.length === 3 &&
        routeParts[0] === "installations" &&
        routeParts[2] === "incidents"
      ) {
        const installationId = parsePositiveInt(routeParts[1], "installation_id");

        if (request.method === "GET") {
          const { results: incidents } = await env.DB.prepare(`
            SELECT id, installation_id, reporter_username, note, time_adjustment_seconds, severity, source, created_at
            FROM incidents
            WHERE installation_id = ?
            ORDER BY created_at DESC, id DESC
          `)
            .bind(installationId)
            .all();

          const { results: photos } = await env.DB.prepare(`
            SELECT p.id, p.incident_id, p.r2_key, p.file_name, p.content_type, p.size_bytes, p.sha256, p.created_at
            FROM incident_photos p
            INNER JOIN incidents i ON i.id = p.incident_id
            WHERE i.installation_id = ?
            ORDER BY p.created_at ASC, p.id ASC
          `)
            .bind(installationId)
            .all();

          const photosByIncident = {};
          for (const photo of photos) {
            if (!photosByIncident[photo.incident_id]) {
              photosByIncident[photo.incident_id] = [];
            }
            photosByIncident[photo.incident_id].push(photo);
          }

          const enriched = incidents.map((incident) => ({
            ...incident,
            photos: photosByIncident[incident.id] || [],
          }));

          return jsonResponse(request, env, corsPolicy,{
            success: true,
            installation_id: installationId,
            incidents: enriched,
          });
        }

        if (request.method === "POST") {
          const data = await readJsonOrThrowBadRequest(request);
          const payload = validateIncidentPayload(data, {
            defaultSource: isWebRoute ? "web" : "mobile",
            defaultReporterUsername: webSession?.sub || "unknown",
          });
          const createdAt = nowIso();

          const { results: installationRows } = await env.DB.prepare(`
            SELECT id, notes, installation_time_seconds
            FROM installations
            WHERE id = ?
          `)
            .bind(installationId)
            .all();

          const installation = installationRows?.[0];
          if (!installation) {
            throw new HttpError(404, "InstalaciÃ³n no encontrada.");
          }

          const insertResult = await env.DB.prepare(`
            INSERT INTO incidents (installation_id, reporter_username, note, time_adjustment_seconds, severity, source, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
          `)
            .bind(
              installationId,
              payload.reporterUsername,
              payload.note,
              payload.timeAdjustment,
              payload.severity,
              payload.source,
              createdAt,
            )
            .run();

          const incidentId = insertResult?.meta?.last_row_id || null;

          if (payload.applyToInstallation) {
            const currentNotes = (installation.notes || "").toString();
            const composedNotes = currentNotes
              ? `${currentNotes}\n[INCIDENT] ${payload.note}`
              : payload.note;
            const currentTime = Number(installation.installation_time_seconds || 0);
            const nextTime = Math.max(0, currentTime + payload.timeAdjustment);

            await env.DB.prepare(`
              UPDATE installations
              SET notes = ?, installation_time_seconds = ?
              WHERE id = ?
            `)
              .bind(composedNotes, nextTime, installationId)
              .run();
          }

          if (payload.severity === "critical") {
            try {
              const fcmTokens = await listDeviceTokensForWebRoles(
                env,
                CRITICAL_INCIDENT_PUSH_ROLES,
              );
              if (fcmTokens.length > 0) {
                await sendPushNotification(env, fcmTokens, {
                  title: "Incidencia critica",
                  body: `Nueva incidencia critica en instalacion #${installationId}`,
                  data: {
                    installation_id: String(installationId),
                    incident_id: String(incidentId || ""),
                    severity: payload.severity,
                    source: payload.source,
                  },
                });
              }
            } catch {
              // Best effort: una falla de push no debe impedir registrar la incidencia.
            }
          }

          // Log audit event for incident creation
          await logAuditEvent(env, {
            action: "create_incident",
            username: payload.reporterUsername,
            success: true,
            details: {
              incident_id: incidentId,
              installation_id: installationId,
              severity: payload.severity,
              source: payload.source,
              note_preview: payload.note.substring(0, 100)
            },
            computerName: "",
            ipAddress: getClientIpForRateLimit(request),
            platform: payload.source
          });

          const incidentEventPayload = {
            id: incidentId,
            installation_id: installationId,
            reporter_username: payload.reporterUsername,
            note: payload.note,
            time_adjustment_seconds: payload.timeAdjustment,
            severity: payload.severity,
            source: payload.source,
            created_at: createdAt,
          };

          await publishRealtimeEvent(env, {
            type: "incident_created",
            incident: incidentEventPayload,
          }, realtimeTenantId);
          if (payload.applyToInstallation) {
            await publishRealtimeEvent(env, {
              type: "installation_updated",
              installation: {
                id: installationId,
                notes: (installation.notes || "").toString()
                  ? `${(installation.notes || "").toString()}\n[INCIDENT] ${payload.note}`
                  : payload.note,
                installation_time_seconds: Math.max(
                  0,
                  Number(installation.installation_time_seconds || 0) + payload.timeAdjustment,
                ),
              },
            }, realtimeTenantId);
          }
          await publishRealtimeStatsUpdate(env, realtimeTenantId);

          return jsonResponse(request, env, corsPolicy,
            {
              success: true,
              incident: incidentEventPayload,
            },
            201,
          );
        }
      }


      if (
        routeParts.length === 3 &&
        routeParts[0] === "incidents" &&
        routeParts[2] === "photos" &&
        request.method === "POST"
      ) {
        const incidentId = parsePositiveInt(routeParts[1], "incident_id");
        const declaredContentType = normalizeContentType(request.headers.get("content-type"));

        if (!ALLOWED_PHOTO_TYPES.has(declaredContentType)) {
          throw new HttpError(400, "Tipo de imagen no permitido.");
        }

        const bodyBuffer = await request.arrayBuffer();
        const { sizeBytes, contentType } = validateAndProcessPhoto(bodyBuffer, declaredContentType);

        if (!env.INCIDENTS_BUCKET || typeof env.INCIDENTS_BUCKET.put !== "function") {
          throw new Error("El bucket R2 (INCIDENTS_BUCKET) no estÃ¡ configurado.");
        }

        const { results: incidentRows } = await env.DB.prepare(`
          SELECT id, installation_id
          FROM incidents
          WHERE id = ?
        `)
          .bind(incidentId)
          .all();

        const incident = incidentRows?.[0];
        if (!incident) {
          throw new HttpError(404, "Incidencia no encontrada.");
        }

        const extension = extensionFromType(contentType);
        const fileName = sanitizeFileName(
          request.headers.get("X-File-Name"),
          `incident_${incidentId}`,
        );
        const r2Key = buildIncidentR2Key(incident.installation_id, incidentId, extension);
        const sha256 = await sha256Hex(bodyBuffer);
        const createdAt = nowIso();

        await env.INCIDENTS_BUCKET.put(r2Key, bodyBuffer, {
          httpMetadata: { contentType },
        });

        const insertResult = await env.DB.prepare(`
          INSERT INTO incident_photos (incident_id, r2_key, file_name, content_type, size_bytes, sha256, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `)
          .bind(incidentId, r2Key, fileName, contentType, sizeBytes, sha256, createdAt)
          .run();

        return jsonResponse(request, env, corsPolicy,
          {
            success: true,
            photo: {
              id: insertResult?.meta?.last_row_id || null,
              incident_id: incidentId,
              r2_key: r2Key,
              file_name: fileName,
              content_type: contentType,
              size_bytes: sizeBytes,
              sha256,
              created_at: createdAt,
            },
          },
          201,
        );
      }

      if (routeParts.length === 2 && routeParts[0] === "photos" && request.method === "GET") {
        const photoId = parsePositiveInt(routeParts[1], "photo_id");

        if (!env.INCIDENTS_BUCKET || typeof env.INCIDENTS_BUCKET.get !== "function") {
          throw new Error("El bucket R2 (INCIDENTS_BUCKET) no estÃ¡ configurado.");
        }

        const { results: photoRows } = await env.DB.prepare(`
          SELECT id, incident_id, r2_key, file_name, content_type, size_bytes, sha256, created_at
          FROM incident_photos
          WHERE id = ?
        `)
          .bind(photoId)
          .all();

        const photo = photoRows?.[0];
        if (!photo) {
          throw new HttpError(404, "Foto no encontrada.");
        }

        const object = await env.INCIDENTS_BUCKET.get(photo.r2_key);
        if (!object || !object.body) {
          throw new HttpError(404, "Archivo de foto no encontrado en almacenamiento.");
        }

        const safeName = sanitizeFileName(photo.file_name, `photo_${photoId}`);

        return new Response(object.body, {
          status: 200,
          headers: {
            ...corsHeaders(request, env, corsPolicy),
            "Content-Type":
              photo.content_type || object.httpMetadata?.contentType || "application/octet-stream",
            "Content-Disposition": `inline; filename=\"${safeName}\"`,
            "Cache-Control": "private, max-age=300",
          },
        });
      }

      if (routeParts.length === 2 && routeParts[0] === "installations") {
        const recordId = routeParts[1];

        if (request.method === "GET") {
          const installationId = parsePositiveInt(recordId, "id");
          const { results } = await env.DB.prepare(
            "SELECT * FROM installations WHERE id = ? LIMIT 1",
          )
            .bind(installationId)
            .all();

          if (!results?.length) {
            throw new HttpError(404, "Registro no encontrado.");
          }

          return jsonResponse(request, env, corsPolicy,results[0]);
        }

        if (request.method === "PUT") {
          const data = await readJsonOrThrowBadRequest(request);
          await env.DB.prepare(`
            UPDATE installations
            SET notes = ?, installation_time_seconds = ?
            WHERE id = ?
          `)
            .bind(data.notes ?? null, data.installation_time_seconds ?? null, recordId)
            .run();

          await publishRealtimeEvent(env, {
            type: "installation_updated",
            installation: {
              id: Number(recordId),
              notes: data.notes ?? null,
              installation_time_seconds: data.installation_time_seconds ?? null,
            },
          }, realtimeTenantId);
          await publishRealtimeStatsUpdate(env, realtimeTenantId);

          return jsonResponse(request, env, corsPolicy,{ success: true, updated: recordId });
        }

        if (request.method === "DELETE") {
          if (!recordId) {
            return textResponse(request, env, corsPolicy, "Error: El ID del registro es obligatorio.", 400);
          }

          // Log audit event for installation deletion
          await logAuditEvent(env, {
            action: "installation_deleted",
            username: webSession?.sub || "api",
            success: true,
            details: {
              deleted_id: recordId
            },
            ipAddress: getClientIpForRateLimit(request),
            platform: isWebRoute ? "web" : "api"
          });

          await env.DB.prepare("DELETE FROM installations WHERE id = ?").bind(recordId).run();
          await publishRealtimeEvent(env, {
            type: "installation_deleted",
            installation: {
              id: Number(recordId),
            },
          }, realtimeTenantId);
          await publishRealtimeStatsUpdate(env, realtimeTenantId);
          return jsonResponse(request, env, corsPolicy,{ message: `Registro ${recordId} eliminado.` });
        }
      }

      if (routeParts.length === 1 && routeParts[0] === "statistics") {
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
          WHERE (? IS NULL OR timestamp >= ?)
            AND (? IS NULL OR timestamp < ?)
        `)
          .bind(startFilter, startFilter, endFilter, endFilter)
          .all();

        const { results: byBrandRows } = await env.DB.prepare(`
          SELECT driver_brand AS brand, COUNT(*) AS count
          FROM installations
          WHERE (? IS NULL OR timestamp >= ?)
            AND (? IS NULL OR timestamp < ?)
            AND NULLIF(TRIM(driver_brand), '') IS NOT NULL
          GROUP BY driver_brand
          ORDER BY count DESC
        `)
          .bind(startFilter, startFilter, endFilter, endFilter)
          .all();

        const { results: topDriverRows } = await env.DB.prepare(`
          SELECT TRIM(driver_brand) AS brand, TRIM(driver_version) AS version, COUNT(*) AS count
          FROM installations
          WHERE (? IS NULL OR timestamp >= ?)
            AND (? IS NULL OR timestamp < ?)
            AND NULLIF(TRIM(driver_brand || ' ' || driver_version), '') IS NOT NULL
          GROUP BY TRIM(driver_brand), TRIM(driver_version)
          ORDER BY count DESC
        `)
          .bind(startFilter, startFilter, endFilter, endFilter)
          .all();

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

        return jsonResponse(request, env, corsPolicy,{
          total_installations: Number(totals.total_installations) || 0,
          successful_installations: Number(totals.successful_installations) || 0,
          failed_installations: Number(totals.failed_installations) || 0,
          success_rate: Number(totals.success_rate) || 0,
          average_time_minutes: Number(totals.average_time_minutes) || 0,
          unique_clients: Number(totals.unique_clients) || 0,
          top_drivers: topDrivers,
          by_brand: byBrand,
        });
      }

      return textResponse(request, env, corsPolicy, "Ruta no encontrada.", 404);
    } catch (error) {
      if (error instanceof HttpError) {
        return jsonResponse(request, env, corsPolicy,
          {
            success: false,
            error: {
              code: error.status === 401 ? "UNAUTHORIZED" : "INVALID_REQUEST",
              message: error.message,
            },
          },
          error.status,
        );
      }

      return jsonResponse(request, env, corsPolicy,{ error: error.message }, 500);
    }
  },
};
