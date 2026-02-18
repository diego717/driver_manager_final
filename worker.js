const MAX_PHOTO_BYTES = 8 * 1024 * 1024;
const ALLOWED_PHOTO_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const AUTH_WINDOW_SECONDS = 300;
const WEB_ACCESS_TTL_SECONDS = 8 * 60 * 60;

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

function extensionFromType(contentType) {
  if (contentType === "image/png") return "png";
  if (contentType === "image/webp") return "webp";
  return "jpg";
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
  if (a.length !== b.length) return false;

  let mismatch = 0;
  for (let i = 0; i < a.length; i += 1) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
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

function getBearerToken(request) {
  const authorization = request.headers.get("Authorization") || "";
  const [scheme, token] = authorization.trim().split(/\s+/, 2);
  if (!scheme || !token) return "";
  if (scheme.toLowerCase() !== "bearer") return "";
  return token;
}

function ensureWebAuthConfig(env) {
  if (!env.WEB_LOGIN_PASSWORD || !env.WEB_SESSION_SECRET) {
    throw new HttpError(
      500,
      "Autenticacion web no configurada. Define WEB_LOGIN_PASSWORD y WEB_SESSION_SECRET.",
    );
  }
}

async function buildWebAccessToken(env) {
  ensureWebAuthConfig(env);

  const iat = nowUnixSeconds();
  const exp = iat + WEB_ACCESS_TTL_SECONDS;
  const payload = {
    scope: "web",
    iat,
    exp,
  };

  const encodedPayload = base64UrlEncodeUtf8(JSON.stringify(payload));
  const signature = await hmacSha256Hex(env.WEB_SESSION_SECRET, encodedPayload);

  return {
    token: `${encodedPayload}.${signature}`,
    expires_in: WEB_ACCESS_TTL_SECONDS,
    expires_at: new Date(exp * 1000).toISOString(),
  };
}

async function verifyWebAccessToken(request, env) {
  ensureWebAuthConfig(env);

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

  return payload;
}

async function handleWebAuthRoute(request, env, pathParts) {
  if (pathParts.length !== 2 || pathParts[0] !== "auth") {
    return null;
  }

  if (pathParts[1] === "login" && request.method === "POST") {
    ensureWebAuthConfig(env);

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

    if (!timingSafeEqual(providedPassword, String(env.WEB_LOGIN_PASSWORD))) {
      throw new HttpError(401, "Credenciales web invalidas.");
    }

    const token = await buildWebAccessToken(env);
    return jsonResponse(
      {
        success: true,
        access_token: token.token,
        token_type: "Bearer",
        expires_in: token.expires_in,
        expires_at: token.expires_at,
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
      expires_at: new Date(Number(payload.exp) * 1000).toISOString(),
    });
  }

  return null;
}

async function verifyAuth(request, env, url) {
  const expectedToken = env.API_TOKEN;
  const expectedSecret = env.API_SECRET;

  // Modo desarrollo: si no hay secretos configurados, no exigir auth.
  if (!expectedToken || !expectedSecret) {
    return;
  }

  const token = request.headers.get("X-API-Token");
  const timestampRaw = request.headers.get("X-Request-Timestamp");
  const signature = request.headers.get("X-Request-Signature");

  if (!token || !timestampRaw || !signature) {
    throw new HttpError(401, "Faltan headers de autenticación.");
  }

  if (!timingSafeEqual(token, expectedToken)) {
    throw new HttpError(401, "Token inválido.");
  }

  const timestamp = Number.parseInt(timestampRaw, 10);
  if (!Number.isInteger(timestamp)) {
    throw new HttpError(401, "Timestamp inválido.");
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
    throw new HttpError(401, "Firma inválida.");
  }
}

function buildIncidentR2Key(installationId, incidentId, extension) {
  const timestamp = nowIso().replace(/[-:.TZ]/g, "");
  const randomPart = Math.random().toString(36).slice(2, 10);
  return `incidents/${installationId}/${incidentId}/${timestamp}_${randomPart}.${extension}`;
}

function validateIncidentPayload(data) {
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

  const severity = data.severity || "medium";
  if (!["low", "medium", "high", "critical"].includes(severity)) {
    throw new HttpError(400, "Campo 'severity' inválido.");
  }

  const source = data.source || "mobile";
  if (!["desktop", "mobile", "web"].includes(source)) {
    throw new HttpError(400, "Campo 'source' inválido.");
  }

  return {
    note,
    timeAdjustment,
    severity,
    source,
    applyToInstallation: Boolean(data.apply_to_installation),
    reporterUsername: (data.reporter_username || data.username || "unknown").toString(),
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
            installations: "/installations",
            web_installations: "/web/installations",
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
        throw new Error("La base de datos (D1) no está vinculada a este Worker.");
      }

      if (isWebRoute) {
        await verifyWebAccessToken(request, env);
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
          const payload = validateIncidentPayload(data);
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
            throw new HttpError(404, "Instalación no encontrada.");
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
        const contentType = normalizeContentType(request.headers.get("content-type"));

        if (!ALLOWED_PHOTO_TYPES.has(contentType)) {
          throw new HttpError(400, "Tipo de imagen no permitido.");
        }

        const bodyBuffer = await request.arrayBuffer();
        const sizeBytes = bodyBuffer.byteLength;
        if (!sizeBytes) {
          throw new HttpError(400, "La imagen está vacía.");
        }
        if (sizeBytes > MAX_PHOTO_BYTES) {
          throw new HttpError(413, "La imagen supera el tamaño permitido.");
        }

        if (!env.INCIDENTS_BUCKET || typeof env.INCIDENTS_BUCKET.put !== "function") {
          throw new Error("El bucket R2 (INCIDENTS_BUCKET) no está configurado.");
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

      if (routeParts.length === 2 && routeParts[0] === "installations") {
        const recordId = routeParts[1];

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
        const { results } = await env.DB.prepare(
          "SELECT * FROM installations ORDER BY timestamp DESC",
        ).all();
        const filtered = applyInstallationFilters(results, url.searchParams);
        return jsonResponse(computeStatistics(filtered));
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
