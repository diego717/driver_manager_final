import bcrypt from "bcryptjs";

const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
const MIN_PHOTO_BYTES = 1024;
const ALLOWED_PHOTO_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const AUTH_WINDOW_SECONDS = 300;
const WEB_ACCESS_TTL_SECONDS = 8 * 60 * 60;
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
const WEB_ALLOWED_HASH_TYPES = new Set([
  WEB_HASH_TYPE_PBKDF2,
  WEB_HASH_TYPE_BCRYPT,
  WEB_HASH_TYPE_LEGACY_PBKDF2,
]);

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers":
      "Content-Type, Authorization, X-API-Token, X-Request-Timestamp, X-Request-Signature, X-File-Name",
  };
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders(),
      "Content-Type": "application/json",
    },
  });
}

function textResponse(text, status = 200) {
  return new Response(text, {
    status,
    headers: corsHeaders(),
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

  const token = getBearerToken(request);
  if (!token) {
    throw new HttpError(401, "Falta token Bearer para autenticacion web.");
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

  return {
    scope: "web",
    sub: normalizeWebUsername(payload.sub || payload.username || "web-user") || "web-user",
    role: normalizeOptionalString(payload.role, WEB_DEFAULT_ROLE) || WEB_DEFAULT_ROLE,
    user_id: Number.isInteger(payload.user_id) ? payload.user_id : null,
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

async function handleWebAuthRoute(request, env, pathParts) {
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
      }
      throw error;
    }

    await clearWebLoginRateLimit(env, rateLimitIdentifier);
    const token = await buildWebAccessToken(env, {
      username: user.username,
      role: user.role,
      user_id: Number(user.id),
    });

    return jsonResponse(
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

    const token = await buildWebAccessToken(env, {
      username: createdUser.username,
      role: createdUser.role,
      user_id: Number(createdUser.id),
    });

    return jsonResponse(
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
  }

  if (pathParts[1] === "users" && pathParts.length === 2 && request.method === "GET") {
    ensureDbBinding(env);

    const session = await verifyWebAccessToken(request, env);
    requireAdminRole(session.role);

    const users = await listWebUsers(env);
    return jsonResponse(
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

    return jsonResponse(
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

    const updatedUser = await getWebUserById(env, userId);
    return jsonResponse(
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

    const updatedUser = await getWebUserById(env, userId);
    return jsonResponse(
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

    return jsonResponse(
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

  if (pathParts[1] === "me" && request.method === "GET") {
    const payload = await verifyWebAccessToken(request, env);
    return jsonResponse({
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
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders() });
    }

    const url = new URL(request.url);
    const pathParts = url.pathname.split("/").filter((part) => part !== "");
    const isWebRoute = pathParts[0] === "web";
    const routeParts = isWebRoute ? pathParts.slice(1) : pathParts;

    try {
      if (routeParts.length === 0 && request.method === "GET") {
        return jsonResponse({
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
            audit_logs: "/audit-logs",
            web_audit_logs: "/web/audit-logs",
          },
        });
      }

      if (routeParts.length === 1 && routeParts[0] === "health" && request.method === "GET") {
        return jsonResponse({ ok: true, now: nowIso() });
      }

      if (isWebRoute) {
        const webAuthResponse = await handleWebAuthRoute(request, env, routeParts);
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
          return jsonResponse(filtered);
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

          return jsonResponse({ success: true }, 201);
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

          return jsonResponse({ success: true }, 201);
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

          return jsonResponse(results || []);
        }
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

        return jsonResponse(
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

          return jsonResponse({
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

          return jsonResponse(
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

        return jsonResponse(
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
            ...corsHeaders(),
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

          return jsonResponse(results[0]);
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

          return jsonResponse({ success: true, updated: recordId });
        }

        if (request.method === "DELETE") {
          if (!recordId) {
            return textResponse("Error: El ID del registro es obligatorio.", 400);
          }

          await env.DB.prepare("DELETE FROM installations WHERE id = ?").bind(recordId).run();
          return jsonResponse({ message: `Registro ${recordId} eliminado.` });
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

        return jsonResponse({
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

      return textResponse("Ruta no encontrada.", 404);
    } catch (error) {
      if (error instanceof HttpError) {
        return jsonResponse(
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

      return jsonResponse({ error: error.message }, 500);
    }
  },
};


