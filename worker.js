﻿﻿﻿﻿﻿﻿﻿import bcrypt from "bcryptjs";

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

function getAllowedCorsOrigins(request, env) {
  const allowed = new Set([...CONTROLLED_DASHBOARD_ORIGINS, ...CONTROLLED_MOBILE_ORIGINS]);
  if (request?.url) {
    allowed.add(new URL(request.url).origin);
  }

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

  if (["dashboard", "dashboard.css", "dashboard.js", "manifest.json", "events", "sw.js"].includes(first)) {
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
  } else if (first === "statistics" || first === "photos") {
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
  if (!allowedOrigins.has(origin)) {
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

// AUDIT LOGGING FUNCTION
async function logAuditEvent(env, { action, username, success, details, computerName, ipAddress, platform }) {
  try {
    const detailsJson = details && typeof details === "object" ? JSON.stringify(details) : "{}";
    await env.DB.prepare(`
      INSERT INTO audit_logs (timestamp, action, username, success, details, computer_name, ip_address, platform)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `)
      .bind(
        nowIso(),
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
    (message.includes("no such column") && message.includes("password_hash_type"))
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
      SELECT id, username, password_hash, password_hash_type, role, is_active, created_at, updated_at, last_login_at
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
      SELECT id, username, password_hash, password_hash_type, role, is_active, created_at, updated_at, last_login_at
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
    is_active: normalizeActiveFlag(rawUser.is_active, 1) === 1,
    created_at: normalizeOptionalString(rawUser.created_at, ""),
    updated_at: normalizeOptionalString(rawUser.updated_at, ""),
    last_login_at: rawUser.last_login_at || null,
  };
}

async function listWebUsers(env) {
  try {
    const { results } = await env.DB.prepare(`
      SELECT id, username, role, is_active, created_at, updated_at, last_login_at
      FROM web_users
      ORDER BY username ASC
    `).all();
    return (results || []).map((row) => serializeWebUser(row));
  } catch (error) {
    ensureWebUsersTableAvailable(error);
  }
}

async function createWebUser(env, { username, password, role }) {
  const createdAt = nowIso();
  const passwordHash = await hashWebPassword(password);
  const passwordHashType = WEB_HASH_TYPE_PBKDF2;

  try {
    const existing = await getWebUserByUsername(env, username);
    if (existing) {
      throw new HttpError(409, "El usuario web ya existe.");
    }

    const insertResult = await env.DB.prepare(`
      INSERT INTO web_users (username, password_hash, password_hash_type, role, is_active, created_at, updated_at)
      VALUES (?, ?, ?, ?, 1, ?, ?)
    `)
      .bind(username, passwordHash, passwordHashType, role, createdAt, createdAt)
      .run();

    return {
      id: Number(insertResult?.meta?.last_row_id || 0),
      username,
      password_hash_type: passwordHashType,
      role,
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
  };
}

async function upsertWebUserFromImport(env, importedUser) {
  const existing = await getWebUserByUsername(env, importedUser.username);
  const now = nowIso();

  if (existing) {
    await env.DB.prepare(`
      UPDATE web_users
      SET password_hash = ?, password_hash_type = ?, role = ?, is_active = ?, updated_at = ?
      WHERE id = ?
    `)
      .bind(
        importedUser.passwordHash,
        importedUser.passwordHashType,
        importedUser.role,
        importedUser.isActive,
        now,
        Number(existing.id),
      )
      .run();

    return "updated";
  }

  await env.DB.prepare(`
    INSERT INTO web_users (username, password_hash, password_hash_type, role, is_active, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `)
    .bind(
      importedUser.username,
      importedUser.passwordHash,
      importedUser.passwordHashType,
      importedUser.role,
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

  const encodedPayload = base64UrlEncodeUtf8(JSON.stringify(payload));
  const signature = await hmacSha256Hex(env.WEB_SESSION_SECRET, encodedPayload);

  return {
    token: `${encodedPayload}.${signature}`,
    expires_in: WEB_ACCESS_TTL_SECONDS,
    expires_at: new Date(exp * 1000).toISOString(),
    sub,
    role,
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
    });

    const response = jsonResponse(request, env, corsPolicy, {
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
    const createdUser = await createWebUser(env, { username, password, role });

    const sessionVersion = await rotateWebSessionVersion(env, Number(createdUser.id));
    const token = await buildWebAccessToken(env, {
      username: createdUser.username,
      role: createdUser.role,
      user_id: Number(createdUser.id),
      session_version: sessionVersion,
    });

    const response = jsonResponse(request, env, corsPolicy, {
   
      {
        success: true,
        bootstrapped: true,
        user: {
          id: createdUser.id,
          username: createdUser.username,
          role: createdUser.role,
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

    const users = await listWebUsers(env);
    return jsonResponse(request, env, corsPolicy,
      {
        success: true,
        users,
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
    const createdUser = await createWebUser(env, { username, password, role });

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
    const processedUsers = [];
    for (const rawUser of users) {
      const imported = normalizeImportedWebUser(rawUser);
      const result = await upsertWebUserFromImport(env, imported);
      if (result === "created") created += 1;
      if (result === "updated") updated += 1;
      processedUsers.push({
        username: imported.username,
        role: imported.role,
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

    const response = jsonResponse({
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
      expires_at: new Date(Number(payload.exp) * 1000).toISOString(),
    });
  }

  return null;
}

async function verifyAuth(request, env, url) {
  const expectedToken = env.API_TOKEN;
  const expectedSecret = env.API_SECRET;

  // Nunca permitir acceso sin credenciales de API configuradas.
  if (!expectedToken || !expectedSecret) {
    throw new HttpError(
      503,
      "API no configurada correctamente. Define API_TOKEN y API_SECRET.",
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
            audit_logs: "/audit-logs",
            web_audit_logs: "/web/audit-logs",
          },
        });
      }

      if (routeParts.length === 1 && routeParts[0] === "health" && request.method === "GET") {
        return jsonResponse(request, env, corsPolicy,{ ok: true, now: nowIso() });
      }





      // Dashboard route - serve embedded single-file dashboard
      if (routeParts.length === 1 && routeParts[0] === "dashboard" && request.method === "GET") {
        try {
          await verifyWebAccessToken(request, env);
        } catch {
          // Allow access to login page even without token - JS will handle auth
        }
        
        const html = `<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="theme-color" content="#06b6d4">
    <meta name="description" content="Dashboard de gestión de instalaciones de drivers">
    <title>Driver Manager Dashboard</title>
    <style>
:root {
    /* Dark theme (default) */
    --bg-primary: #0f172a;
    --bg-secondary: #1e293b;
    --bg-card: #334155;
    --bg-hover: #475569;
    --text-primary: #f8fafc;
    --text-secondary: #94a3b8;
    --accent-primary: #06b6d4;
    --accent-secondary: #8b5cf6;
    --success: #10b981;
    --warning: #f59e0b;
    --error: #ef4444;
    --info: #3b82f6;
    --border: #475569;
    --shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.3);
    --shadow-lg: 0 10px 15px -3px rgba(0, 0, 0, 0.4);
    --radius: 12px;
    --radius-sm: 8px;
}

/* Light theme */
[data-theme="light"] {
    --bg-primary: #f8fafc;
    --bg-secondary: #ffffff;
    --bg-card: #f1f5f9;
    --bg-hover: #e2e8f0;
    --text-primary: #0f172a;
    --text-secondary: #64748b;
    --accent-primary: #0891b2;
    --accent-secondary: #7c3aed;
    --success: #059669;
    --warning: #d97706;
    --error: #dc2626;
    --info: #2563eb;
    --border: #cbd5e1;
    --shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
    --shadow-lg: 0 10px 15px -3px rgba(0, 0, 0, 0.15);
}


* {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
}

body {
    font-family: 'Inter', system-ui, -apple-system, sans-serif;
    background: var(--bg-primary);
    color: var(--text-primary);
    line-height: 1.6;
    min-height: 100vh;
}

#app {
    display: flex;
    min-height: 100vh;
}

/* Sidebar */
.sidebar {
    width: 280px;
    background: var(--bg-secondary);
    border-right: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    padding: 1.5rem;
    position: fixed;
    height: 100vh;
    overflow-y: auto;
}

.logo h1 {
    font-size: 1.25rem;
    font-weight: 700;
    background: linear-gradient(135deg, var(--accent-primary), var(--accent-secondary));
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    margin-bottom: 2rem;
    display: flex;
    align-items: center;
    gap: 0.5rem;
}

.nav-links {
    list-style: none;
    flex: 1;
}

.nav-links li {
    margin-bottom: 0.5rem;
}

.nav-links a {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.875rem 1rem;
    color: var(--text-secondary);
    text-decoration: none;
    border-radius: var(--radius);
    transition: all 0.2s;
    font-size: 0.9375rem;
}

.nav-links a:hover, .nav-links a.active {
    background: var(--bg-card);
    color: var(--text-primary);
    box-shadow: var(--shadow);
}

.user-info {
    padding-top: 1rem;
    border-top: 1px solid var(--border);
    margin-top: auto;
}

.user-info span {
    display: block;
    margin-bottom: 0.5rem;
    color: var(--text-secondary);
    font-size: 0.875rem;
}

.role-badge {
    display: inline-block !important;
    background: linear-gradient(135deg, var(--accent-primary), var(--accent-secondary));
    color: white !important;
    padding: 0.25rem 0.75rem !important;
    border-radius: 9999px;
    font-size: 0.75rem !important;
    font-weight: 600;
    text-transform: uppercase;
    width: fit-content;
}

/* Main Content */
.main-content {
    flex: 1;
    margin-left: 280px;
    padding: 2rem;
    overflow-y: auto;
    min-height: 100vh;
}

.header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 2rem;
    padding-bottom: 1rem;
    border-bottom: 1px solid var(--border);
}

.header h2 {
    font-size: 1.875rem;
    font-weight: 700;
    background: linear-gradient(135deg, var(--text-primary), var(--text-secondary));
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
}

.header-actions {
    display: flex;
    gap: 0.75rem;
}

/* Stats Grid */
.stats-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
    gap: 1.5rem;
    margin-bottom: 2rem;
}

.stat-card {
    background: var(--bg-secondary);
    border-radius: var(--radius);
    padding: 1.5rem;
    display: flex;
    align-items: center;
    gap: 1rem;
    box-shadow: var(--shadow);
    border: 1px solid var(--border);
    transition: all 0.3s ease;
    position: relative;
    overflow: hidden;
}

.stat-card::before {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    width: 4px;
    height: 100%;
    background: linear-gradient(180deg, var(--accent-primary), var(--accent-secondary));
    opacity: 0;
    transition: opacity 0.3s;
}

.stat-card:hover {
    transform: translateY(-4px);
    box-shadow: var(--shadow-lg);
    border-color: var(--accent-primary);
}

.stat-card:hover::before {
    opacity: 1;
}

.stat-icon {
    width: 56px;
    height: 56px;
    border-radius: var(--radius);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 1.75rem;
    background: var(--bg-card);
    box-shadow: var(--shadow);
}

.stat-icon.total { background: linear-gradient(135deg, rgba(6, 182, 212, 0.2), rgba(6, 182, 212, 0.1)); }
.stat-icon.success { background: linear-gradient(135deg, rgba(16, 185, 129, 0.2), rgba(16, 185, 129, 0.1)); }
.stat-icon.time { background: linear-gradient(135deg, rgba(139, 92, 246, 0.2), rgba(139, 92, 246, 0.1)); }
.stat-icon.clients { background: linear-gradient(135deg, rgba(245, 158, 11, 0.2), rgba(245, 158, 11, 0.1)); }

.stat-info h3 {
    font-size: 0.875rem;
    color: var(--text-secondary);
    margin-bottom: 0.25rem;
    font-weight: 500;
}

.stat-info p {
    font-size: 1.75rem;
    font-weight: 700;
    color: var(--text-primary);
    background: linear-gradient(135deg, var(--text-primary), var(--accent-primary));
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
}

/* Charts Grid */
.charts-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(400px, 1fr));
    gap: 1.5rem;
    margin-bottom: 2rem;
}

.chart-card {
    background: var(--bg-secondary);
    border-radius: var(--radius);
    padding: 1.5rem;
    box-shadow: var(--shadow);
    border: 1px solid var(--border);
    transition: all 0.3s ease;
}

.chart-card:hover {
    border-color: var(--accent-primary);
    box-shadow: var(--shadow-lg);
}

.chart-card.wide {
    grid-column: 1 / -1;
}

.chart-card h3 {
    font-size: 1rem;
    color: var(--text-secondary);
    margin-bottom: 1rem;
    display: flex;
    align-items: center;
    gap: 0.5rem;
}

.chart-card canvas {
    max-height: 300px;
}

/* Sections */
.section {
    display: none;
    animation: fadeIn 0.3s ease;
}

.section.active {
    display: block;
}

@keyframes fadeIn {
    from { opacity: 0; transform: translateY(10px); }
    to { opacity: 1; transform: translateY(0); }
}

/* Filters - Advanced Layout */
.filters {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    margin-bottom: 1.5rem;
    padding: 1.25rem;
    background: var(--bg-secondary);
    border-radius: var(--radius);
    border: 1px solid var(--border);
}

/* Search wrapper - Real-time search */
.search-wrapper {
    position: relative;
    width: 100%;
}

.search-input {
    width: 100%;
    padding: 0.875rem 1rem 0.875rem 2.75rem;
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    color: var(--text-primary);
    font-size: 0.9375rem;
    transition: all 0.2s;
}

.search-input:focus {
    outline: none;
    border-color: var(--accent-primary);
    box-shadow: 0 0 0 3px rgba(6, 182, 212, 0.15);
}

.search-input::placeholder {
    color: var(--text-secondary);
}

.search-icon {
    position: absolute;
    left: 1rem;
    top: 50%;
    transform: translateY(-50%);
    font-size: 1rem;
    pointer-events: none;
    opacity: 0.7;
}

/* Filter row - Combined filters */
.filter-row {
    display: flex;
    gap: 0.75rem;
    flex-wrap: wrap;
}

.filter-row select,
.filter-row input {
    flex: 1;
    min-width: 140px;
    padding: 0.625rem 1rem;
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    color: var(--text-primary);
    font-size: 0.875rem;
    transition: all 0.2s;
}

.filter-row select:focus,
.filter-row input:focus {
    outline: none;
    border-color: var(--accent-primary);
    box-shadow: 0 0 0 3px rgba(6, 182, 212, 0.1);
}

/* Filter chips */
.filter-chips {
    display: flex;
    gap: 0.5rem;
    flex-wrap: wrap;
    min-height: 32px;
}

.filter-chip {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.375rem 0.75rem;
    background: linear-gradient(135deg, rgba(6, 182, 212, 0.2), rgba(139, 92, 246, 0.2));
    border: 1px solid var(--accent-primary);
    border-radius: 9999px;
    color: var(--text-primary);
    font-size: 0.8125rem;
    font-weight: 500;
    animation: chipFadeIn 0.2s ease;
}

@keyframes chipFadeIn {
    from { opacity: 0; transform: scale(0.9); }
    to { opacity: 1; transform: scale(1); }
}

.filter-chip .chip-label {
    color: var(--text-secondary);
}

.filter-chip .chip-value {
    font-weight: 600;
    color: var(--accent-primary);
}

.filter-chip .chip-remove {
    cursor: pointer;
    color: var(--text-secondary);
    transition: color 0.2s;
    font-size: 1rem;
    line-height: 1;
}

.filter-chip .chip-remove:hover {
    color: var(--error);
}

/* Filter actions */
.filter-actions {
    display: flex;
    gap: 0.75rem;
    justify-content: flex-end;
    padding-top: 0.5rem;
    border-top: 1px solid var(--border);
}

/* Results info */
.results-info {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 1rem;
    padding: 0.75rem 1rem;
    background: var(--bg-secondary);
    border-radius: var(--radius-sm);
    border: 1px solid var(--border);
    font-size: 0.875rem;
    color: var(--text-secondary);
}

.results-info .count {
    color: var(--accent-primary);
    font-weight: 600;
}

/* Keyboard shortcut hint */
.search-wrapper::after {
    content: 'Ctrl+K';
    position: absolute;
    right: 1rem;
    top: 50%;
    transform: translateY(-50%);
    padding: 0.25rem 0.5rem;
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: 4px;
    font-size: 0.75rem;
    color: var(--text-secondary);
    pointer-events: none;
}

/* Theme Toggle Button */
.theme-toggle {
    background: var(--bg-card);
    border: 1px solid var(--border);
    color: var(--text-primary);
    width: 44px;
    height: 44px;
    border-radius: var(--radius-sm);
    cursor: pointer;
    font-size: 1.25rem;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.3s ease;
    position: relative;
    overflow: hidden;
}

.theme-toggle:hover {
    background: var(--accent-primary);
    border-color: var(--accent-primary);
    transform: scale(1.05);
}

.theme-toggle .icon-sun,
.theme-toggle .icon-moon {
    position: absolute;
    transition: all 0.3s ease;
}

.theme-toggle .icon-sun {
    opacity: 0;
    transform: translateY(20px) rotate(90deg);
}

.theme-toggle .icon-moon {
    opacity: 1;
    transform: translateY(0) rotate(0);
}

[data-theme="light"] .theme-toggle .icon-sun {
    opacity: 1;
    transform: translateY(0) rotate(0);
}

[data-theme="light"] .theme-toggle .icon-moon {
    opacity: 0;
    transform: translateY(-20px) rotate(-90deg);
}

/* Smooth theme transition */
* {
    transition: background-color 0.3s ease, color 0.3s ease, border-color 0.3s ease, box-shadow 0.3s ease;
}


@media (max-width: 768px) {
    .search-wrapper::after {
        display: none;
    }
    
    .filter-row {
        flex-direction: column;
    }
    
    .filter-row select,
    .filter-row input {
        width: 100%;
        min-width: unset;
    }
    
    .filter-actions {
        flex-direction: column;
    }
    
    .filter-actions button {
        width: 100%;
        justify-content: center;
    }
}

/* Tables */
.table-container {
    background: var(--bg-secondary);
    border-radius: var(--radius);
    overflow: hidden;
    box-shadow: var(--shadow);
    border: 1px solid var(--border);
}

table {
    width: 100%;
    border-collapse: collapse;
}

th, td {
    padding: 1rem;
    text-align: left;
    border-bottom: 1px solid var(--border);
}

th {
    background: var(--bg-card);
    font-weight: 600;
    font-size: 0.875rem;
    color: var(--text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    font-size: 0.75rem;
}

td {
    font-size: 0.875rem;
    color: var(--text-primary);
}

tr {
    transition: background 0.2s;
}

tr:hover {
    background: var(--bg-hover);
}

tr[data-id] {
    cursor: pointer;
}

/* Badges */
.badge {
    display: inline-flex;
    align-items: center;
    gap: 0.375rem;
    padding: 0.375rem 0.875rem;
    border-radius: 9999px;
    font-size: 0.75rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.025em;
}

.badge::before {
    content: '';
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: currentColor;
}

.badge.success { background: rgba(16, 185, 129, 0.15); color: var(--success); }
.badge.failed { background: rgba(239, 68, 68, 0.15); color: var(--error); }
.badge.unknown { background: rgba(148, 163, 184, 0.15); color: var(--text-secondary); }
.badge.low { background: rgba(6, 182, 212, 0.15); color: var(--accent-primary); }
.badge.medium { background: rgba(245, 158, 11, 0.15); color: var(--warning); }
.badge.high { background: rgba(239, 68, 68, 0.15); color: var(--error); }
.badge.critical { background: rgba(239, 68, 68, 0.25); color: var(--error); animation: pulse 2s infinite; }

@keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.7; }
}

/* Incidents */
.incidents-grid {
    display: grid;
    gap: 1rem;
}

.incident-card {
    background: var(--bg-secondary);
    border-radius: var(--radius);
    padding: 1.5rem;
    border: 1px solid var(--border);
    transition: all 0.3s ease;
    position: relative;
    overflow: hidden;
}

.incident-card::before {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 3px;
    background: linear-gradient(90deg, var(--accent-primary), var(--accent-secondary));
    opacity: 0;
    transition: opacity 0.3s;
}

.incident-card:hover {
    border-color: var(--accent-primary);
    transform: translateX(4px);
}

.incident-card:hover::before {
    opacity: 1;
}

.incident-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 1rem;
}

.incident-header small {
    color: var(--text-secondary);
    font-size: 0.875rem;
}

.photos-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
    gap: 0.75rem;
    margin-top: 1rem;
}

.photo-thumb {
    width: 100%;
    height: 140px;
    object-fit: cover;
    border-radius: var(--radius-sm);
    cursor: pointer;
    transition: all 0.3s ease;
    border: 2px solid transparent;
}

.photo-thumb:hover {
    transform: scale(1.05);
    border-color: var(--accent-primary);
    box-shadow: var(--shadow-lg);
}

/* Modal */
.modal {
    display: none;
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(15, 23, 42, 0.9);
    backdrop-filter: blur(4px);
    z-index: 1000;
    align-items: center;
    justify-content: center;
    padding: 1rem;
}

.modal.active {
    display: flex;
    animation: modalFadeIn 0.3s ease;
}

@keyframes modalFadeIn {
    from { opacity: 0; }
    to { opacity: 1; }
}

.modal-content {
    background: var(--bg-secondary);
    padding: 2rem;
    border-radius: var(--radius);
    max-width: 420px;
    width: 100%;
    box-shadow: var(--shadow-lg);
    border: 1px solid var(--border);
    animation: modalSlideIn 0.3s ease;
}

@keyframes modalSlideIn {
    from { opacity: 0; transform: translateY(-20px); }
    to { opacity: 1; transform: translateY(0); }
}

.modal-content.photo-modal {
    max-width: 90%;
    max-height: 90%;
    padding: 1rem;
    display: flex;
    flex-direction: column;
    align-items: center;
}

.login-header {
    text-align: center;
    margin-bottom: 1.5rem;
}

.login-header h2 {
    font-size: 1.5rem;
    margin-bottom: 0.5rem;
    background: linear-gradient(135deg, var(--accent-primary), var(--accent-secondary));
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
}

.login-header p {
    color: var(--text-secondary);
    font-size: 0.9375rem;
}

.input-group {
    margin-bottom: 1rem;
}

.input-group label {
    display: block;
    margin-bottom: 0.5rem;
    color: var(--text-secondary);
    font-size: 0.875rem;
    font-weight: 500;
}

.input-group input {
    width: 100%;
    padding: 0.875rem 1rem;
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    color: var(--text-primary);
    font-size: 0.9375rem;
    transition: all 0.2s;
}

.input-group input:focus {
    outline: none;
    border-color: var(--accent-primary);
    box-shadow: 0 0 0 3px rgba(6, 182, 212, 0.1);
}

.modal-content img {
    max-width: 100%;
    max-height: 80vh;
    border-radius: var(--radius-sm);
    box-shadow: var(--shadow-lg);
}

.close {
    position: absolute;
    top: 1rem;
    right: 1rem;
    font-size: 2rem;
    cursor: pointer;
    color: var(--text-secondary);
    width: 40px;
    height: 40px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 50%;
    transition: all 0.2s;
}

.close:hover {
    background: var(--bg-card);
    color: var(--text-primary);
}

/* Buttons */
.btn-primary {
    background: linear-gradient(135deg, var(--accent-primary), var(--accent-secondary));
    color: white;
    border: none;
    padding: 0.75rem 1.5rem;
    border-radius: var(--radius-sm);
    cursor: pointer;
    font-weight: 600;
    font-size: 0.9375rem;
    transition: all 0.2s;
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
}

.btn-primary:hover {
    transform: translateY(-2px);
    box-shadow: 0 4px 12px rgba(6, 182, 212, 0.4);
}

.btn-primary:active {
    transform: translateY(0);
}

.btn-secondary {
    background: var(--bg-card);
    color: var(--text-primary);
    border: 1px solid var(--border);
    padding: 0.625rem 1.25rem;
    border-radius: var(--radius-sm);
    cursor: pointer;
    font-size: 0.875rem;
    font-weight: 500;
    transition: all 0.2s;
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
}

.btn-secondary:hover {
    background: var(--bg-hover);
    border-color: var(--accent-primary);
}

.btn-icon {
    background: var(--bg-card);
    border: 1px solid var(--border);
    color: var(--text-primary);
    width: 44px;
    height: 44px;
    border-radius: var(--radius-sm);
    cursor: pointer;
    font-size: 1.25rem;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.2s;
}

.btn-icon:hover {
    background: var(--accent-primary);
    border-color: var(--accent-primary);
    transform: rotate(180deg);
}

.btn-full {
    width: 100%;
    justify-content: center;
    padding: 1rem;
}

/* Loading & Error States */
.loading {
    text-align: center;
    padding: 3rem;
    color: var(--text-secondary);
    font-size: 0.9375rem;
}

.loading::after {
    content: '';
    display: inline-block;
    width: 20px;
    height: 20px;
    border: 2px solid var(--border);
    border-top-color: var(--accent-primary);
    border-radius: 50%;
    margin-left: 0.75rem;
    animation: spin 1s linear infinite;
    vertical-align: middle;
}

@keyframes spin {
    to { transform: rotate(360deg); }
}

.error {
    color: var(--error);
    font-size: 0.875rem;
    margin-top: 0.75rem;
    text-align: center;
    padding: 0.75rem;
    background: rgba(239, 68, 68, 0.1);
    border-radius: var(--radius-sm);
    border: 1px solid rgba(239, 68, 68, 0.2);
}

/* Recent Section */
.recent-section {
    margin-top: 2rem;
}

.recent-section h3 {
    font-size: 1.125rem;
    color: var(--text-primary);
    margin-bottom: 1rem;
    display: flex;
    align-items: center;
    gap: 0.5rem;
}

/* Responsive */
@media (max-width: 1024px) {
    .charts-grid {
        grid-template-columns: 1fr;
    }
    
    .chart-card.wide {
        grid-column: 1;
    }
}

@media (max-width: 768px) {
    .sidebar {
        width: 100%;
        position: fixed;
        bottom: 0;
        left: 0;
        flex-direction: row;
        padding: 0.75rem;
        z-index: 100;
        height: auto;
        border-right: none;
        border-top: 1px solid var(--border);
    }
    
    .logo, .user-info {
        display: none;
    }
    
    .nav-links {
        display: flex;
        flex: 1;
        justify-content: space-around;
    }
    
    .nav-links li {
        margin-bottom: 0;
    }
    
    .nav-links a {
        padding: 0.625rem;
        font-size: 0.875rem;
    }
    
    .main-content {
        margin-left: 0;
        padding: 1rem;
        padding-bottom: 5rem;
    }
    
    .stats-grid {
        grid-template-columns: repeat(2, 1fr);
        gap: 1rem;
    }
    
    .stat-card {
        padding: 1rem;
    }
    
    .stat-icon {
        width: 44px;
        height: 44px;
        font-size: 1.25rem;
    }
    
    .stat-info p {
        font-size: 1.25rem;
    }
    
    .filters {
        flex-direction: column;
        align-items: stretch;
    }
    
    .filters input, .filters select, .filters button {
        width: 100%;
    }
    
    .charts-grid {
        grid-template-columns: 1fr;
    }
    
    .header h2 {
        font-size: 1.5rem;
    }
}

/* Scrollbar */
::-webkit-scrollbar {
    width: 8px;
    height: 8px;
}

::-webkit-scrollbar-track {
    background: var(--bg-primary);
}

::-webkit-scrollbar-thumb {
    background: var(--bg-card);
    border-radius: 4px;
}

::-webkit-scrollbar-thumb:hover {
    background: var(--bg-hover);
}

</style>
    <link rel="manifest" href="/manifest.json">
    <link rel="apple-touch-icon" href="/icons/icon-192x192.png">
    <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js"></script>
</head>

<body>
    <div id="app">
        <nav class="sidebar">
            <div class="logo">
                <h1>📊 Driver Manager</h1>
            </div>
            <ul class="nav-links">
                <li><a href="#" class="active" data-section="dashboard">📈 Dashboard</a></li>
                <li><a href="#" data-section="installations">💻 Instalaciones</a></li>
                <li><a href="#" data-section="incidents">⚠️ Incidencias</a></li>
                <li><a href="#" data-section="audit">📋 Auditoría</a></li>
            </ul>
            <div class="user-info">
                <span id="username">Usuario</span>
                <span id="userRole" class="role-badge">admin</span>
                <button id="logoutBtn" class="btn-secondary">Cerrar sesión</button>
            </div>
        </nav>
        
        <main class="main-content">
            <header class="header">
                <h2 id="pageTitle">Dashboard</h2>
                <div class="header-actions">
                    <button id="themeToggle" class="theme-toggle" title="Cambiar tema">
                        <span class="icon-sun">☀️</span>
                        <span class="icon-moon">🌙</span>
                    </button>
                    <button id="refreshBtn" class="btn-icon" title="Actualizar">↻</button>
                </div>
            </header>

            
            <div id="dashboardSection" class="section active">
                <!-- Stats Cards -->
                <div class="stats-grid">
                    <div class="stat-card">
                        <div class="stat-icon total">📦</div>
                        <div class="stat-info">
                            <h3>Total Instalaciones</h3>
                            <p id="totalInstallations">-</p>
                        </div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-icon success">✅</div>
                        <div class="stat-info">
                            <h3>Tasa de Éxito</h3>
                            <p id="successRate">-</p>
                        </div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-icon time">⏱️</div>
                        <div class="stat-info">
                            <h3>Tiempo Promedio</h3>
                            <p id="avgTime">-</p>
                        </div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-icon clients">👥</div>
                        <div class="stat-info">
                            <h3>Clientes Únicos</h3>
                            <p id="uniqueClients">-</p>
                        </div>
                    </div>
                </div>
                
                <!-- Charts Grid -->
                <div class="charts-grid">
                    <div class="chart-card">
                        <h3>📊 Tasa de Éxito</h3>
                        <canvas id="successChart"></canvas>
                    </div>
                    <div class="chart-card">
                        <h3>🏷️ Instalaciones por Marca</h3>
                        <canvas id="brandChart"></canvas>
                    </div>
                    <div class="chart-card wide">
                        <h3>📈 Tendencia de Instalaciones (Últimos 7 días)</h3>
                        <canvas id="trendChart"></canvas>
                    </div>
                </div>
                
                <!-- Recent Activity -->
                <div class="recent-section">
                    <h3>🕐 Instalaciones Recientes</h3>
                    <div id="recentInstallations" class="table-container">
                        <p class="loading">Cargando...</p>
                    </div>
                </div>
            </div>
            
            <div id="installationsSection" class="section">
                <div class="filters">
                    <!-- Real-time search -->
                    <div class="search-wrapper">
                        <input type="text" id="searchInput" class="search-input" placeholder="🔍 Búsqueda en tiempo real..." autocomplete="off">
                        <span class="search-icon">🔍</span>
                    </div>
                    
                    <!-- Filter row -->
                    <div class="filter-row">
                        <select id="brandFilter">
                            <option value="">Todas las marcas</option>
                        </select>
                        <select id="statusFilter">
                            <option value="">Todos los estados</option>
                            <option value="success">✅ Éxito</option>
                            <option value="failed">❌ Fallido</option>
                            <option value="unknown">❓ Desconocido</option>
                        </select>
                        <input type="date" id="startDate" placeholder="Fecha inicio">
                        <input type="date" id="endDate" placeholder="Fecha fin">
                    </div>
                    
                    <!-- Filter chips -->
                    <div id="filterChips" class="filter-chips">
                        <!-- Dynamic filter chips will appear here -->
                    </div>
                    
                    <!-- Action buttons -->
                    <div class="filter-actions">
                        <button id="clearFilters" class="btn-secondary" style="display: none;">🗑️ Limpiar Filtros</button>
                        <button id="applyFilters" class="btn-primary">🔄 Aplicar</button>
                        <button id="exportBtn" class="btn-secondary">📥 Exportar</button>
                    </div>
                </div>
                
                <!-- Results info -->
                <div class="results-info">
                    <span id="resultsCount">Cargando...</span>
                </div>
                
                <div id="installationsTable" class="table-container">
                    <p class="loading">Cargando instalaciones...</p>
                </div>
            </div>
            
            <div id="incidentsSection" class="section">
                <div id="incidentsList" class="incidents-grid">
                    <p class="loading">Cargando incidencias...</p>
                </div>
            </div>
            
            <div id="auditSection" class="section">
                <div class="filters">
                    <select id="auditActionFilter">
                        <option value="">Todas las acciones</option>
                        <option value="web_login_success">✅ Login exitoso</option>
                        <option value="web_login_failed">❌ Login fallido</option>
                        <option value="create_web_user">👤 Crear usuario</option>
                        <option value="update_web_user">✏️ Actualizar usuario</option>
                        <option value="create_incident">⚠️ Crear incidencia</option>
                        <option value="create_installation">💻 Crear instalación</option>
                    </select>
                    <button id="refreshAudit" class="btn-secondary">🔄 Actualizar</button>
                </div>
                <div id="auditLogs" class="table-container">
                    <p class="loading">Cargando logs...</p>
                </div>
            </div>
        </main>
    </div>
    
    <div id="loginModal" class="modal">
        <div class="modal-content">
            <div class="login-header">
                <h2>🔐 Driver Manager</h2>
                <p>Iniciar Sesión</p>
            </div>
            <form id="loginForm">
                <div class="input-group">
                    <label for="loginUsername">Usuario</label>
                    <input type="text" id="loginUsername" placeholder="nombre_usuario" required>
                </div>
                <div class="input-group">
                    <label for="loginPassword">Contraseña</label>
                    <input type="password" id="loginPassword" placeholder="••••••••" required>
                </div>
                <button type="submit" class="btn-primary btn-full">Ingresar</button>
            </form>
            <p id="loginError" class="error"></p>
        </div>
    </div>
    
    <div id="photoModal" class="modal">
        <div class="modal-content photo-modal">
            <span class="close">&times;</span>
            <img id="photoViewer" src="" alt="Foto de incidencia">
        </div>
    </div>
    
    <script>
// Auto-detect API base URL - use current origin in production, or fallback to worker URL
const API_BASE = (() => {
    // If running on localhost, use the production worker URL
    if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
        return 'https://driver-manager-db.diegosasen.workers.dev';
    }
    // Otherwise use relative paths (same origin)
    return '';
})();

let authToken = localStorage.getItem('authToken');
let currentUser = null;
let charts = {};
let searchDebounceTimer = null;
let currentInstallationsData = [];

// WebSocket/SSE State
let eventSource = null;
let sseReconnectTimer = null;
let sseReconnectAttempts = 0;
const MAX_SSE_RECONNECT_ATTEMPTS = 5;
const SSE_RECONNECT_DELAY = 3000; // 3 seconds


// Chart.js default configuration
function isChartAvailable() {
    return typeof Chart !== 'undefined' && Chart && Chart.defaults;
}

function applyChartDefaults(theme = 'dark') {
    if (!isChartAvailable()) return;
    if (theme === 'light') {
        Chart.defaults.color = '#475569';
        Chart.defaults.borderColor = '#cbd5e1';
    } else {
        Chart.defaults.color = '#94a3b8';
        Chart.defaults.borderColor = '#334155';
    }
    Chart.defaults.font.family = "'Inter', system-ui, sans-serif";
}

applyChartDefaults('dark');

const api = {
    async request(endpoint, options = {}) {
        const headers = {
            'Content-Type': 'application/json',
            ...options.headers
        };
        
        if (authToken) {
            headers['Authorization'] = 'Bearer ' + authToken;
        }
        
        const response = await fetch(API_BASE + endpoint, {
            ...options,
            headers
        });
        
        if (response.status === 401) {
            showLogin();
            throw new Error('No autorizado');
        }
        
        return response.json();
    },
    
    getInstallations(params = {}) {
        const query = new URLSearchParams(params).toString();
        return this.request('/web/installations?' + query);
    },
    
    getStatistics() {
        return this.request('/web/statistics');
    },
    
    getAuditLogs(limit = 100) {
        return this.request('/web/audit-logs?limit=' + limit);
    },
    
    getIncidents(installationId) {
        return this.request('/web/installations/' + installationId + '/incidents');
    },
    
    getTrendData() {
        return this.request('/web/statistics/trend');
    },
    
    login(username, password) {
        return this.request('/web/auth/login', {
            method: 'POST',
            body: JSON.stringify({ username, password })
        });
    },
    
    getMe() {
        return this.request('/web/auth/me');
    }
};

function showLogin() {
    document.getElementById('loginModal').classList.add('active');
    document.body.style.overflow = 'hidden';
}

function hideLogin() {
    document.getElementById('loginModal').classList.remove('active');
    document.body.style.overflow = '';
    document.getElementById('loginError').textContent = '';
}

function updateStats(stats) {
    animateNumber('totalInstallations', stats.total_installations || 0);
    animateNumber('successRate', (stats.success_rate || 0) + '%');
    animateNumber('avgTime', (stats.average_time_minutes || 0) + ' min');
    animateNumber('uniqueClients', stats.unique_clients || 0);
}

function animateNumber(elementId, value) {
    const element = document.getElementById(elementId);
    element.style.opacity = '0';
    element.style.transform = 'translateY(10px)';
    
    setTimeout(() => {
        element.textContent = value;
        element.style.transition = 'all 0.3s ease';
        element.style.opacity = '1';
        element.style.transform = 'translateY(0)';
    }, 100);
}

// Chart rendering functions
function renderSuccessChart(stats) {
    if (!isChartAvailable()) return;
    const ctx = document.getElementById('successChart').getContext('2d');
    
    if (charts.success) {
        charts.success.destroy();
    }
    
    const success = stats.successful_installations || 0;
    const failed = stats.failed_installations || 0;
    const total = stats.total_installations || 1;
    const other = total - success - failed;
    
    charts.success = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: ['Éxito', 'Fallido', 'Otro'],
            datasets: [{
                data: [success, failed, Math.max(0, other)],
                backgroundColor: [
                    'rgba(16, 185, 129, 0.8)',
                    'rgba(239, 68, 68, 0.8)',
                    'rgba(148, 163, 184, 0.3)'
                ],
                borderColor: [
                    'rgba(16, 185, 129, 1)',
                    'rgba(239, 68, 68, 1)',
                    'rgba(148, 163, 184, 0.5)'
                ],
                borderWidth: 2,
                hoverOffset: 4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: {
                        padding: 15,
                        usePointStyle: true,
                        pointStyle: 'circle'
                    }
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            const label = context.label || '';
                            const value = context.parsed || 0;
                            const percentage = ((value / total) * 100).toFixed(1);
                            return \`\${label}: \${value} (\${percentage}%)\`;
                        }
                    }
                }
            },
            cutout: '65%'
        }
    });
}

function renderBrandChart(stats) {
    if (!isChartAvailable()) return;
    const ctx = document.getElementById('brandChart').getContext('2d');
    
    if (charts.brand) {
        charts.brand.destroy();
    }
    
    const brands = Object.entries(stats.by_brand || {})
        .sort((a, b) => b[1] - a[1])
        .slice(0, 6);
    
    if (brands.length === 0) {
        brands.push(['Sin datos', 1]);
    }
    
    const colors = [
        'rgba(6, 182, 212, 0.8)',
        'rgba(139, 92, 246, 0.8)',
        'rgba(16, 185, 129, 0.8)',
        'rgba(245, 158, 11, 0.8)',
        'rgba(239, 68, 68, 0.8)',
        'rgba(59, 130, 246, 0.8)'
    ];
    
    charts.brand = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: brands.map(b => b[0]),
            datasets: [{
                label: 'Instalaciones',
                data: brands.map(b => b[1]),
                backgroundColor: colors,
                borderColor: colors.map(c => c.replace('0.8', '1')),
                borderWidth: 2,
                borderRadius: 6,
                borderSkipped: false
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: false
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    grid: {
                        color: 'rgba(71, 85, 105, 0.3)'
                    },
                    ticks: {
                        precision: 0
                    }
                },
                x: {
                    grid: {
                        display: false
                    }
                }
            }
        }
    });
}

async function renderTrendChart() {
    if (!isChartAvailable()) return;
    const ctx = document.getElementById('trendChart').getContext('2d');
    
    if (charts.trend) {
        charts.trend.destroy();
    }
    
    try {
        // Generate last 7 days labels
        const labels = [];
        const data = [];
        const today = new Date();
        
        for (let i = 6; i >= 0; i--) {
            const date = new Date(today);
            date.setDate(date.getDate() - i);
            labels.push(date.toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric' }));
            data.push(Math.floor(Math.random() * 20) + 5); // Simulated data - replace with real API
        }
        
        charts.trend = new Chart(ctx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Instalaciones',
                    data: data,
                    borderColor: 'rgba(6, 182, 212, 1)',
                    backgroundColor: 'rgba(6, 182, 212, 0.1)',
                    borderWidth: 3,
                    fill: true,
                    tension: 0.4,
                    pointBackgroundColor: 'rgba(6, 182, 212, 1)',
                    pointBorderColor: '#fff',
                    pointBorderWidth: 2,
                    pointRadius: 5,
                    pointHoverRadius: 7
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: {
                    intersect: false,
                    mode: 'index'
                },
                plugins: {
                    legend: {
                        display: false
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        grid: {
                            color: 'rgba(71, 85, 105, 0.3)'
                        },
                        ticks: {
                            precision: 0
                        }
                    },
                    x: {
                        grid: {
                            display: false
                        }
                    }
                }
            }
        });
    } catch (err) {
        console.error('Error rendering trend chart:', err);
    }
}

async function loadDashboard() {
    try {
        const stats = await api.getStatistics();
        updateStats(stats);
        
        // Render charts
        renderSuccessChart(stats);
        renderBrandChart(stats);
        await renderTrendChart();
        
        const installations = await api.getInstallations({ limit: 5 });
        renderRecentInstallations(installations);
    } catch (err) {
        console.error('Error cargando dashboard:', err);
    }
}

function renderRecentInstallations(installations) {
    const container = document.getElementById('recentInstallations');
    if (!installations || !installations.length) {
        container.innerHTML = '<p class="loading">No hay instalaciones recientes</p>';
        return;
    }
    
    let html = '<table><thead><tr><th>ID</th><th>Cliente</th><th>Marca</th><th>Estado</th><th>Fecha</th></tr></thead><tbody>';
    
    installations.forEach(inst => {
        const statusClass = inst.status || 'unknown';
        const statusIcon = inst.status === 'success' ? '✅' : inst.status === 'failed' ? '❌' : '❓';
        
        html += '<tr>';
        html += '<td><strong>#' + inst.id + '</strong></td>';
        html += '<td>' + (inst.client_name || 'N/A') + '</td>';
        html += '<td>' + (inst.driver_brand || 'N/A') + '</td>';
        html += '<td><span class="badge ' + statusClass + '">' + statusIcon + ' ' + inst.status + '</span></td>';
        html += '<td>' + new Date(inst.timestamp).toLocaleString('es-ES') + '</td>';
        html += '</tr>';
    });
    
    html += '</tbody></table>';
    container.innerHTML = html;
}

// Advanced Filters Functions
function getActiveFilters() {
    const filters = {};
    
    const searchValue = document.getElementById('searchInput')?.value?.trim();
    const brandValue = document.getElementById('brandFilter')?.value;
    const statusValue = document.getElementById('statusFilter')?.value;
    const startDate = document.getElementById('startDate')?.value;
    const endDate = document.getElementById('endDate')?.value;
    
    if (searchValue) filters.search = searchValue;
    if (brandValue) filters.brand = brandValue;
    if (statusValue) filters.status = statusValue;
    if (startDate) filters.startDate = startDate;
    if (endDate) filters.endDate = endDate;
    
    return filters;
}

function updateFilterChips() {
    const chipsContainer = document.getElementById('filterChips');
    const clearBtn = document.getElementById('clearFilters');
    const filters = getActiveFilters();
    
    chipsContainer.innerHTML = '';
    let hasFilters = Object.keys(filters).length > 0;
    
    clearBtn.style.display = hasFilters ? 'inline-flex' : 'none';
    
    // Search chip
    if (filters.search) {
        chipsContainer.innerHTML += \`
            <span class="filter-chip">
                <span class="chip-label">🔍</span>
                <span class="chip-value">"\${filters.search}"</span>
                <span class="chip-remove" data-filter="search">×</span>
            </span>
        \`;
    }
    
    // Brand chip
    if (filters.brand) {
        chipsContainer.innerHTML += \`
            <span class="filter-chip">
                <span class="chip-label">🏷️ Marca:</span>
                <span class="chip-value">\${filters.brand}</span>
                <span class="chip-remove" data-filter="brand">×</span>
            </span>
        \`;
    }
    
    // Status chip
    if (filters.status) {
        const statusLabel = filters.status === 'success' ? '✅ Éxito' : 
                           filters.status === 'failed' ? '❌ Fallido' : '❓ Desconocido';
        chipsContainer.innerHTML += \`
            <span class="filter-chip">
                <span class="chip-label">📊 Estado:</span>
                <span class="chip-value">\${statusLabel}</span>
                <span class="chip-remove" data-filter="status">×</span>
            </span>
        \`;
    }
    
    // Date range chips
    if (filters.startDate || filters.endDate) {
        const dateLabel = filters.startDate && filters.endDate ? 
            \`\${filters.startDate} - \${filters.endDate}\` :
            filters.startDate ? \`Desde: \${filters.startDate}\` : \`Hasta: \${filters.endDate}\`;
        chipsContainer.innerHTML += \`
            <span class="filter-chip">
                <span class="chip-label">📅</span>
                <span class="chip-value">\${dateLabel}</span>
                <span class="chip-remove" data-filter="date">×</span>
            </span>
        \`;
    }
    
    // Add click handlers to remove buttons
    chipsContainer.querySelectorAll('.chip-remove').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const filterType = e.target.dataset.filter;
            removeFilter(filterType);
        });
    });
}

function removeFilter(filterType) {
    switch (filterType) {
        case 'search':
            document.getElementById('searchInput').value = '';
            break;
        case 'brand':
            document.getElementById('brandFilter').value = '';
            break;
        case 'status':
            document.getElementById('statusFilter').value = '';
            break;
        case 'date':
            document.getElementById('startDate').value = '';
            document.getElementById('endDate').value = '';
            break;
    }
    
    updateFilterChips();
    
    // Apply filters immediately when removing
    debouncedSearch();
}

function clearAllFilters() {
    document.getElementById('searchInput').value = '';
    document.getElementById('brandFilter').value = '';
    document.getElementById('statusFilter').value = '';
    document.getElementById('startDate').value = '';
    document.getElementById('endDate').value = '';
    
    updateFilterChips();
    debouncedSearch();
}

// Export Functions
function exportToCSV(data, filename = 'instalaciones.csv') {
    if (!data || !data.length) {
        showNotification('❌ No hay datos para exportar', 'error');
        return;
    }
    
    // CSV Headers
    const headers = ['ID', 'Cliente', 'Marca', 'Versión', 'Estado', 'Tiempo (s)', 'Notas', 'Fecha'];
    
    // Convert data to CSV rows
    const rows = data.map(inst => [
        inst.id,
        inst.client_name || 'N/A',
        inst.driver_brand || 'N/A',
        inst.driver_version || 'N/A',
        inst.status || 'unknown',
        inst.installation_time_seconds || 0,
        (inst.notes || '').replace(/"/g, '""'), // Escape quotes
        inst.timestamp
    ]);
    
    // Combine headers and rows
    const csvContent = [
        headers.join(','),
        ...rows.map(row => row.map(cell => \`"\${cell}"\`).join(','))
    ].join('\\n');
    
    // Create and download file
    const blob = new Blob(['\\ufeff' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    
    link.setAttribute('href', url);
    link.setAttribute('download', filename);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    
    showNotification(\`✅ Exportado: \${filename}\`, 'success');
}

function exportToExcel(data, filename = 'instalaciones.xls') {
    if (!data || !data.length) {
        showNotification('❌ No hay datos para exportar', 'error');
        return;
    }
    
    // Create HTML table for Excel
    let html = '<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">';
    html += '<head><meta charset="UTF-8"><style>th { background-color: #06b6d4; color: white; font-weight: bold; }</style></head>';
    html += '<body><table border="1">';
    
    // Headers
    html += '<tr>';
    ['ID', 'Cliente', 'Marca', 'Versión', 'Estado', 'Tiempo (s)', 'Notas', 'Fecha'].forEach(header => {
        html += \`<th>\${header}</th>\`;
    });
    html += '</tr>';
    
    // Data rows
    data.forEach(inst => {
        html += '<tr>';
        html += \`<td>\${inst.id}</td>\`;
        html += \`<td>\${inst.client_name || 'N/A'}</td>\`;
        html += \`<td>\${inst.driver_brand || 'N/A'}</td>\`;
        html += \`<td>\${inst.driver_version || 'N/A'}</td>\`;
        html += \`<td>\${inst.status || 'unknown'}</td>\`;
        html += \`<td>\${inst.installation_time_seconds || 0}</td>\`;
        html += \`<td>\${(inst.notes || '').substring(0, 100)}</td>\`;
        html += \`<td>\${inst.timestamp}</td>\`;
        html += '</tr>';
    });
    
    html += '</table></body></html>';
    
    // Create and download file
    const blob = new Blob([html], { type: 'application/vnd.ms-excel' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    
    link.setAttribute('href', url);
    link.setAttribute('download', filename);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    
    showNotification(\`✅ Exportado: \${filename}\`, 'success');
}

function setupExportButtons() {
    const exportBtn = document.getElementById('exportBtn');
    if (exportBtn) {
        // Replace single export button with dropdown
        const filterActions = document.querySelector('.filter-actions');
        
        // Create export dropdown
        const exportDropdown = document.createElement('div');
        exportDropdown.className = 'export-dropdown';
        exportDropdown.style.cssText = 'position: relative; display: inline-block;';
        
        exportDropdown.innerHTML = \`
            <button id="exportBtn" class="btn-secondary">📥 Exportar ▼</button>
            <div class="export-menu" style="
                display: none;
                position: absolute;
                right: 0;
                top: 100%;
                margin-top: 0.5rem;
                background: var(--bg-secondary);
                border: 1px solid var(--border);
                border-radius: var(--radius-sm);
                box-shadow: var(--shadow-lg);
                z-index: 100;
                min-width: 160px;
            ">
                <button class="export-option" data-format="csv" style="
                    display: flex;
                    align-items: center;
                    gap: 0.5rem;
                    width: 100%;
                    padding: 0.75rem 1rem;
                    background: none;
                    border: none;
                    color: var(--text-primary);
                    cursor: pointer;
                    font-size: 0.875rem;
                    text-align: left;
                ">📄 Exportar CSV</button>
                <button class="export-option" data-format="excel" style="
                    display: flex;
                    align-items: center;
                    gap: 0.5rem;
                    width: 100%;
                    padding: 0.75rem 1rem;
                    background: none;
                    border: none;
                    color: var(--text-primary);
                    cursor: pointer;
                    font-size: 0.875rem;
                    text-align: left;
                    border-top: 1px solid var(--border);
                ">📊 Exportar Excel</button>
            </div>
        \`;
        
        // Replace old button
        exportBtn.replaceWith(exportDropdown);
        
        // Toggle menu
        const btn = exportDropdown.querySelector('#exportBtn');
        const menu = exportDropdown.querySelector('.export-menu');
        
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            menu.style.display = menu.style.display === 'none' ? 'block' : 'none';
        });
        
        // Close on outside click
        document.addEventListener('click', () => {
            menu.style.display = 'none';
        });
        
        // Export options
        exportDropdown.querySelectorAll('.export-option').forEach(option => {
            option.addEventListener('click', () => {
                const format = option.dataset.format;
                if (format === 'csv') {
                    exportToCSV(currentInstallationsData);
                } else if (format === 'excel') {
                    exportToExcel(currentInstallationsData);
                }
                menu.style.display = 'none';
            });
            
            // Hover effect
            option.addEventListener('mouseenter', () => {
                option.style.background = 'var(--bg-hover)';
            });
            option.addEventListener('mouseleave', () => {
                option.style.background = 'none';
            });
        });
    }
}


function debouncedSearch() {
    const searchInput = document.getElementById('searchInput');
    if (searchInput) {
        searchInput.classList.add('loading');
    }
    
    // Clear previous timer
    if (searchDebounceTimer) {
        clearTimeout(searchDebounceTimer);
    }
    
    // Set new timer - 300ms delay for real-time search
    searchDebounceTimer = setTimeout(() => {
        loadInstallations();
        if (searchInput) {
            searchInput.classList.remove('loading');
        }
    }, 300);
}

function setupAdvancedFilters() {
    // Real-time search input
    const searchInput = document.getElementById('searchInput');
    if (searchInput) {
        searchInput.addEventListener('input', () => {
            updateFilterChips();
            debouncedSearch();
        });
        
        // Enter key triggers immediate search
        searchInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                if (searchDebounceTimer) {
                    clearTimeout(searchDebounceTimer);
                }
                loadInstallations();
            }
        });
    }
    
    // Filter change handlers
    const brandFilter = document.getElementById('brandFilter');
    const statusFilter = document.getElementById('statusFilter');
    const startDate = document.getElementById('startDate');
    const endDate = document.getElementById('endDate');
    
    if (brandFilter) {
        brandFilter.addEventListener('change', () => {
            updateFilterChips();
            debouncedSearch();
        });
    }
    
    if (statusFilter) {
        statusFilter.addEventListener('change', () => {
            updateFilterChips();
            debouncedSearch();
        });
    }
    
    if (startDate) {
        startDate.addEventListener('change', () => {
            updateFilterChips();
            debouncedSearch();
        });
    }
    
    if (endDate) {
        endDate.addEventListener('change', () => {
            updateFilterChips();
            debouncedSearch();
        });
    }
    
    // Clear filters button
    const clearBtn = document.getElementById('clearFilters');
    if (clearBtn) {
        clearBtn.addEventListener('click', clearAllFilters);
    }
    
    // Keyboard shortcut: Ctrl+K to focus search
    document.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
            e.preventDefault();
            const searchInput = document.getElementById('searchInput');
            if (searchInput) {
                searchInput.focus();
                searchInput.select();
            }
        }
    });
}

async function loadInstallations() {
    const container = document.getElementById('installationsTable');
    const resultsCount = document.getElementById('resultsCount');
    container.innerHTML = '<p class="loading">Cargando...</p>';
    
    if (resultsCount) {
        resultsCount.innerHTML = '<span class="loading">Buscando...</span>';
    }
    
    try {
        const filters = getActiveFilters();
        
        const params = {
            client_name: filters.search || '', // Use search for client_name
            brand: filters.brand || '',
            status: filters.status || '',
            start_date: filters.startDate || '',
            end_date: filters.endDate || '',
            limit: 50
        };
        
        const installations = await api.getInstallations(params);
        currentInstallationsData = installations || [];
        renderInstallationsTable(installations);
        
        // Update results count
        if (resultsCount) {
            const count = installations?.length || 0;
            resultsCount.innerHTML = \`Mostrando <span class="count">\${count}</span> resultado\${count !== 1 ? 's' : ''}\`;
        }
        
        // Update filter chips (in case they were cleared externally)
        updateFilterChips();
    } catch (err) {
        container.innerHTML = '<p class="error">❌ Error cargando instalaciones</p>';
        if (resultsCount) {
            resultsCount.textContent = 'Error al cargar';
        }
    }
}


function renderInstallationsTable(installations) {
    const container = document.getElementById('installationsTable');
    if (!installations || !installations.length) {
        container.innerHTML = '<p class="loading">No se encontraron instalaciones</p>';
        return;
    }
    
    let html = '<table><thead><tr><th>ID</th><th>Cliente</th><th>Marca</th><th>Versión</th><th>Estado</th><th>Tiempo</th><th>Notas</th><th>Fecha</th></tr></thead><tbody>';
    
    installations.forEach(inst => {
        const statusClass = inst.status || 'unknown';
        const statusIcon = inst.status === 'success' ? '✅' : inst.status === 'failed' ? '❌' : '❓';
        
        html += '<tr data-id="' + inst.id + '">';
        html += '<td><strong>#' + inst.id + '</strong></td>';
        html += '<td>' + (inst.client_name || 'N/A') + '</td>';
        html += '<td>' + (inst.driver_brand || 'N/A') + '</td>';
        html += '<td>' + (inst.driver_version || 'N/A') + '</td>';
        html += '<td><span class="badge ' + statusClass + '">' + statusIcon + ' ' + inst.status + '</span></td>';
        html += '<td>' + inst.installation_time_seconds + 's</td>';
        html += '<td>' + (inst.notes ? inst.notes.substring(0, 30) + '...' : '-') + '</td>';
        html += '<td>' + new Date(inst.timestamp).toLocaleString('es-ES') + '</td>';
        html += '</tr>';
    });
    
    html += '</tbody></table>';
    container.innerHTML = html;
    
    container.querySelectorAll('tr[data-id]').forEach(row => {
        row.addEventListener('click', () => {
            const id = row.dataset.id;
            showIncidentsForInstallation(id);
        });
    });
}

async function showIncidentsForInstallation(installationId) {
    const container = document.getElementById('incidentsList');
    document.querySelector('[data-section="incidents"]').click();
    container.innerHTML = '<p class="loading">Cargando incidencias...</p>';
    
    try {
        const data = await api.getIncidents(installationId);
        renderIncidents(data.incidents || [], installationId);
    } catch (err) {
        container.innerHTML = '<p class="error">❌ Error cargando incidencias</p>';
    }
}

async function loadPhotoWithAuth(photoId) {
    try {
        const headers = {};
        if (authToken) {
            headers['Authorization'] = 'Bearer ' + authToken;
        }
        const response = await fetch(API_BASE + '/web/photos/' + photoId, { headers });
        if (!response.ok) throw new Error('Failed to load photo');
        const blob = await response.blob();
        return URL.createObjectURL(blob);
    } catch (err) {
        console.error('Error loading photo:', err);
        return '';
    }
}

async function renderIncidents(incidents, installationId) {
    const container = document.getElementById('incidentsList');
    
    let html = '<div class="incidents-header" style="margin-bottom: 1.5rem;">';
    html += '<h3>⚠️ Incidencias de Instalación #' + installationId + '</h3>';
    html += '<button onclick="document.querySelector(\\'[data-section=\\\\\\'installations\\\\\\']\\').click()" class="btn-secondary">← Volver</button>';
    html += '</div>';
    
    if (!incidents || !incidents.length) {
        html += '<p class="loading">No hay incidencias para esta instalación</p>';
        container.innerHTML = html;
        return;
    }
    
    for (const inc of incidents) {
        const severityIcon = inc.severity === 'critical' ? '🔴' : inc.severity === 'high' ? '🟠' : inc.severity === 'medium' ? '🟡' : '🔵';
        
        html += '<div class="incident-card">';
        html += '<div class="incident-header">';
        html += '<div><span class="badge ' + inc.severity + '">' + severityIcon + ' ' + inc.severity + '</span> <small>por <strong>' + inc.reporter_username + '</strong></small></div>';
        html += '<small>🕐 ' + new Date(inc.created_at).toLocaleString('es-ES') + '</small>';
        html += '</div>';
        html += '<p style="color: var(--text-secondary); line-height: 1.6;">' + inc.note + '</p>';
        
        if (inc.photos && inc.photos.length) {
            html += '<div class="photos-grid">';
            for (const photo of inc.photos) {
                const photoUrl = await loadPhotoWithAuth(photo.id);
                if (photoUrl) {
                    html += '<img src="' + photoUrl + '" class="photo-thumb" onclick="viewPhoto(' + photo.id + ')" data-photo-id="' + photo.id + '" alt="Foto de incidencia">';
                }
            }
            html += '</div>';
        }
        
        html += '</div>';
    }
    
    container.innerHTML = html;
}

async function viewPhoto(photoId) {
    const modal = document.getElementById('photoModal');
    const img = document.getElementById('photoViewer');
    const photoUrl = await loadPhotoWithAuth(photoId);
    if (photoUrl) {
        img.src = photoUrl;
        modal.classList.add('active');
    }
}

async function loadAuditLogs() {
    const container = document.getElementById('auditLogs');
    container.innerHTML = '<p class="loading">Cargando logs...</p>';
    
    try {
        const logs = await api.getAuditLogs();
        renderAuditLogs(logs);
    } catch (err) {
        container.innerHTML = '<p class="error">❌ Error cargando logs</p>';
    }
}

function renderAuditLogs(logs) {
    const container = document.getElementById('auditLogs');
    const actionFilter = document.getElementById('auditActionFilter')?.value;
    
    if (!logs || !logs.length) {
        container.innerHTML = '<p class="loading">No hay logs de auditoría</p>';
        return;
    }
    
    let filteredLogs = logs;
    if (actionFilter) {
        filteredLogs = logs.filter(log => log.action === actionFilter);
    }
    
    if (filteredLogs.length === 0) {
        container.innerHTML = '<p class="loading">No hay logs para el filtro seleccionado</p>';
        return;
    }
    
    let html = '<table><thead><tr><th>🕐 Fecha</th><th>📝 Acción</th><th>👤 Usuario</th><th>✅ Estado</th><th>💻 Detalles</th></tr></thead><tbody>';
    
    filteredLogs.forEach(log => {
        const successIcon = log.success ? '✅' : '❌';
        const successClass = log.success ? 'success' : 'failed';
        
        let details = '-';
        if (log.details) {
            try {
                const parsed = typeof log.details === 'string' ? JSON.parse(log.details) : log.details;
                details = Object.entries(parsed)
                    .map(([k, v]) => \`\${k}: \${v}\`)
                    .slice(0, 2)
                    .join(', ');
                if (details.length > 50) details = details.substring(0, 50) + '...';
            } catch {
                details = String(log.details).substring(0, 50);
            }
        }
        
        html += '<tr>';
        html += '<td>' + new Date(log.timestamp).toLocaleString('es-ES') + '</td>';
        html += '<td><code style="background: var(--bg-card); padding: 0.25rem 0.5rem; border-radius: 4px; font-size: 0.75rem;">' + log.action + '</code></td>';
        html += '<td><strong>' + log.username + '</strong></td>';
        html += '<td><span class="badge ' + successClass + '">' + successIcon + '</span></td>';
        html += '<td style="color: var(--text-secondary); font-size: 0.875rem;">' + details + '</td>';
        html += '</tr>';
    });
    
    html += '</tbody></table>';
    container.innerHTML = html;
}

// Event Listeners
document.getElementById('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = document.getElementById('loginUsername').value;
    const password = document.getElementById('loginPassword').value;
    
    try {
        const result = await api.login(username, password);
        authToken = result.access_token;
        currentUser = result.user;
        localStorage.setItem('authToken', authToken);
        
        document.getElementById('username').textContent = result.user.username;
        document.getElementById('userRole').textContent = result.user.role;
        
        hideLogin();
        loadDashboard();
        
        // Show success notification
        showNotification('✅ Bienvenido, ' + result.user.username + '!', 'success');
    } catch (err) {
        document.getElementById('loginError').textContent = '❌ Credenciales inválidas';
        document.getElementById('loginPassword').value = '';
    }
});

document.getElementById('logoutBtn').addEventListener('click', () => {
    authToken = null;
    currentUser = null;
    localStorage.removeItem('authToken');
    showLogin();
    showNotification('👋 Sesión cerrada', 'info');
});

document.getElementById('refreshBtn').addEventListener('click', () => {
    const btn = document.getElementById('refreshBtn');
    btn.style.transform = 'rotate(360deg)';
    btn.style.transition = 'transform 0.5s ease';
    
    setTimeout(() => {
        btn.style.transform = '';
        btn.style.transition = '';
    }, 500);
    
    loadDashboard();
    showNotification('🔄 Dashboard actualizado', 'info');
});

document.querySelectorAll('.nav-links a').forEach(link => {
    link.addEventListener('click', (e) => {
        e.preventDefault();
        const section = link.dataset.section;
        
        document.querySelectorAll('.nav-links a').forEach(l => l.classList.remove('active'));
        link.classList.add('active');
        
        document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
        document.getElementById(section + 'Section').classList.add('active');
        
        const titles = {
            dashboard: '📈 Dashboard',
            installations: '💻 Instalaciones',
            incidents: '⚠️ Incidencias',
            audit: '📋 Auditoría'
        };
        document.getElementById('pageTitle').textContent = titles[section] || 'Dashboard';
        
        if (section === 'installations') loadInstallations();
        if (section === 'audit') loadAuditLogs();
    });
});

document.getElementById('applyFilters').addEventListener('click', () => {
    updateFilterChips();
    loadInstallations();
});


document.getElementById('refreshAudit').addEventListener('click', loadAuditLogs);

document.getElementById('auditActionFilter').addEventListener('change', () => {
    loadAuditLogs();
});

document.querySelector('#photoModal .close').addEventListener('click', () => {
    document.getElementById('photoModal').classList.remove('active');
});

// Close modal on outside click
document.getElementById('photoModal').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) {
        document.getElementById('photoModal').classList.remove('active');
    }
});

// Keyboard shortcuts
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        document.getElementById('photoModal').classList.remove('active');
    }
    if (e.ctrlKey && e.key === 'r') {
        e.preventDefault();
        loadDashboard();
    }
});

// Notification system
function showNotification(message, type = 'info') {
    const notification = document.createElement('div');
    notification.style.cssText = \`
        position: fixed;
        top: 1rem;
        right: 1rem;
        padding: 1rem 1.5rem;
        background: \${type === 'success' ? 'rgba(16, 185, 129, 0.9)' : type === 'error' ? 'rgba(239, 68, 68, 0.9)' : 'rgba(6, 182, 212, 0.9)'};
        color: white;
        border-radius: 12px;
        box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.3);
        z-index: 9999;
        font-weight: 500;
        animation: slideIn 0.3s ease;
    \`;
    notification.textContent = message;
    
    document.body.appendChild(notification);
    
    setTimeout(() => {
        notification.style.animation = 'slideOut 0.3s ease';
        setTimeout(() => notification.remove(), 300);
    }, 3000);
}

// Add animation styles
const style = document.createElement('style');
style.textContent = \`
    @keyframes slideIn {
        from { transform: translateX(100%); opacity: 0; }
        to { transform: translateX(0); opacity: 1; }
    }
    @keyframes slideOut {
        from { transform: translateX(0); opacity: 1; }
        to { transform: translateX(100%); opacity: 0; }
    }
\`;
document.head.appendChild(style);

// WebSocket/SSE Functions
function initSSE() {
    if (!authToken) return;
    if (eventSource) {
        eventSource.close();
    }

    try {
        // Use EventSource for Server-Sent Events
        const sseUrl = \`\${API_BASE}/web/events?token=\${encodeURIComponent(authToken)}\`;
        eventSource = new EventSource(sseUrl);

        eventSource.onopen = () => {
            console.log('[SSE] Connection established');
            sseReconnectAttempts = 0;
            updateConnectionStatus('connected');
        };

        eventSource.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                handleSSEMessage(data);
            } catch (err) {
                console.error('[SSE] Error parsing message:', err);
            }
        };

        eventSource.onerror = (err) => {
            console.error('[SSE] Connection error:', err);
            updateConnectionStatus('disconnected');
            
            // Auto-reconnect logic
            if (sseReconnectAttempts < MAX_SSE_RECONNECT_ATTEMPTS) {
                sseReconnectAttempts++;
                console.log(\`[SSE] Reconnecting... Attempt \${sseReconnectAttempts}/\${MAX_SSE_RECONNECT_ATTEMPTS}\`);
                updateConnectionStatus('reconnecting');
                
                if (sseReconnectTimer) clearTimeout(sseReconnectTimer);
                sseReconnectTimer = setTimeout(() => {
                    initSSE();
                }, SSE_RECONNECT_DELAY * sseReconnectAttempts); // Exponential backoff
            } else {
                console.error('[SSE] Max reconnection attempts reached');
                updateConnectionStatus('failed');
                showNotification('⚠️ Conexión en tiempo real perdida. Recarga la página para reconectar.', 'error');
            }
        };

    } catch (err) {
        console.error('[SSE] Error initializing:', err);
    }
}

function handleSSEMessage(data) {
    switch (data.type) {
        case 'connected':
            console.log('[SSE]', data.message);
            showNotification('🔌 Conectado en tiempo real', 'success');
            break;
            
        case 'installation_created':
            handleRealtimeInstallation(data.installation);
            break;
            
        case 'installation_updated':
            handleRealtimeInstallationUpdate(data.installation);
            break;
            
        case 'incident_created':
            handleRealtimeIncident(data.incident);
            break;
            
        case 'stats_update':
            handleRealtimeStatsUpdate(data.statistics);
            break;
            
        case 'reconnect':
            console.log('[SSE] Server requested reconnect');
            eventSource.close();
            setTimeout(initSSE, 1000);
            break;
            
        case 'ping':
            // Keep-alive, no action needed
            break;
            
        default:
            console.log('[SSE] Unknown message type:', data.type);
    }
}

function handleRealtimeInstallation(installation) {
    // Add to current data if on installations page
    if (currentInstallationsData && document.getElementById('installationsSection')?.classList.contains('active')) {
        currentInstallationsData.unshift(installation);
        renderInstallationsTable(currentInstallationsData.slice(0, 50));
        
        // Update results count
        const resultsCount = document.getElementById('resultsCount');
        if (resultsCount) {
            const count = currentInstallationsData.length;
            resultsCount.innerHTML = \`Mostrando <span class="count">\${Math.min(count, 50)}</span> de <span class="count">\${count}</span> resultado\${count !== 1 ? 's' : ''}\`;
        }
    }
    
    // Show notification
    const statusIcon = installation.status === 'success' ? '✅' : installation.status === 'failed' ? '❌' : '💻';
    showNotification(\`\${statusIcon} Nueva instalación: \${installation.client_name || 'Sin cliente'}\`, 'info');
    
    // Refresh dashboard stats if on dashboard
    if (document.getElementById('dashboardSection')?.classList.contains('active')) {
        setTimeout(() => {
            loadDashboard();
        }, 1000);
    }
}

function handleRealtimeInstallationUpdate(installation) {
    // Update in current data if present
    if (currentInstallationsData) {
        const index = currentInstallationsData.findIndex(i => i.id === installation.id);
        if (index !== -1) {
            currentInstallationsData[index] = installation;
            if (document.getElementById('installationsSection')?.classList.contains('active')) {
                renderInstallationsTable(currentInstallationsData);
            }
        }
    }
}

function handleRealtimeIncident(incident) {
    const severityIcon = incident.severity === 'critical' ? '🔴' : incident.severity === 'high' ? '🟠' : '⚠️';
    showNotification(\`\${severityIcon} Nueva incidencia en instalación #\${incident.installation_id}\`, 'warning');
}

function handleRealtimeStatsUpdate(stats) {
    if (document.getElementById('dashboardSection')?.classList.contains('active')) {
        updateStats(stats);
        // Refresh charts with animation
        renderSuccessChart(stats);
        renderBrandChart(stats);
    }
}

function updateConnectionStatus(status) {
    // Remove existing status indicators
    const existingIndicator = document.getElementById('connectionStatus');
    if (existingIndicator) {
        existingIndicator.remove();
    }
    
    // Create new indicator
    const indicator = document.createElement('div');
    indicator.id = 'connectionStatus';
    
    const statusConfig = {
        connected: { icon: '🟢', text: 'En vivo', color: 'rgba(16, 185, 129, 0.9)' },
        disconnected: { icon: '🔴', text: 'Desconectado', color: 'rgba(239, 68, 68, 0.9)' },
        reconnecting: { icon: '🟡', text: 'Reconectando...', color: 'rgba(245, 158, 11, 0.9)' },
        failed: { icon: '⚫', text: 'Error de conexión', color: 'rgba(148, 163, 184, 0.9)' }
    };
    
    const config = statusConfig[status] || statusConfig.disconnected;
    
    indicator.style.cssText = \`
        position: fixed;
        bottom: 1rem;
        right: 1rem;
        padding: 0.5rem 1rem;
        background: \${config.color};
        color: white;
        border-radius: 9999px;
        font-size: 0.75rem;
        font-weight: 600;
        display: flex;
        align-items: center;
        gap: 0.5rem;
        z-index: 9998;
        box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.3);
        transition: all 0.3s ease;
        cursor: pointer;
    \`;
    indicator.innerHTML = \`<span>\${config.icon}</span><span>\${config.text}</span>\`;
    
    // Click to reconnect if disconnected
    if (status === 'disconnected' || status === 'failed') {
        indicator.addEventListener('click', () => {
            showNotification('🔄 Intentando reconectar...', 'info');
            sseReconnectAttempts = 0;
            initSSE();
        });
        indicator.style.cursor = 'pointer';
        indicator.title = 'Click para reconectar';
    }
    
    document.body.appendChild(indicator);
    
    // Auto-hide after 5 seconds if connected
    if (status === 'connected') {
        setTimeout(() => {
            if (indicator.parentNode) {
                indicator.style.opacity = '0.6';
                indicator.style.transform = 'scale(0.9)';
            }
        }, 5000);
    }
}

function closeSSE() {
    if (eventSource) {
        eventSource.close();
        eventSource = null;
    }
    if (sseReconnectTimer) {
        clearTimeout(sseReconnectTimer);
        sseReconnectTimer = null;
    }
    const indicator = document.getElementById('connectionStatus');
    if (indicator) {
        indicator.remove();
    }
}

// Initialize
async function init() {
    if (!authToken) {
        showLogin();
    } else {
        try {
            const me = await api.getMe();
            currentUser = me;
            document.getElementById('username').textContent = me.username || 'Usuario';
            document.getElementById('userRole').textContent = me.role || 'admin';
            loadDashboard();
            
            // Initialize SSE connection for real-time updates
            initSSE();
        } catch (err) {
            console.error('Error validating session:', err);
            showLogin();
        }
    }
    
    // Setup advanced filters
    setupAdvancedFilters();
    
    // Setup export buttons
    setupExportButtons();
    
    // Setup theme toggle
    setupThemeToggle();
    
    // Handle page visibility changes to reconnect SSE
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible' && authToken && !eventSource) {
            console.log('[SSE] Page visible, reconnecting...');
            initSSE();
        }
    });
    
    // Close SSE on page unload
    window.addEventListener('beforeunload', closeSSE);
}


// Theme Management Functions
function getCurrentTheme() {
    // Check localStorage first, then system preference, default to dark
    const savedTheme = localStorage.getItem('theme');
    if (savedTheme) {
        return savedTheme;
    }
    
    // Check system preference
    if (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) {
        return 'light';
    }
    
    return 'dark';
}

function setTheme(theme) {
    const html = document.documentElement;
    
    if (theme === 'light') {
        html.setAttribute('data-theme', 'light');
    } else {
        html.removeAttribute('data-theme');
    }
    
    // Save to localStorage
    localStorage.setItem('theme', theme);
    
    // Update Chart.js colors if charts exist
    updateChartTheme(theme);
}

function toggleTheme() {
    const currentTheme = getCurrentTheme();
    const newTheme = currentTheme === 'light' ? 'dark' : 'light';
    setTheme(newTheme);
    
    // Show notification
    const themeLabel = newTheme === 'light' ? 'claro' : 'oscuro';
    showNotification(\`🎨 Tema \${themeLabel} activado\`, 'info');
}

function updateChartTheme(theme) {
    if (!isChartAvailable()) return;
    applyChartDefaults(theme);
    
    // Update existing charts if they exist
    Object.values(charts).forEach(chart => {
        if (chart) {
            chart.update();
        }
    });
}

function setupThemeToggle() {
    const themeToggle = document.getElementById('themeToggle');
    if (themeToggle) {
        // Set initial theme
        const currentTheme = getCurrentTheme();
        setTheme(currentTheme);
        
        // Add click handler
        themeToggle.addEventListener('click', toggleTheme);
    }
    
    // Listen for system theme changes
    if (window.matchMedia) {
        const mediaQuery = window.matchMedia('(prefers-color-scheme: light)');
        mediaQuery.addEventListener('change', (e) => {
            // Only auto-switch if user hasn't manually set a preference
            if (!localStorage.getItem('theme')) {
                setTheme(e.matches ? 'light' : 'dark');
            }
        });
    }
}

init();

</script>
    
    <!-- PWA Service Worker Registration -->
    <script>
        if ('serviceWorker' in navigator) {
            window.addEventListener('load', () => {
                navigator.serviceWorker.register('/sw.js')
                    .then((registration) => {
                        console.log('[PWA] Service Worker registered:', registration.scope);
                        
                        // Check for updates
                        registration.addEventListener('updatefound', () => {
                            const newWorker = registration.installing;
                            newWorker.addEventListener('statechange', () => {
                                if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                                    // New version available
                                    showNotification('🔄 Nueva versión disponible. Recarga para actualizar.', 'info');
                                }
                            });
                        });
                    })
                    .catch((err) => {
                        console.error('[PWA] Service Worker registration failed:', err);
                    });
                
                // Listen for messages from service worker
                navigator.serviceWorker.addEventListener('message', (event) => {
                    if (event.data === 'update-available') {
                        showNotification('🔄 Nueva versión disponible. Recarga para actualizar.', 'info');
                    }
                });
            });
        }
        
        // PWA Install Prompt
        let deferredPrompt;
        window.addEventListener('beforeinstallprompt', (e) => {
            e.preventDefault();
            deferredPrompt = e;
            console.log('[PWA] Install prompt available');
        });
        
        // Check if app is installed
        window.addEventListener('appinstalled', () => {
            console.log('[PWA] App installed');
            deferredPrompt = null;
            showNotification('✅ App instalada correctamente', 'success');
        });
    </script>
</body>
</html>
`;
        
        return new Response(html, {
          status: 200,
          headers: {
            ...corsHeaders(request, env, corsPolicy),
            "Content-Type": "text/html",
          },
        });
      }

      if (routeParts.length === 1 && routeParts[0] === "dashboard.css" && request.method === "GET") {
        return new Response("", {
          status: 200,
          headers: {
            ...corsHeaders(request, env, corsPolicy),
            "Content-Type": "text/css",
          },
        });
      }

      if (routeParts.length === 1 && routeParts[0] === "dashboard.js" && request.method === "GET") {
        return new Response("", {
          status: 200,
          headers: {
            ...corsHeaders(request, env, corsPolicy),
            "Content-Type": "application/javascript",
          },
        });
      }

      // PWA manifest.json
      if (routeParts.length === 1 && routeParts[0] === "manifest.json" && request.method === "GET") {
        const manifest = {
          "name": "Driver Manager Dashboard",
          "short_name": "Driver Manager",
          "description": "Dashboard de gestión de instalaciones de drivers",
          "start_url": "/web/dashboard",
          "display": "standalone",
          "background_color": "#0f172a",
          "theme_color": "#06b6d4",
          "orientation": "any",
          "scope": "/",
          "icons": [
            {
              "src": "/icons/icon-72x72.png",
              "sizes": "72x72",
              "type": "image/png",
              "purpose": "maskable any"
            },
            {
              "src": "/icons/icon-96x96.png",
              "sizes": "96x96",
              "type": "image/png",
              "purpose": "maskable any"
            },
            {
              "src": "/icons/icon-128x128.png",
              "sizes": "128x128",
              "type": "image/png",
              "purpose": "maskable any"
            },
            {
              "src": "/icons/icon-144x144.png",
              "sizes": "144x144",
              "type": "image/png",
              "purpose": "maskable any"
            },
            {
              "src": "/icons/icon-152x152.png",
              "sizes": "152x152",
              "type": "image/png",
              "purpose": "maskable any"
            },
            {
              "src": "/icons/icon-192x192.png",
              "sizes": "192x192",
              "type": "image/png",
              "purpose": "maskable any"
            },
            {
              "src": "/icons/icon-384x384.png",
              "sizes": "384x384",
              "type": "image/png",
              "purpose": "maskable any"
            },
            {
              "src": "/icons/icon-512x512.png",
              "sizes": "512x512",
              "type": "image/png",
              "purpose": "maskable any"
            }
          ],
          "categories": ["business", "productivity", "utilities"],
          "lang": "es",
          "dir": "ltr"
        };
        
        return new Response(JSON.stringify(manifest), {
          status: 200,
          headers: {
            ...corsHeaders(request, env, corsPolicy),
            "Content-Type": "application/manifest+json",
            "Cache-Control": "public, max-age=3600",
          },
        });
      }

      // SSE endpoint for real-time updates
      if (routeParts.length === 1 && routeParts[0] === "events" && request.method === "GET") {
        // Verify authentication
        try {
          await verifyWebAccessToken(request, env);
        } catch (err) {
          return jsonResponse(request, env, corsPolicy,{ error: "Unauthorized" }, 401);
        }

        const encoder = new TextEncoder();
        let closed = false;

        const stream = new ReadableStream({
          start(controller) {
            // Send initial connection message
            const data = {
              type: "connected",
              message: "Conexión en tiempo real establecida",
              timestamp: nowIso()
            };
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));

            // Keep connection alive with ping every 30 seconds
            const keepAlive = setInterval(() => {
              if (closed) {
                clearInterval(keepAlive);
                return;
              }
              try {
                controller.enqueue(encoder.encode(`:ping\n\n`));
              } catch {
                clearInterval(keepAlive);
              }
            }, 30000);

            // Close after 5 minutes (clients should reconnect)
            setTimeout(() => {
              if (!closed) {
                closed = true;
                try {
                  const data = {
                    type: "reconnect",
                    message: "Reconexión requerida",
                    timestamp: nowIso()
                  };
                  controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
                  controller.close();
                } catch {}
              }
            }, 5 * 60 * 1000);
          },
          cancel() {
            closed = true;
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

      // PWA Service Worker
      if (routeParts.length === 1 && routeParts[0] === "sw.js" && request.method === "GET") {

        const swCode = `// Service Worker for Driver Manager Dashboard PWA
const CACHE_NAME = 'driver-manager-v3';
const STATIC_ASSETS = [
  '/web/dashboard',
  '/dashboard.css',
  '/dashboard.js',
  '/manifest.json'
];

self.addEventListener('install', (event) => {
  console.log('[SW] Installing service worker...');
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('[SW] Caching static assets');
        return cache.addAll(STATIC_ASSETS);
      })
      .then(() => self.skipWaiting())
      .catch((err) => console.error('[SW] Error caching assets:', err))
  );
});

self.addEventListener('activate', (event) => {
  console.log('[SW] Activating service worker...');
  event.waitUntil(
    caches.keys()
      .then((cacheNames) => {
        return Promise.all(
          cacheNames
            .filter((name) => name !== CACHE_NAME)
            .map((name) => caches.delete(name))
        );
      })
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  
  if (request.method !== 'GET') return;
  if (url.pathname.startsWith('/web/') && 
      !url.pathname.includes('/dashboard') &&
      !url.pathname.includes('.css') &&
      !url.pathname.includes('.js')) return;
  if (!url.origin.includes(self.location.origin)) return;
  
  event.respondWith(
    caches.match(request)
      .then((cachedResponse) => {
        if (cachedResponse) {
          fetch(request)
            .then((networkResponse) => {
              if (networkResponse && networkResponse.status === 200) {
                caches.open(CACHE_NAME)
                  .then((cache) => cache.put(request, networkResponse.clone()));
              }
            })
            .catch(() => {});
          return cachedResponse;
        }
        
        return fetch(request)
          .then((networkResponse) => {
            if (!networkResponse || networkResponse.status !== 200) {
              return networkResponse;
            }
            const responseToCache = networkResponse.clone();
            caches.open(CACHE_NAME)
              .then((cache) => cache.put(request, responseToCache));
            return networkResponse;
          })
          .catch((err) => {
            if (request.mode === 'navigate') {
              return caches.match('/web/dashboard');
            }
            throw err;
          });
      })
  );
});

self.addEventListener('push', (event) => {
  if (event.data) {
    const data = event.data.json();
    const options = {
      body: data.body || 'Nueva actualización disponible',
      icon: '/icons/icon-192x192.png',
      badge: '/icons/icon-72x72.png',
      tag: data.tag || 'default',
      requireInteraction: true,
      actions: [
        { action: 'open', title: 'Abrir' },
        { action: 'close', title: 'Cerrar' }
      ]
    };
    event.waitUntil(
      self.registration.showNotification(data.title || 'Driver Manager', options)
    );
  }
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  if (event.action === 'open' || !event.action) {
    event.waitUntil(clients.openWindow('/web/dashboard'));
  }
});

console.log('[SW] Service Worker loaded');`;
        
        return new Response(swCode, {
          status: 200,
          headers: {
            ...corsHeaders(request, env, corsPolicy),
            "Content-Type": "application/javascript",
            "Cache-Control": "public, max-age=3600",
          },
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

      if (routeParts.length === 1 && routeParts[0] === "installations") {
        if (request.method === "GET") {
          const { results } = await env.DB.prepare(
            "SELECT * FROM installations ORDER BY timestamp DESC",
          ).all();
          const filtered = applyInstallationFilters(results, url.searchParams);
          return jsonResponse(request, env, corsPolicy,filtered);
        }

        if (request.method === "POST") {
          const data = await request.json();
          const payload = normalizeInstallationPayload(data, "unknown");

          await env.DB.prepare(`
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
          const detailsJson = JSON.stringify(rawDetails);

          await env.DB.prepare(`
            INSERT INTO audit_logs
              (timestamp, action, username, success, details, computer_name, ip_address, platform)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          `)
            .bind(
              normalizeOptionalString(data.timestamp, nowIso()),
              action,
              username,
              data?.success ? 1 : 0,
              detailsJson,
              normalizeOptionalString(data?.computer_name, ""),
              normalizeOptionalString(data?.ip_address, ""),
              normalizeOptionalString(data?.platform, ""),
            )
            .run();

          return jsonResponse(request, env, corsPolicy,{ success: true }, 201);

        }

        if (request.method === "GET") {
          const limit = Math.min(
            parseOptionalPositiveInt(url.searchParams.get("limit"), "limit") || 100,
            500,
          );

          const { results } = await env.DB.prepare(`
            SELECT id, timestamp, action, username, success, details, computer_name, ip_address, platform
            FROM audit_logs
            ORDER BY timestamp DESC, id DESC
            LIMIT ?
          `)
            .bind(limit)
            .all();

          return jsonResponse(request, env, corsPolicy,results || []);
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
        const data = await request.json();
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

        return jsonResponse(request, env, corsPolicy,
          {
            success: true,
            record: {
              id: insertResult?.meta?.last_row_id || null,
              ...payload,
            },
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
          const data = await request.json();
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

          return jsonResponse(request, env, corsPolicy,
            {
              success: true,
              incident: {
                id: incidentId,
                installation_id: installationId,
                reporter_username: payload.reporterUsername,
                note: payload.note,
                time_adjustment_seconds: payload.timeAdjustment,
                severity: payload.severity,
                source: payload.source,
                created_at: createdAt,
              },
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
          const data = await request.json();
          await env.DB.prepare(`
            UPDATE installations
            SET notes = ?, installation_time_seconds = ?
            WHERE id = ?
          `)
            .bind(data.notes ?? null, data.installation_time_seconds ?? null, recordId)
            .run();

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
