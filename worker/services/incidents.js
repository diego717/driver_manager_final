import { HttpError, normalizeOptionalString } from "../lib/core.js";

const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
const MIN_PHOTO_BYTES = 1024;
const ASSET_EXTERNAL_CODE_MAX_LENGTH = 128;
const ASSET_CLIENT_NAME_MAX_LENGTH = 180;

export const ALLOWED_INCIDENT_PHOTO_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

function sanitizeDescriptorPart(value, fallback = "na", maxLength = 40) {
  const normalized = normalizeOptionalString(value, "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, maxLength);
  return normalized || fallback;
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

export function buildIncidentPhotoDescriptor({
  installationId,
  incidentId,
  clientName,
  assetCode,
}) {
  const clientPart = sanitizeDescriptorPart(clientName, "sin-cliente", 36);
  const assetPart = assetCode
    ? `_equipo-${sanitizeDescriptorPart(assetCode, "sin-equipo", 32)}`
    : "";
  return `inst-${installationId}_inc-${incidentId}_cliente-${clientPart}${assetPart}`;
}

export function buildIncidentPhotoFileName({
  installationId,
  incidentId,
  clientName,
  assetCode,
  extension,
}) {
  const descriptor = buildIncidentPhotoDescriptor({
    installationId,
    incidentId,
    clientName,
    assetCode,
  });
  return `${descriptor}.${sanitizeDescriptorPart(extension, "jpg", 5)}`;
}

export async function resolveIncidentPhotoMetadata(env, request, incident, tenantId) {
  let clientName = normalizeOptionalString(request.headers.get("X-Client-Name"), "")
    .slice(0, ASSET_CLIENT_NAME_MAX_LENGTH);
  let assetCode = normalizeOptionalString(request.headers.get("X-Asset-Code"), "")
    .slice(0, ASSET_EXTERNAL_CODE_MAX_LENGTH);

  if (!env?.DB || typeof env.DB.prepare !== "function") {
    return { clientName, assetCode };
  }

  if (!clientName) {
    try {
      const { results } = await env.DB.prepare(`
        SELECT client_name
        FROM installations
        WHERE id = ?
          AND tenant_id = ?
        LIMIT 1
      `)
        .bind(incident.installation_id, tenantId)
        .all();
      clientName = normalizeOptionalString(results?.[0]?.client_name, "")
        .slice(0, ASSET_CLIENT_NAME_MAX_LENGTH);
    } catch {
      // Best-effort metadata enrichment.
    }
  }

  if (!assetCode) {
    try {
      const { results } = await env.DB.prepare(`
        SELECT a.external_code
        FROM asset_installation_links l
        INNER JOIN assets a
          ON a.id = l.asset_id
          AND a.tenant_id = l.tenant_id
        WHERE l.installation_id = ?
          AND l.tenant_id = ?
          AND l.unlinked_at IS NULL
        ORDER BY l.linked_at DESC, l.id DESC
        LIMIT 1
      `)
        .bind(incident.installation_id, tenantId)
        .all();
      assetCode = normalizeOptionalString(results?.[0]?.external_code, "")
        .slice(0, ASSET_EXTERNAL_CODE_MAX_LENGTH);
    } catch {
      // Best-effort metadata enrichment.
    }
  }

  return { clientName, assetCode };
}

export function extensionFromType(contentType) {
  if (contentType === "image/png") return "png";
  if (contentType === "image/webp") return "webp";
  return "jpg";
}

export function validateAndProcessPhoto(bodyBuffer, declaredContentType) {
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

  if (!ALLOWED_INCIDENT_PHOTO_TYPES.has(detectedContentType)) {
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

export function buildIncidentR2Key(installationId, incidentId, extension, descriptor = "") {
  const timestamp = new Date().toISOString().replace(/[-:.TZ]/g, "");
  const randomPart = Math.random().toString(36).slice(2, 10);
  const safeDescriptor = sanitizeDescriptorPart(
    descriptor || `inst-${installationId}-inc-${incidentId}`,
    "foto",
    84,
  );
  return `incidents/${installationId}/${incidentId}/${timestamp}_${safeDescriptor}_${randomPart}.${extension}`;
}

export async function loadIncidentForTenant(
  env,
  {
    incidentId,
    incidentsTenantId,
    installationId = null,
  },
) {
  let query = `
    SELECT
      i.id,
      i.installation_id,
      i.reporter_username,
      i.note,
      i.time_adjustment_seconds,
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
      i.evidence_note
    FROM incidents i
    INNER JOIN installations inst
      ON inst.id = i.installation_id
    WHERE i.id = ?
      AND i.tenant_id = ?
      AND inst.tenant_id = ?
  `;
  const bindings = [incidentId, incidentsTenantId, incidentsTenantId];

  if (installationId !== null) {
    query += " AND i.installation_id = ?";
    bindings.push(installationId);
  }
  query += " LIMIT 1";

  const { results } = await env.DB.prepare(query).bind(...bindings).all();
  return results?.[0] || null;
}

export async function loadIncidentTimingFieldsForTenant(env, incidentId, incidentsTenantId) {
  try {
    const { results } = await env.DB.prepare(`
      SELECT
        estimated_duration_seconds,
        work_started_at,
        work_ended_at,
        actual_duration_seconds
      FROM incidents
      WHERE id = ?
        AND tenant_id = ?
      LIMIT 1
    `)
      .bind(incidentId, incidentsTenantId)
      .all();
    return results?.[0] || {};
  } catch {
    return {};
  }
}

export function requireIncidentsBucketOperation(env, operation) {
  const bucket = env?.INCIDENTS_BUCKET;
  if (!bucket || typeof bucket[operation] !== "function") {
    throw new Error("El bucket R2 (INCIDENTS_BUCKET) no esta configurado.");
  }
  return bucket;
}

export async function loadIncidentByIdForTenant(env, incidentId, incidentsTenantId) {
  const { results } = await env.DB.prepare(`
    SELECT id, installation_id
    FROM incidents
    WHERE id = ?
      AND tenant_id = ?
  `)
    .bind(incidentId, incidentsTenantId)
    .all();
  return results?.[0] || null;
}

export async function loadIncidentPhotoByIdForTenant(env, photoId, incidentsTenantId) {
  const { results } = await env.DB.prepare(`
    SELECT p.id, p.incident_id, p.r2_key, p.file_name, p.content_type, p.size_bytes, p.sha256, p.created_at
    FROM incident_photos p
    INNER JOIN incidents i
      ON i.id = p.incident_id
    WHERE p.id = ?
      AND p.tenant_id = ?
      AND i.tenant_id = ?
  `)
    .bind(photoId, incidentsTenantId, incidentsTenantId)
    .all();
  return results?.[0] || null;
}
