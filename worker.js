const MAX_PHOTO_BYTES = 8 * 1024 * 1024;
const ALLOWED_PHOTO_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const AUTH_WINDOW_SECONDS = 300;

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
      "Content-Type, X-API-Token, X-Request-Timestamp, X-Request-Signature, X-File-Name",
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

    try {
      if (!env.DB) {
        throw new Error("La base de datos (D1) no está vinculada a este Worker.");
      }

      await verifyAuth(request, env, url);

      if (pathParts.length === 1 && pathParts[0] === "installations") {
        if (request.method === "GET") {
          const { results } = await env.DB.prepare(
            "SELECT * FROM installations ORDER BY timestamp DESC",
          ).all();
          return jsonResponse(results);
        }

        if (request.method === "POST") {
          const data = await request.json();
          await env.DB.prepare(`
            INSERT INTO installations (timestamp, driver_brand, driver_version, status, client_name, driver_description, installation_time_seconds, os_info, notes)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          `)
            .bind(
              data.timestamp || nowIso(),
              data.driver_brand || "",
              data.driver_version || "",
              data.status || "unknown",
              data.client_name || "",
              data.driver_description || "",
              data.installation_time_seconds || 0,
              data.os_info || "",
              data.notes || "",
            )
            .run();

          return jsonResponse({ success: true }, 201);
        }
      }

      if (
        pathParts.length === 3 &&
        pathParts[0] === "installations" &&
        pathParts[2] === "incidents"
      ) {
        const installationId = parsePositiveInt(pathParts[1], "installation_id");

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
        pathParts.length === 3 &&
        pathParts[0] === "incidents" &&
        pathParts[2] === "photos" &&
        request.method === "POST"
      ) {
        const incidentId = parsePositiveInt(pathParts[1], "incident_id");
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

      if (pathParts.length === 2 && pathParts[0] === "installations") {
        const recordId = pathParts[1];

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

      if (url.pathname === "/statistics") {
        const { results: byBrand } = await env.DB.prepare(
          "SELECT driver_brand, COUNT(*) as count FROM installations GROUP BY driver_brand",
        ).all();

        const brandStats = {};
        byBrand.forEach((row) => {
          if (row.driver_brand) brandStats[row.driver_brand] = row.count;
        });

        return jsonResponse({ by_brand: brandStats });
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
