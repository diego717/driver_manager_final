import { HttpError, normalizeOptionalString, normalizeRealtimeTenantId } from "./core.js";
import { loadLatestInstallationConformity } from "../services/conformities.js";

const PUBLIC_TRACKING_ISSUER = "siteops";
const PUBLIC_TRACKING_AUDIENCE = "public-tracking";
const PUBLIC_TRACKING_SCOPE = "public_tracking";
const PUBLIC_TRACKING_VERSION = 1;
const PUBLIC_TRACKING_DEFAULT_TTL_HOURS = 72;
const PUBLIC_TRACKING_SHORT_CODE_LENGTH = 8;
const PUBLIC_TRACKING_SHORT_CODE_ALPHABET = "BCDFGHJKMNPQRSTVWXYZ23456789";

function nowUnixSeconds() {
  return Math.floor(Date.now() / 1000);
}

function bytesToBase64Url(bytes) {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlToBytes(input) {
  const normalized = String(input || "").replace(/-/g, "+").replace(/_/g, "/");
  const padding = normalized.length % 4 === 0 ? "" : "=".repeat(4 - (normalized.length % 4));
  const decoded = atob(`${normalized}${padding}`);
  const bytes = new Uint8Array(decoded.length);
  for (let i = 0; i < decoded.length; i += 1) {
    bytes[i] = decoded.charCodeAt(i);
  }
  return bytes;
}

function base64UrlEncodeUtf8(text) {
  return bytesToBase64Url(new TextEncoder().encode(String(text || "")));
}

function base64UrlDecodeUtf8(input) {
  return new TextDecoder().decode(base64UrlToBytes(input));
}

async function hmacSha256Base64Url(secret, message) {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(String(secret || "")),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    cryptoKey,
    new TextEncoder().encode(String(message || "")),
  );
  return bytesToBase64Url(new Uint8Array(signature));
}

function timingSafeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const maxLen = Math.max(a.length, b.length);
  const paddedA = a.padEnd(maxLen, "\0");
  const paddedB = b.padEnd(maxLen, "\0");
  let mismatch = a.length !== b.length ? 1 : 0;
  for (let i = 0; i < maxLen; i += 1) {
    mismatch |= paddedA.charCodeAt(i) ^ paddedB.charCodeAt(i);
  }
  return mismatch === 0;
}

function randomJti() {
  if (!globalThis.crypto?.getRandomValues) {
    throw new HttpError(500, "No hay soporte criptografico para emitir el Magic Link.");
  }
  const randomBytes = crypto.getRandomValues(new Uint8Array(18));
  return `pt_${bytesToBase64Url(randomBytes)}`;
}

function randomShortCode() {
  if (!globalThis.crypto?.getRandomValues) {
    throw new HttpError(500, "No hay soporte criptografico para emitir el enlace publico.");
  }
  const randomBytes = crypto.getRandomValues(new Uint8Array(PUBLIC_TRACKING_SHORT_CODE_LENGTH));
  let code = "";
  for (let i = 0; i < randomBytes.length; i += 1) {
    code += PUBLIC_TRACKING_SHORT_CODE_ALPHABET[randomBytes[i] % PUBLIC_TRACKING_SHORT_CODE_ALPHABET.length];
  }
  return code;
}

function getPublicTrackingStore(env) {
  if (env?.PUBLIC_TRACKING_KV && typeof env.PUBLIC_TRACKING_KV.get === "function") {
    return env.PUBLIC_TRACKING_KV;
  }
  throw new HttpError(503, "PUBLIC_TRACKING_KV no esta configurado.");
}

function ensurePublicTrackingSecret(env) {
  if (!normalizeOptionalString(env?.PUBLIC_TRACKING_SECRET, "")) {
    throw new HttpError(503, "PUBLIC_TRACKING_SECRET no esta configurado.");
  }
}

function buildLinkKey(jti) {
  return `pt:jti:${String(jti || "").trim()}`;
}

function normalizeShortCode(shortCode) {
  return String(shortCode || "").trim().toUpperCase();
}

function buildShortCodeKey(shortCode) {
  return `pt:code:${normalizeShortCode(shortCode)}`;
}

function buildInstallationIndexKey(tenantId, installationId) {
  return `pt:installation:${normalizeRealtimeTenantId(tenantId)}:${Number(installationId)}`;
}

function getDefaultExpirySeconds() {
  return PUBLIC_TRACKING_DEFAULT_TTL_HOURS * 60 * 60;
}

function computeRemainingTtlSeconds(expiresAt, fallbackSeconds = getDefaultExpirySeconds()) {
  const expiresTs = Date.parse(String(expiresAt || ""));
  if (!Number.isFinite(expiresTs)) return fallbackSeconds;
  const remaining = Math.ceil((expiresTs - Date.now()) / 1000);
  return Math.max(60, remaining);
}

function isLoopbackHost(hostname) {
  const normalized = String(hostname || "").trim().toLowerCase();
  return normalized === "localhost" || normalized === "127.0.0.1" || normalized === "::1";
}

export function resolvePublicTrackingOrigin(env, fallbackOrigin = "") {
  const configuredBaseUrl = normalizeOptionalString(env?.PUBLIC_TRACKING_BASE_URL, "").trim();
  if (!configuredBaseUrl) {
    return String(fallbackOrigin || "").replace(/\/+$/, "");
  }

  let parsedUrl = null;
  try {
    parsedUrl = new URL(configuredBaseUrl);
  } catch {
    throw new HttpError(503, "PUBLIC_TRACKING_BASE_URL tiene un formato invalido.");
  }

  if (parsedUrl.protocol !== "https:" && !isLoopbackHost(parsedUrl.hostname)) {
    throw new HttpError(503, "PUBLIC_TRACKING_BASE_URL debe usar HTTPS.");
  }

  return parsedUrl.origin.replace(/\/+$/, "");
}

function buildTrackingUrl(origin, identifier) {
  const safeOrigin = String(origin || "").replace(/\/+$/, "");
  return `${safeOrigin}/track/${encodeURIComponent(identifier)}`;
}

function normalizePublicStatus(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (
    normalized === "registrado" ||
    normalized === "pendiente" ||
    normalized === "en_progreso" ||
    normalized === "demorado" ||
    normalized === "resuelto" ||
    normalized === "cerrado"
  ) {
    return normalized;
  }
  return "registrado";
}

export function buildPublicTrackingMessage(publicStatus) {
  const normalized = normalizePublicStatus(publicStatus);
  if (normalized === "pendiente") return "Recibimos tu solicitud y esta pendiente de atencion.";
  if (normalized === "en_progreso") return "Un tecnico ya esta trabajando en tu servicio.";
  if (normalized === "demorado") return "El servicio sigue abierto, pero quedo momentaneamente demorado.";
  if (normalized === "resuelto") return "El trabajo tecnico quedo resuelto y estamos cerrando el caso.";
  if (normalized === "cerrado") return "El servicio fue cerrado correctamente.";
  return "Tu servicio fue registrado correctamente y ya quedo en seguimiento.";
}

function compareIsoDateStrings(left, right) {
  const leftValue = String(left || "").trim();
  const rightValue = String(right || "").trim();
  if (!leftValue && !rightValue) return 0;
  if (!leftValue) return -1;
  if (!rightValue) return 1;
  return leftValue.localeCompare(rightValue);
}

function latestIncidentActivityAt(latestIncident) {
  return latestIncident?.status_updated_at || latestIncident?.resolved_at || latestIncident?.created_at || null;
}

function hasActiveIncident(summary) {
  return (
    (Number(summary?.incident_in_progress_count) || 0) > 0 ||
    (Number(summary?.incident_paused_count) || 0) > 0 ||
    (Number(summary?.incident_open_count) || 0) > 0
  );
}

function isReopenedAfterConformity(summary, latestIncident, latestConformity) {
  if (!latestConformity?.generated_at || !hasActiveIncident(summary)) {
    return false;
  }
  return compareIsoDateStrings(latestIncidentActivityAt(latestIncident), latestConformity.generated_at) > 0;
}

function buildPublicTrackingStatusMessage(publicStatus, { reopened = false } = {}) {
  if (!reopened) {
    return buildPublicTrackingMessage(publicStatus);
  }
  const normalized = normalizePublicStatus(publicStatus);
  if (normalized === "pendiente") return "El caso fue reabierto. Ya lo registramos otra vez y quedo pendiente de atencion.";
  if (normalized === "en_progreso") return "El caso fue reabierto y un tecnico ya retomo el trabajo.";
  if (normalized === "demorado") return "El caso fue reabierto, pero por ahora sigue demorado.";
  return buildPublicTrackingMessage(normalized);
}

export function buildPublicTrackingStatusLabel(publicStatus, { reopened = false } = {}) {
  const normalized = normalizePublicStatus(publicStatus);
  if (reopened && normalized === "pendiente") return "Caso reabierto, pendiente";
  if (reopened && normalized === "en_progreso") return "Caso reabierto, en trabajo";
  if (reopened && normalized === "demorado") return "Caso reabierto, demorado";
  if (normalized === "pendiente") return "Pendiente de atencion";
  if (normalized === "en_progreso") return "En trabajo";
  if (normalized === "demorado") return "Demorado";
  if (normalized === "resuelto") return "Resuelto";
  if (normalized === "cerrado") return "Cerrado";
  return "Registrado";
}

function derivePreviousPublicStatus(summary, latestIncident, latestConformity, publicStatus, reopened) {
  if (reopened && latestConformity?.generated_at) {
    return "cerrado";
  }
  if (
    publicStatus === "cerrado" &&
    latestIncident?.incident_status &&
    String(latestIncident.incident_status).toLowerCase() === "resolved" &&
    hasConformityAfterLatestIncident(latestIncident, latestConformity)
  ) {
    return "resuelto";
  }
  if (
    publicStatus === "resuelto" &&
    (Number(summary?.incident_in_progress_count) || 0) > 0
  ) {
    return "en_progreso";
  }
  return null;
}

function buildPublicTrackingTransitionLabel(previousStatus, currentStatus, options = {}) {
  const previous = normalizePublicStatus(previousStatus);
  const current = normalizePublicStatus(currentStatus);
  if (!previous || previous === current) {
    return "";
  }
  const previousLabel = buildPublicTrackingStatusLabel(previous, options);
  const currentLabel = buildPublicTrackingStatusLabel(current, options);
  if (!previousLabel || !currentLabel || previousLabel === currentLabel) {
    return "";
  }
  return `${previousLabel} -> ${currentLabel}`;
}

function milestone(type, label, timestamp) {
  if (!timestamp) return null;
  return { type, label, timestamp };
}

function hasConformityAfterLatestIncident(latestIncident, latestConformity) {
  if (!latestConformity?.generated_at) {
    return false;
  }
  return compareIsoDateStrings(
    latestConformity.generated_at,
    latestIncidentActivityAt(latestIncident),
  ) > 0;
}

function buildPublicMilestones({ installation, latestIncident, latestConformity, reopened = false }) {
  const milestones = [
    milestone("installation_created", "Servicio registrado", installation?.timestamp || null),
    milestone(
      "incident_created",
      "Solicitud registrada",
      latestIncident?.created_at || null,
    ),
  ];

  const latestIncidentStatus = String(latestIncident?.incident_status || "").trim().toLowerCase();
  if (latestIncidentStatus === "resolved") {
    milestones.push(
      milestone("incident_resolved", reopened ? "Caso resuelto nuevamente" : "Incidencia resuelta", latestIncident?.resolved_at || latestIncident?.status_updated_at || latestIncident?.created_at || null),
    );
  }

  if (reopened) {
    milestones.push(
      milestone("case_reopened", "Caso reabierto", latestIncident?.status_updated_at || latestIncident?.created_at || null),
    );
  }

  if (reopened && latestIncidentStatus === "in_progress") {
    milestones.push(
      milestone("work_resumed", "Trabajo retomado", latestIncident?.status_updated_at || latestIncident?.created_at || null),
    );
  } else if (reopened && latestIncidentStatus === "paused") {
    milestones.push(
      milestone("case_delayed_again", "Servicio demorado nuevamente", latestIncident?.status_updated_at || latestIncident?.created_at || null),
    );
  } else if (!reopened && latestIncidentStatus === "in_progress") {
    milestones.push(
      milestone("incident_status_updated", "Trabajo en curso", latestIncident?.status_updated_at || latestIncident?.created_at || null),
    );
  } else if (!reopened && latestIncidentStatus === "paused") {
    milestones.push(
      milestone("incident_status_updated", "Servicio demorado", latestIncident?.status_updated_at || latestIncident?.created_at || null),
    );
  }

  if (latestConformity?.generated_at) {
    const closedAgain = hasConformityAfterLatestIncident(latestIncident, latestConformity);
    milestones.push(
      milestone(
        "conformity_generated",
        closedAgain ? "Servicio cerrado nuevamente" : "Servicio cerrado",
        latestConformity.generated_at,
      ),
    );
  }

  return milestones
    .filter(Boolean)
    .sort((left, right) => String(left.timestamp).localeCompare(String(right.timestamp)));
}

function derivePublicStatus(summary, latestIncident, latestConformity) {
  const reopened = isReopenedAfterConformity(summary, latestIncident, latestConformity);
  if (latestConformity?.generated_at && !reopened) {
    return "cerrado";
  }
  if ((Number(summary?.incident_in_progress_count) || 0) > 0) {
    return "en_progreso";
  }
  if ((Number(summary?.incident_paused_count) || 0) > 0) {
    return "demorado";
  }
  if ((Number(summary?.incident_open_count) || 0) > 0) {
    return "pendiente";
  }
  if ((Number(summary?.incident_resolved_count) || 0) > 0) {
    return "resuelto";
  }
  return "registrado";
}

export async function buildPublicTrackingSnapshot(env, { tenantId, installationId }) {
  const normalizedTenantId = normalizeRealtimeTenantId(tenantId);
  const numericInstallationId = Number(installationId);
  if (!Number.isInteger(numericInstallationId) || numericInstallationId <= 0) {
    throw new HttpError(400, "installation_id invalido para tracking publico.");
  }
  if (!env?.DB) {
    throw new HttpError(500, "La base de datos (D1) no esta vinculada a este Worker.");
  }

  const { results: installationRows } = await env.DB.prepare(`
    SELECT id, timestamp
    FROM installations
    WHERE id = ?
      AND tenant_id = ?
    LIMIT 1
  `)
    .bind(numericInstallationId, normalizedTenantId)
    .all();
  const installation = installationRows?.[0] || null;
  if (!installation) {
    throw new HttpError(404, "Registro no encontrado para tracking publico.");
  }

  const { results: incidentSummaryRows } = await env.DB.prepare(`
    SELECT
      SUM(CASE WHEN LOWER(COALESCE(incident_status, 'open')) = 'open' THEN 1 ELSE 0 END) AS incident_open_count,
      SUM(CASE WHEN LOWER(COALESCE(incident_status, 'open')) = 'in_progress' THEN 1 ELSE 0 END) AS incident_in_progress_count,
      SUM(CASE WHEN LOWER(COALESCE(incident_status, 'open')) = 'paused' THEN 1 ELSE 0 END) AS incident_paused_count,
      SUM(CASE WHEN LOWER(COALESCE(incident_status, 'open')) = 'resolved' THEN 1 ELSE 0 END) AS incident_resolved_count
    FROM incidents
    WHERE installation_id = ?
      AND tenant_id = ?
      AND deleted_at IS NULL
  `)
    .bind(numericInstallationId, normalizedTenantId)
    .all();
  const incidentSummary = incidentSummaryRows?.[0] || {};

  const { results: latestIncidentRows } = await env.DB.prepare(`
    SELECT id, incident_status, created_at, status_updated_at, resolved_at
    FROM incidents
    WHERE installation_id = ?
      AND tenant_id = ?
      AND deleted_at IS NULL
    ORDER BY COALESCE(status_updated_at, created_at) DESC, id DESC
    LIMIT 1
  `)
    .bind(numericInstallationId, normalizedTenantId)
    .all();
  const latestIncident = latestIncidentRows?.[0] || null;

  let latestConformity = null;
  try {
    latestConformity = await loadLatestInstallationConformity(env, numericInstallationId, normalizedTenantId);
  } catch {
    latestConformity = null;
  }

  const reopened = isReopenedAfterConformity(incidentSummary, latestIncident, latestConformity);
  const publicStatus = derivePublicStatus(incidentSummary, latestIncident, latestConformity);
  const previousPublicStatus = derivePreviousPublicStatus(
    incidentSummary,
    latestIncident,
    latestConformity,
    publicStatus,
    reopened,
  );
  const publicStatusLabel = buildPublicTrackingStatusLabel(publicStatus, { reopened });
  const previousPublicStatusLabel = previousPublicStatus
    ? buildPublicTrackingStatusLabel(previousPublicStatus)
    : "";
  const timestamps = [
    installation?.timestamp,
    latestIncident?.status_updated_at,
    latestIncident?.created_at,
    latestIncident?.resolved_at,
    latestConformity?.generated_at,
  ]
    .filter(Boolean)
    .map((value) => String(value));
  const lastUpdatedAt = timestamps.sort((left, right) => right.localeCompare(left))[0] || installation.timestamp;

  return {
    installation_id: numericInstallationId,
    public_reference: `Servicio #${numericInstallationId}`,
    public_status: publicStatus,
    public_status_label: publicStatusLabel,
    public_previous_status: previousPublicStatus,
    public_previous_status_label: previousPublicStatusLabel,
    public_transition_label: buildPublicTrackingTransitionLabel(previousPublicStatus, publicStatus, { reopened }),
    public_message: buildPublicTrackingStatusMessage(publicStatus, { reopened }),
    last_updated_at: lastUpdatedAt,
    closed: publicStatus === "cerrado",
    conformity_generated: Boolean(latestConformity?.generated_at),
    reopened,
    milestones: buildPublicMilestones({
      installation,
      latestIncident,
      latestConformity,
      reopened,
    }),
  };
}

async function buildSignedPublicTrackingToken(env, payload) {
  ensurePublicTrackingSecret(env);
  const header = {
    alg: "HS256",
    typ: "JWT",
  };
  const encodedHeader = base64UrlEncodeUtf8(JSON.stringify(header));
  const encodedPayload = base64UrlEncodeUtf8(JSON.stringify(payload));
  const unsignedToken = `${encodedHeader}.${encodedPayload}`;
  const signature = await hmacSha256Base64Url(env.PUBLIC_TRACKING_SECRET, unsignedToken);
  return `${unsignedToken}.${signature}`;
}

export async function verifyPublicTrackingToken(env, token) {
  ensurePublicTrackingSecret(env);
  const normalizedToken = normalizeOptionalString(token, "");
  const [encodedHeader, encodedPayload, signature] = normalizedToken.split(".", 3);
  if (!encodedHeader || !encodedPayload || !signature) {
    throw new HttpError(401, "Magic Link invalido.");
  }

  let header = null;
  let payload = null;
  try {
    header = JSON.parse(base64UrlDecodeUtf8(encodedHeader));
    payload = JSON.parse(base64UrlDecodeUtf8(encodedPayload));
  } catch {
    throw new HttpError(401, "Magic Link invalido.");
  }

  if (String(header?.alg || "").toUpperCase() !== "HS256") {
    throw new HttpError(401, "Magic Link invalido.");
  }
  const expectedSignature = await hmacSha256Base64Url(
    env.PUBLIC_TRACKING_SECRET,
    `${encodedHeader}.${encodedPayload}`,
  );
  if (!timingSafeEqual(signature, expectedSignature)) {
    throw new HttpError(401, "Magic Link invalido.");
  }

  const exp = Number(payload?.exp);
  if (
    payload?.iss !== PUBLIC_TRACKING_ISSUER ||
    payload?.aud !== PUBLIC_TRACKING_AUDIENCE ||
    payload?.scope !== PUBLIC_TRACKING_SCOPE ||
    !Number.isInteger(exp) ||
    exp <= nowUnixSeconds() ||
    !normalizeOptionalString(payload?.jti, "")
  ) {
    throw new HttpError(401, "Magic Link invalido.");
  }

  return {
    token: normalizedToken,
    payload,
  };
}

async function readTrackingEntry(store, jti) {
  const raw = await store.get(buildLinkKey(jti));
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function writeTrackingEntry(store, entry, ttlSeconds) {
  await store.put(buildLinkKey(entry.jti), JSON.stringify(entry), {
    expirationTtl: Math.max(60, Number(ttlSeconds) || getDefaultExpirySeconds()),
  });
}

async function reserveShortCode(store, ttlSeconds) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const shortCode = randomShortCode();
    const existingJti = normalizeOptionalString(await store.get(buildShortCodeKey(shortCode)), "");
    if (existingJti) continue;
    await store.put(buildShortCodeKey(shortCode), shortCode, {
      expirationTtl: Math.max(60, Number(ttlSeconds) || getDefaultExpirySeconds()),
    });
    return shortCode;
  }
  throw new HttpError(500, "No se pudo generar un codigo corto para el enlace publico.");
}

async function bindShortCodeToJti(store, shortCode, jti, ttlSeconds) {
  await store.put(buildShortCodeKey(shortCode), String(jti || "").trim(), {
    expirationTtl: Math.max(60, Number(ttlSeconds) || getDefaultExpirySeconds()),
  });
}

async function deleteShortCode(store, shortCode) {
  const normalizedShortCode = normalizeShortCode(shortCode);
  if (!normalizedShortCode) return;
  await store.delete(buildShortCodeKey(normalizedShortCode));
}

export async function getActivePublicTrackingLink(env, { tenantId, installationId }) {
  const store = getPublicTrackingStore(env);
  const indexKey = buildInstallationIndexKey(tenantId, installationId);
  const activeJti = normalizeOptionalString(await store.get(indexKey), "");
  if (!activeJti) return null;

  const entry = await readTrackingEntry(store, activeJti);
  if (!entry) {
    await store.delete(indexKey);
    return null;
  }

  const expiresAt = Date.parse(String(entry.expires_at || ""));
  if (entry.status !== "active" || !Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
    await store.delete(indexKey);
    await deleteShortCode(store, entry.short_code);
    return {
      ...entry,
      status: entry.status === "active" ? "expired" : entry.status,
    };
  }

  return entry;
}

export async function revokePublicTrackingLink(env, { tenantId, installationId, revokedAt = new Date().toISOString() }) {
  const store = getPublicTrackingStore(env);
  const activeEntry = await getActivePublicTrackingLink(env, { tenantId, installationId });
  const indexKey = buildInstallationIndexKey(tenantId, installationId);
  await store.delete(indexKey);
  if (!activeEntry || !activeEntry.jti) {
    return null;
  }

  const revokedEntry = {
    ...activeEntry,
    status: "revoked",
    revoked_at: revokedAt,
  };
  await deleteShortCode(store, activeEntry.short_code);
  await writeTrackingEntry(store, revokedEntry, computeRemainingTtlSeconds(activeEntry.expires_at));
  return revokedEntry;
}

export async function issuePublicTrackingLink(env, {
  tenantId,
  installationId,
  origin,
  issuedAt = new Date().toISOString(),
}) {
  const normalizedTenantId = normalizeRealtimeTenantId(tenantId);
  const numericInstallationId = Number(installationId);
  const existingEntry = await getActivePublicTrackingLink(env, {
    tenantId: normalizedTenantId,
    installationId: numericInstallationId,
  });
  if (existingEntry?.status === "active") {
    await revokePublicTrackingLink(env, {
      tenantId: normalizedTenantId,
      installationId: numericInstallationId,
      revokedAt: issuedAt,
    });
  }

  const issuedAtUnix = Math.floor(Date.parse(issuedAt) / 1000);
  const ttlSeconds = getDefaultExpirySeconds();
  const expiresAtUnix = issuedAtUnix + ttlSeconds;
  const jti = randomJti();
  const store = getPublicTrackingStore(env);
  const shortCode = await reserveShortCode(store, ttlSeconds);
  const snapshot = await buildPublicTrackingSnapshot(env, {
    tenantId: normalizedTenantId,
    installationId: numericInstallationId,
  });

  const tokenPayload = {
    iss: PUBLIC_TRACKING_ISSUER,
    aud: PUBLIC_TRACKING_AUDIENCE,
    scope: PUBLIC_TRACKING_SCOPE,
    jti,
    tenant_id: normalizedTenantId,
    installation_id: numericInstallationId,
    iat: issuedAtUnix,
    exp: expiresAtUnix,
    v: PUBLIC_TRACKING_VERSION,
  };
  const token = await buildSignedPublicTrackingToken(env, tokenPayload);
  const entry = {
    jti,
    tenant_id: normalizedTenantId,
    installation_id: numericInstallationId,
    token,
    short_code: shortCode,
    status: "active",
    issued_at: issuedAt,
    expires_at: new Date(expiresAtUnix * 1000).toISOString(),
    revoked_at: null,
    channel_id: `public:${jti}`,
    snapshot,
  };

  await writeTrackingEntry(store, entry, ttlSeconds);
  await bindShortCodeToJti(store, shortCode, jti, ttlSeconds);
  await store.put(
    buildInstallationIndexKey(normalizedTenantId, numericInstallationId),
    jti,
    { expirationTtl: ttlSeconds },
  );

  return {
    token,
    shortCode,
    url: buildTrackingUrl(origin, shortCode),
    longUrl: buildTrackingUrl(origin, token),
    entry,
    regenerated: existingEntry?.status === "active",
  };
}

async function resolvePublicTrackingRequestByShortCode(env, shortCode) {
  const store = getPublicTrackingStore(env);
  const normalizedShortCode = normalizeShortCode(shortCode);
  if (!normalizedShortCode) {
    throw new HttpError(401, "Enlace publico invalido.");
  }
  const jti = normalizeOptionalString(await store.get(buildShortCodeKey(normalizedShortCode)), "");
  if (!jti) {
    throw new HttpError(410, "Este enlace ya no esta disponible.");
  }
  const entry = await readTrackingEntry(store, jti);
  if (!entry) {
    throw new HttpError(410, "Este enlace ya no esta disponible.");
  }
  if (normalizeShortCode(entry.short_code) !== normalizedShortCode) {
    throw new HttpError(410, "Este enlace ya no esta disponible.");
  }
  const expiresAt = Date.parse(String(entry.expires_at || ""));
  if (entry.status !== "active" || !Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
    throw new HttpError(410, "Este enlace ya no esta disponible.");
  }

  return {
    token: normalizedShortCode,
    payload: {
      jti: entry.jti,
      tenant_id: entry.tenant_id,
      installation_id: entry.installation_id,
      v: PUBLIC_TRACKING_VERSION,
    },
    entry,
  };
}

export async function resolvePublicTrackingRequest(env, tokenOrShortCode) {
  const normalizedIdentifier = normalizeOptionalString(tokenOrShortCode, "");
  if (!normalizedIdentifier) {
    throw new HttpError(401, "Enlace publico invalido.");
  }
  if (!normalizedIdentifier.includes(".")) {
    return resolvePublicTrackingRequestByShortCode(env, normalizedIdentifier);
  }

  const { payload } = await verifyPublicTrackingToken(env, normalizedIdentifier);
  const store = getPublicTrackingStore(env);
  const entry = await readTrackingEntry(store, payload.jti);
  if (!entry) {
    throw new HttpError(410, "Este enlace ya no esta disponible.");
  }

  if (
    entry.status !== "active" ||
    String(entry.tenant_id || "") !== String(payload.tenant_id || "") ||
    Number(entry.installation_id) !== Number(payload.installation_id)
  ) {
    throw new HttpError(410, "Este enlace ya no esta disponible.");
  }

  const expiresAt = Date.parse(String(entry.expires_at || ""));
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
    throw new HttpError(410, "Este enlace ya no esta disponible.");
  }

  return {
    token: normalizedIdentifier,
    payload,
    entry,
  };
}

export async function refreshPublicTrackingSnapshotForInstallation(env, {
  tenantId,
  installationId,
}) {
  if (!env?.DB || !env?.PUBLIC_TRACKING_KV) {
    return null;
  }

  const normalizedTenantId = normalizeRealtimeTenantId(tenantId);
  const numericInstallationId = Number(installationId);
  if (!Number.isInteger(numericInstallationId) || numericInstallationId <= 0) {
    return null;
  }

  const store = getPublicTrackingStore(env);
  const activeEntry = await getActivePublicTrackingLink(env, {
    tenantId: normalizedTenantId,
    installationId: numericInstallationId,
  });
  if (!activeEntry || activeEntry.status !== "active" || !activeEntry.jti) {
    return null;
  }

  const snapshot = await buildPublicTrackingSnapshot(env, {
    tenantId: normalizedTenantId,
    installationId: numericInstallationId,
  });
  const updatedEntry = {
    ...activeEntry,
    snapshot,
  };
  await writeTrackingEntry(
    store,
    updatedEntry,
    computeRemainingTtlSeconds(activeEntry.expires_at),
  );
  await store.put(
    buildInstallationIndexKey(normalizedTenantId, numericInstallationId),
    activeEntry.jti,
    { expirationTtl: computeRemainingTtlSeconds(activeEntry.expires_at) },
  );

  return updatedEntry;
}

export async function syncPublicTrackingSnapshotForInstallation(env, options) {
  try {
    return await refreshPublicTrackingSnapshotForInstallation(env, options);
  } catch {
    return null;
  }
}

export function renderPublicTrackingHtml({ token }) {
  const escapedToken = String(token || "").replace(/&/g, "&amp;").replace(/"/g, "&quot;");
  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="robots" content="noindex,nofollow">
  <title>Seguimiento del servicio</title>
  <link rel="stylesheet" href="/public-tracking.css">
</head>
<body data-tracking-token="${escapedToken}">
  <main class="public-tracking-shell">
    <section class="public-tracking-card">
      <p class="public-tracking-eyebrow">Seguimiento del servicio</p>
      <h1 id="publicTrackingTitle">Cargando estado...</h1>
      <div id="publicTrackingSummary" class="public-tracking-summary" hidden>
        <span id="publicTrackingStatusBadge" class="public-tracking-status-badge">Registrado</span>
        <span id="publicTrackingTransition" class="public-tracking-transition" hidden></span>
        <p id="publicTrackingSummaryText" class="public-tracking-summary-text">Estamos preparando la informacion del servicio.</p>
      </div>
      <p id="publicTrackingMessage">Estamos preparando la informaci?n del servicio.</p>
      <div id="publicTrackingMeta" class="public-tracking-meta"></div>
      <div id="publicTrackingTimeline" class="public-tracking-timeline" aria-live="polite"></div>
      <button id="publicTrackingRefreshBtn" type="button" class="public-tracking-refresh">Actualizar</button>
    </section>
  </main>
  <script src="/public-tracking.js" defer></script>
</body>
</html>`;
}

export function publicTrackingHeaders() {
  return {
    "Referrer-Policy": "no-referrer",
    "Cache-Control": "no-store",
    "X-Robots-Tag": "noindex, nofollow",
    "X-Content-Type-Options": "nosniff",
  };
}
