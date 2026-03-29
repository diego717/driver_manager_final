import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

import { HttpError, normalizeOptionalString } from "../lib/core.js";
import { evaluateGeofence } from "../lib/geofence.js";
import { buildGpsMapsUrl, buildGpsMetadataSnapshot } from "../lib/gps.js";

const CONFORMITY_PLATFORM = "web";
const CONFORMITY_SIGNATURE_CONTENT_TYPE = "image/png";
const CONFORMITY_PDF_CONTENT_TYPE = "application/pdf";
const RESEND_API_URL = "https://api.resend.com/emails";
const RESEND_MAX_ATTACHMENT_BYTES = 28 * 1024 * 1024;
const PDF_PAGE = {
  width: 595.28,
  height: 841.89,
  margin: 40,
};
const PDF_LINE_HEIGHT = 15;
const PDF_TEXT_MAX_WIDTH = PDF_PAGE.width - PDF_PAGE.margin * 2;
const PDF_COLORS = {
  ink: rgb(0.09, 0.14, 0.18),
  muted: rgb(0.36, 0.41, 0.46),
  soft: rgb(0.95, 0.97, 0.98),
  border: rgb(0.82, 0.86, 0.89),
  accent: rgb(0.06, 0.5, 0.47),
  accentSoft: rgb(0.88, 0.95, 0.94),
  accentDark: rgb(0.12, 0.22, 0.27),
};
const BRAND_NAME = "SiteOps";
const BRAND_TAG = "Field Control Console";

function requireConformitiesBucketOperation(env, operation) {
  const bucket = env?.INCIDENTS_BUCKET;
  if (!bucket || typeof bucket[operation] !== "function") {
    throw new Error("El bucket R2 (INCIDENTS_BUCKET) no esta configurado.");
  }
  return bucket;
}

function sanitizeStorageSegment(value, fallback = "na", maxLength = 64) {
  const normalized = normalizeOptionalString(value, "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, maxLength);
  return normalized || fallback;
}

function randomSuffix() {
  return Math.random().toString(36).slice(2, 10);
}

function isoStampForKey(value) {
  return normalizeOptionalString(value, new Date().toISOString()).replace(/[-:.TZ]/g, "");
}

function decodeBase64ToBytes(base64) {
  try {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  } catch {
    throw new HttpError(400, "Firma invalida: base64 corrupto.");
  }
}

function decodePngDataUrl(signatureDataUrl) {
  const raw = normalizeOptionalString(signatureDataUrl, "");
  const match = raw.match(/^data:image\/png;base64,([a-z0-9+/=]+)$/i);
  if (!match) {
    throw new HttpError(400, "La firma debe ser un data URL PNG valido.");
  }
  const bytes = decodeBase64ToBytes(match[1]);
  if (!bytes.byteLength) {
    throw new HttpError(400, "La firma esta vacia.");
  }
  return bytes;
}

function encodeBytesToBase64(bytes) {
  if (!bytes?.byteLength) return "";

  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, index + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

function escapeHtml(value) {
  return normalizeOptionalString(value, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatAttachmentSize(bytes) {
  const value = Math.max(0, Number(bytes) || 0);
  if (value >= 1024 * 1024) {
    return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  }
  if (value >= 1024) {
    return `${Math.round(value / 1024)} KB`;
  }
  return `${value} B`;
}

function formatEmailDate(value) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return "Sin fecha";
  return date.toLocaleString("es-ES");
}

function normalizeCompareText(value) {
  return normalizeOptionalString(value, "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .toLowerCase();
}

function normalizeReferenceCompareText(value) {
  return normalizeCompareText(value)
    .replace(/\b(equipo|activo|asset|assets|registro|instalacion|instalaciones|ref|referencia)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function looksLikeAssetReferenceLabel(candidate, assetReference) {
  const normalizedCandidate = normalizeReferenceCompareText(candidate);
  const normalizedAssetReference = normalizeReferenceCompareText(assetReference);
  if (!normalizedCandidate || !normalizedAssetReference) return false;
  return (
    normalizedCandidate === normalizedAssetReference ||
    normalizedCandidate.endsWith(normalizedAssetReference) ||
    normalizedCandidate.includes(` ${normalizedAssetReference}`) ||
    normalizedAssetReference.includes(normalizedCandidate)
  );
}

function resolveClientPresentation({
  installationClientName,
  assetClientName,
  assetLabel,
}) {
  const installationClient = normalizeOptionalString(installationClientName, "");
  const assetClient = normalizeOptionalString(assetClientName, "");
  const assetReference = normalizeOptionalString(assetLabel, "");
  const installationMatchesAsset = looksLikeAssetReferenceLabel(
    installationClient,
    assetReference,
  );
  const assetClientMatchesAsset = looksLikeAssetReferenceLabel(
    assetClient,
    assetReference,
  );

  if (installationClient && !installationMatchesAsset) {
    return { label: "Cliente", value: installationClient };
  }
  if (assetClient && !assetClientMatchesAsset) {
    return { label: "Cliente", value: assetClient };
  }
  if (installationClient) {
    return { label: "Referencia operativa", value: installationClient };
  }
  if (assetClient) {
    return { label: "Referencia operativa", value: assetClient };
  }
  return { label: "Cliente", value: "Cliente no informado" };
}

function normalizePdfText(value) {
  return normalizeOptionalString(value, "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x20-\x7E\n]/g, " ")
    .replace(/\r/g, "")
    .trim();
}

function formatGpsCoordinate(value) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) return "-";
  return numericValue.toFixed(5);
}

function formatGpsAccuracy(value) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) return "-";
  return `+- ${Math.round(Math.max(0, numericValue))} m`;
}

function formatGpsStatusLabel(value) {
  const normalized = normalizeOptionalString(value, "pending").toLowerCase();
  if (normalized === "captured") return "Ubicacion capturada";
  if (normalized === "override") return "Override operativo";
  if (normalized === "denied") return "Permiso denegado";
  if (normalized === "timeout") return "Tiempo agotado";
  if (normalized === "unavailable") return "Ubicacion no disponible";
  if (normalized === "unsupported") return "Geolocalizacion no soportada";
  return "Captura pendiente";
}

function formatGeofenceResultLabel(value) {
  const normalized = normalizeOptionalString(value, "not_applicable").toLowerCase();
  if (normalized === "inside") return "Dentro del radio";
  if (normalized === "outside") return "Fuera del radio";
  return "No aplicable";
}

function pushWrappedPdfLines(lines, label, value, maxLength = 92) {
  const normalizedLabel = normalizeOptionalString(label, "").trim();
  const normalizedValue = normalizeOptionalString(value, "").trim();
  if (!normalizedLabel && !normalizedValue) return;

  const baseLine = normalizedLabel ? `${normalizedLabel}: ${normalizedValue}` : normalizedValue;
  if (!baseLine) return;

  if (baseLine.length <= maxLength) {
    lines.push(baseLine);
    return;
  }

  let remaining = baseLine;
  while (remaining.length > maxLength) {
    lines.push(remaining.slice(0, maxLength));
    remaining = remaining.slice(maxLength);
  }
  if (remaining) {
    lines.push(remaining);
  }
}

function wrapText(text, maxChars = 92) {
  const normalized = normalizePdfText(text);
  if (!normalized) return [];

  const words = normalized.split(/\s+/).filter(Boolean);
  const lines = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length <= maxChars) {
      current = next;
      continue;
    }
    if (current) lines.push(current);
    current = word;
  }
  if (current) lines.push(current);
  return lines;
}

function addNewPage(pdfDoc) {
  return pdfDoc.addPage([PDF_PAGE.width, PDF_PAGE.height]);
}

function createPageState(pdfDoc) {
  return {
    page: addNewPage(pdfDoc),
    y: PDF_PAGE.height - PDF_PAGE.margin,
  };
}

function drawPdfBrandLockup(page, titleFont, bodyFont, {
  x,
  y,
  scale = 1,
  light = false,
} = {}) {
  const frameWidth = 126 * scale;
  const frameHeight = 38 * scale;
  const markSize = 22 * scale;
  const strokeColor = light ? rgb(0.78, 0.9, 0.92) : PDF_COLORS.accent;
  const tagColor = light ? rgb(0.72, 0.84, 0.87) : PDF_COLORS.muted;

  page.drawRectangle({
    x,
    y: y - frameHeight,
    width: frameWidth,
    height: frameHeight,
    color: light ? rgb(0.1, 0.2, 0.24) : rgb(0.978, 0.989, 0.992),
    borderColor: light ? rgb(0.22, 0.41, 0.44) : PDF_COLORS.border,
    borderWidth: 1,
    borderRadius: 10 * scale,
  });
  page.drawRectangle({
    x: x + 8 * scale,
    y: y - 8 * scale,
    width: 52 * scale,
    height: 1.5,
    color: strokeColor,
    opacity: 0.72,
  });

  const markX = x + 10 * scale;
  const markY = y - 8 * scale;
  page.drawRectangle({
    x: markX,
    y: markY - markSize,
    width: markSize,
    height: markSize,
    color: light ? rgb(0.14, 0.29, 0.31) : PDF_COLORS.accentSoft,
    borderColor: strokeColor,
    borderWidth: 1,
    borderRadius: 8 * scale,
  });
  page.drawCircle({
    x: markX + markSize * 0.42,
    y: markY - markSize * 0.52,
    size: markSize * 0.26,
    borderColor: strokeColor,
    borderWidth: 1.5,
  });
  page.drawLine({
    start: { x: markX + markSize * 0.22, y: markY - markSize * 0.52 },
    end: { x: markX + markSize * 0.72, y: markY - markSize * 0.52 },
    thickness: 1,
    color: strokeColor,
  });
  page.drawLine({
    start: { x: markX + markSize * 0.42, y: markY - markSize * 0.22 },
    end: { x: markX + markSize * 0.42, y: markY - markSize * 0.76 },
    thickness: 1,
    color: rgb(strokeColor.red, strokeColor.green, strokeColor.blue),
    opacity: 0.55,
  });
  page.drawCircle({
    x: markX + markSize * 0.7,
    y: markY - markSize * 0.3,
    size: markSize * 0.09,
    color: strokeColor,
  });

  page.drawText(BRAND_NAME.toUpperCase(), {
    x: x + 40 * scale,
    y: y - 16 * scale,
    size: 11.5 * scale,
    font: titleFont,
    color: strokeColor,
  });
  page.drawText(BRAND_TAG.toUpperCase(), {
    x: x + 40 * scale,
    y: y - 26 * scale,
    size: 5.2 * scale,
    font: bodyFont,
    color: tagColor,
  });
}

function buildEmailBrandLockupHtml() {
  return [
    "<table role=\"presentation\" cellspacing=\"0\" cellpadding=\"0\" style=\"border-collapse:collapse;\">",
    "<tr>",
    "<td style=\"padding:0;\">",
    "<div style=\"display:inline-block;padding:0;background:transparent;\">",
    "<div style=\"height:2px;width:86px;background:linear-gradient(90deg,#0f7f79,rgba(15,127,121,0));margin:0 0 12px 0;\"></div>",
    "<table role=\"presentation\" cellspacing=\"0\" cellpadding=\"0\" style=\"border-collapse:collapse;\">",
    "<tr>",
    "<td style=\"vertical-align:middle;padding:0 14px 0 0;\">",
    "<div style=\"width:36px;height:36px;border-radius:12px;background:linear-gradient(180deg,#fbfdfd,#edf4f4);border:1px solid #a7c7c4;box-shadow:0 8px 18px rgba(19,39,48,.07);position:relative;\">",
    "<div style=\"position:absolute;left:8px;top:7px;width:14px;height:14px;border:2px solid #0f7f79;border-right-color:transparent;border-bottom-color:#6bb8b1;border-radius:999px;transform:rotate(-18deg);\"></div>",
    "<div style=\"position:absolute;left:7px;right:7px;top:18px;height:1px;background:linear-gradient(90deg,rgba(15,127,121,.9),rgba(15,127,121,.35));\"></div>",
    "<div style=\"position:absolute;top:8px;bottom:8px;left:17px;width:1px;background:rgba(15,127,121,.4);\"></div>",
    "<div style=\"position:absolute;right:7px;top:8px;width:7px;height:7px;border-radius:999px;background:#0f7f79;box-shadow:0 0 0 3px rgba(15,127,121,.1);\"></div>",
    "</div>",
    "</td>",
    "<td style=\"vertical-align:middle;\">",
    `<div style=\"font-family:'IBM Plex Sans Condensed','Segoe UI',sans-serif;font-size:20px;line-height:1;font-weight:800;letter-spacing:.16em;text-transform:uppercase;color:#0f7f79;\">${escapeHtml(BRAND_NAME)}</div>`,
    `<div style=\"font-family:'IBM Plex Mono','Courier New',monospace;font-size:9px;line-height:1.4;letter-spacing:.24em;text-transform:uppercase;color:#677985;margin-top:5px;\">${escapeHtml(BRAND_TAG)}</div>`,
    "</td>",
    "</tr>",
    "</table>",
    "</div>",
    "</td>",
    "</tr>",
    "</table>",
  ].join("");
}

function drawSectionTitle(state, font, text) {
  state.page.drawText(normalizePdfText(text), {
    x: PDF_PAGE.margin,
    y: state.y,
    size: 15,
    font,
    color: rgb(0.1, 0.15, 0.19),
  });
  state.y -= 22;
}

function ensurePageSpace(pdfDoc, state, requiredHeight = PDF_LINE_HEIGHT * 2) {
  if (state.y - requiredHeight >= PDF_PAGE.margin) return state;
  return createPageState(pdfDoc);
}

function drawWrappedLines(pdfDoc, state, font, text, options = {}) {
  const size = options.size || 11;
  const maxChars = options.maxChars || 96;
  const color = options.color || rgb(0.15, 0.15, 0.15);
  const lines = Array.isArray(text) ? text : wrapText(text, maxChars);
  let nextState = state;
  for (const line of lines) {
    nextState = ensurePageSpace(pdfDoc, nextState, PDF_LINE_HEIGHT + 4);
    nextState.page.drawText(normalizePdfText(line), {
      x: PDF_PAGE.margin,
      y: nextState.y,
      size,
      font,
      color,
      maxWidth: PDF_TEXT_MAX_WIDTH,
    });
    nextState.y -= PDF_LINE_HEIGHT;
  }
  return nextState;
}

function drawLinesInBox(page, font, lines, {
  x,
  y,
  size = 12,
  color = PDF_COLORS.ink,
  lineHeight = size + 3,
} = {}) {
  let nextY = y;
  for (const line of lines) {
    page.drawText(normalizePdfText(line), {
      x,
      y: nextY,
      size,
      font,
      color,
    });
    nextY -= lineHeight;
  }
  return nextY;
}

function drawPdfCard(page, titleFont, bodyFont, {
  x,
  y,
  width,
  height,
  label,
  value,
} = {}) {
  page.drawRectangle({
    x,
    y: y - height,
    width,
    height,
    color: rgb(0.985, 0.989, 0.991),
    borderColor: rgb(0.84, 0.88, 0.9),
    borderWidth: 1,
  });
  page.drawRectangle({
    x,
    y: y - 2,
    width,
    height: 2,
    color: PDF_COLORS.accent,
  });

  page.drawText(normalizePdfText(label), {
    x: x + 14,
    y: y - 22,
    size: 9,
    font: titleFont,
    color: PDF_COLORS.muted,
  });

  const valueLines = wrapText(value, Math.max(18, Math.floor((width - 28) / 7))).slice(0, 3);
  drawLinesInBox(page, bodyFont, valueLines, {
    x: x + 14,
    y: y - 42,
    size: 13,
    lineHeight: 16,
    color: PDF_COLORS.ink,
  });
}

function drawPdfTextPanel(pdfDoc, state, bodyFont, text, {
  fillColor = PDF_COLORS.accentSoft,
  borderColor = PDF_COLORS.border,
  textColor = PDF_COLORS.ink,
  maxChars = 88,
  fontSize = 11,
  paddingX = 14,
  paddingTop = 16,
  paddingBottom = 14,
} = {}) {
  const lines = Array.isArray(text) ? text : wrapText(text, maxChars);
  if (!lines.length) return state;

  const lineHeight = fontSize + 4;
  const boxHeight = paddingTop + paddingBottom + (lines.length * lineHeight);
  const nextState = ensurePageSpace(pdfDoc, state, boxHeight + 8);

  nextState.page.drawRectangle({
    x: PDF_PAGE.margin,
    y: nextState.y - boxHeight,
    width: PDF_TEXT_MAX_WIDTH,
    height: boxHeight,
    color: fillColor,
    borderColor,
    borderWidth: 1,
  });

  const bottomY = drawLinesInBox(nextState.page, bodyFont, lines, {
    x: PDF_PAGE.margin + paddingX,
    y: nextState.y - paddingTop - fontSize,
    size: fontSize,
    lineHeight,
    color: textColor,
  });
  nextState.y = bottomY - paddingBottom;
  return nextState;
}

async function loadPhotoAssetsForPdf(env, photos = []) {
  const bucket = requireConformitiesBucketOperation(env, "get");
  const assets = [];

  for (const photo of photos) {
    const key = normalizeOptionalString(photo?.r2_key, "");
    if (!key) continue;

    let object;
    try {
      object = await bucket.get(key);
    } catch {
      assets.push({
        photo,
        error: "r2_get_failed",
      });
      continue;
    }

    if (!object?.body) {
      assets.push({
        photo,
        error: "r2_object_missing",
      });
      continue;
    }

    const bytes = new Uint8Array(await object.arrayBuffer());
    const contentType = normalizeOptionalString(
      photo?.content_type || object.httpMetadata?.contentType,
      "",
    ).toLowerCase();
    assets.push({
      photo,
      bytes,
      contentType,
    });
  }

  return assets;
}

async function embedPdfImage(pdfDoc, asset) {
  if (!asset?.bytes?.byteLength) return null;
  if (asset.contentType === "image/png") {
    return pdfDoc.embedPng(asset.bytes);
  }
  if (asset.contentType === "image/jpeg" || asset.contentType === "image/jpg") {
    return pdfDoc.embedJpg(asset.bytes);
  }
  return null;
}

function parseOptionalPositiveInteger(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

function buildStaticMapUrl(template, {
  lat,
  lng,
  width,
  height,
  zoom,
} = {}) {
  const replacements = {
    lat: String(lat),
    lng: String(lng),
    width: String(width),
    height: String(height),
    zoom: String(zoom),
    lat_lng: `${lat},${lng}`,
  };

  return String(template || "").replace(/\{(lat|lng|width|height|zoom|lat_lng)\}/g, (_match, key) =>
    replacements[key] ?? "",
  );
}

export async function loadStaticMapAssetForPdf(env, gps) {
  const gpsSnapshot = buildGpsMetadataSnapshot(gps);
  if (gpsSnapshot.status !== "captured") {
    return null;
  }

  const lat = Number(gpsSnapshot.lat);
  const lng = Number(gpsSnapshot.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return null;
  }

  const urlTemplate = normalizeOptionalString(env?.GPS_STATIC_MAP_URL_TEMPLATE, "");
  if (!urlTemplate) {
    return null;
  }

  const width = Math.min(1280, parseOptionalPositiveInteger(env?.GPS_STATIC_MAP_WIDTH, 640));
  const height = Math.min(1280, parseOptionalPositiveInteger(env?.GPS_STATIC_MAP_HEIGHT, 280));
  const zoom = Math.min(20, parseOptionalPositiveInteger(env?.GPS_STATIC_MAP_ZOOM, 16));
  const requestUrl = buildStaticMapUrl(urlTemplate, {
    lat,
    lng,
    width,
    height,
    zoom,
  });
  if (!requestUrl) {
    return null;
  }

  let response;
  try {
    response = await fetch(requestUrl);
  } catch {
    return null;
  }

  if (!response?.ok) {
    return null;
  }

  const contentType = normalizeOptionalString(
    response.headers.get("content-type"),
    "",
  ).toLowerCase().split(";")[0].trim();
  if (
    contentType !== "image/png" &&
    contentType !== "image/jpeg" &&
    contentType !== "image/jpg"
  ) {
    return null;
  }

  const bytes = new Uint8Array(await response.arrayBuffer());
  if (!bytes.byteLength) {
    return null;
  }

  return {
    bytes,
    contentType,
    sourceUrl: requestUrl,
    width,
    height,
    zoom,
  };
}

function normalizeConformityRow(row) {
  if (!row) return null;
  return {
    ...row,
    id: Number(row.id),
    installation_id: Number(row.installation_id),
    generated_by_user_id:
      row.generated_by_user_id === null || row.generated_by_user_id === undefined
        ? null
        : Number(row.generated_by_user_id),
    session_version:
      row.session_version === null || row.session_version === undefined
        ? null
        : Number(row.session_version),
    photo_count: Number(row.photo_count) || 0,
  };
}

export async function loadInstallationConformityContext(
  env,
  {
    installationId,
    tenantId,
    includeAllIncidentPhotos = true,
    photoIds = [],
  },
) {
  const { results: installationRows } = await env.DB.prepare(`
    SELECT
      id,
      tenant_id,
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
      site_radius_m
    FROM installations
    WHERE id = ?
      AND tenant_id = ?
    LIMIT 1
  `)
    .bind(installationId, tenantId)
    .all();
  const installation = installationRows?.[0] || null;
  if (!installation) return null;

  let asset = null;
  try {
    const { results: assetRows } = await env.DB.prepare(`
      SELECT
        a.id,
        a.external_code,
        a.serial_number,
        a.model,
        a.brand,
        a.client_name,
        a.notes,
        a.status,
        l.linked_at,
        l.notes AS link_notes
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
      .bind(installationId, tenantId)
      .all();
    asset = assetRows?.[0] || null;
  } catch {
    asset = null;
  }

  let incidents = [];
  try {
    const { results: incidentRows } = await env.DB.prepare(`
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
        actual_duration_seconds
      FROM incidents
      WHERE installation_id = ?
        AND tenant_id = ?
        AND deleted_at IS NULL
      ORDER BY created_at ASC, id ASC
    `)
      .bind(installationId, tenantId)
      .all();
    incidents = incidentRows || [];
  } catch (error) {
    const message = normalizeOptionalString(error?.message, "").toLowerCase();
    if (
      (message.includes("no such column") || message.includes("has no column named")) &&
      message.includes("deleted_at")
    ) {
      const { results: legacyIncidentRows } = await env.DB.prepare(`
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
          actual_duration_seconds
        FROM incidents
        WHERE installation_id = ?
          AND tenant_id = ?
        ORDER BY created_at ASC, id ASC
      `)
        .bind(installationId, tenantId)
        .all();
      incidents = legacyIncidentRows || [];
    } else {
      throw error;
    }
  }

  let photos = [];
  if (includeAllIncidentPhotos || photoIds.length > 0) {
    const filters = ["i.installation_id = ?", "i.tenant_id = ?", "p.tenant_id = ?"];
    const bindings = [installationId, tenantId, tenantId];
    if (!includeAllIncidentPhotos && photoIds.length > 0) {
      const placeholders = photoIds.map(() => "?").join(", ");
      filters.push(`p.id IN (${placeholders})`);
      bindings.push(...photoIds);
    }

    const { results: photoRows } = await env.DB.prepare(`
      SELECT
        p.id,
        p.incident_id,
        p.r2_key,
        p.file_name,
        p.content_type,
        p.size_bytes,
        p.sha256,
        p.created_at
      FROM incident_photos p
      INNER JOIN incidents i
        ON i.id = p.incident_id
      WHERE ${filters.join("\n        AND ")}
      ORDER BY p.created_at ASC, p.id ASC
    `)
      .bind(...bindings)
      .all();
    photos = photoRows || [];
  }

  return {
    installation,
    asset,
    incidents,
    photos,
  };
}

export async function storeSignatureAsset(
  env,
  {
    tenantId,
    installationId,
    signatureDataUrl,
    signedAt,
  },
) {
  const bucket = requireConformitiesBucketOperation(env, "put");
  const bytes = decodePngDataUrl(signatureDataUrl);
  const stamp = isoStampForKey(signedAt);
  const r2Key = [
    "tenants",
    sanitizeStorageSegment(tenantId, "default"),
    "installations",
    String(installationId),
    "conformities",
    stamp,
    `signature_${randomSuffix()}.png`,
  ].join("/");

  await bucket.put(r2Key, bytes, {
    httpMetadata: {
      contentType: CONFORMITY_SIGNATURE_CONTENT_TYPE,
    },
  });

  return {
    r2Key,
    bytes,
  };
}

export async function generateConformityPdf({
  env,
  context,
  gps,
  geofence: providedGeofence,
  geofenceOverride = null,
  signedAt,
  generatedAt,
  signedByName,
  signedByDocument,
  summaryNote,
  technicianName,
  technicianNote,
  generatedByUsername,
  signatureR2Key,
  signatureBytes,
}) {
  const pdfDoc = await PDFDocument.create();
  pdfDoc.setTitle(`Conformidad instalacion ${context.installation.id}`);
  pdfDoc.setSubject("Conformidad de instalacion");
  pdfDoc.setAuthor(normalizePdfText(generatedByUsername || "SiteOps"));
  pdfDoc.setCreator("SiteOps Worker");
  pdfDoc.setProducer("pdf-lib");
  pdfDoc.setCreationDate(new Date(generatedAt));
  pdfDoc.setModificationDate(new Date(generatedAt));

  const titleFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const bodyFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const assetReference =
    normalizeOptionalString(context.asset?.external_code, "") ||
    normalizeOptionalString(context.asset?.serial_number, "") ||
    normalizeOptionalString(context.asset?.model, "") ||
    "Sin activo vinculado";
  const clientPresentation = resolveClientPresentation({
    installationClientName: context.installation?.client_name,
    assetClientName: context.asset?.client_name,
    assetLabel: assetReference,
  });
  const resolvedTechnicianName =
    normalizeOptionalString(technicianName, "") ||
    normalizeOptionalString(generatedByUsername, "SiteOps");

  let state = createPageState(pdfDoc);
  const heroHeight = 146;
  const heroBottomY = state.y - heroHeight;
  const metaColumnWidth = 154;
  state.page.drawRectangle({
    x: PDF_PAGE.margin,
    y: heroBottomY,
    width: PDF_TEXT_MAX_WIDTH,
    height: heroHeight,
    color: rgb(0.982, 0.987, 0.989),
    borderColor: rgb(0.83, 0.88, 0.9),
    borderWidth: 1,
  });
  state.page.drawRectangle({
    x: PDF_PAGE.margin,
    y: state.y - 3,
    width: PDF_TEXT_MAX_WIDTH,
    height: 3,
    color: PDF_COLORS.accent,
  });
  state.page.drawRectangle({
    x: PDF_PAGE.margin + PDF_TEXT_MAX_WIDTH - metaColumnWidth,
    y: heroBottomY,
    width: metaColumnWidth,
    height: heroHeight,
    color: rgb(0.95, 0.975, 0.973),
  });
  state.page.drawRectangle({
    x: PDF_PAGE.margin + PDF_TEXT_MAX_WIDTH - metaColumnWidth,
    y: heroBottomY,
    width: 1,
    height: heroHeight,
    color: rgb(0.84, 0.88, 0.9),
  });

  drawPdfBrandLockup(state.page, titleFont, bodyFont, {
    x: PDF_PAGE.margin + 20,
    y: state.y - 18,
    scale: 0.84,
    light: false,
  });

  state.page.drawRectangle({
    x: PDF_PAGE.margin + 20,
    y: state.y - 72,
    width: 112,
    height: 17,
    color: rgb(0.89, 0.952, 0.945),
  });
  state.page.drawText("CIERRE OPERATIVO", {
    x: PDF_PAGE.margin + 28,
    y: state.y - 66,
    size: 7.9,
    font: titleFont,
    color: PDF_COLORS.accent,
  });

  state.page.drawText("Constancia de conformidad", {
    x: PDF_PAGE.margin + 20,
    y: state.y - 112,
    size: 22,
    font: titleFont,
    color: PDF_COLORS.ink,
  });
  state.page.drawText(`Registro #${normalizePdfText(String(context.installation.id))}`, {
    x: PDF_PAGE.margin + 20,
    y: state.y - 132,
    size: 12.5,
    font: bodyFont,
    color: rgb(0.28, 0.35, 0.4),
  });
  state.page.drawText("Documento de cierre emitido por SiteOps", {
    x: PDF_PAGE.margin + 20,
    y: state.y - 144,
    size: 8.5,
    font: bodyFont,
    color: rgb(0.43, 0.51, 0.56),
  });

  const metaX = PDF_PAGE.margin + PDF_TEXT_MAX_WIDTH - metaColumnWidth + 16;
  state.page.drawText("Generado", {
    x: metaX,
    y: state.y - 42,
    size: 8.5,
    font: titleFont,
    color: rgb(0.4, 0.48, 0.53),
  });
  state.page.drawText(normalizePdfText(formatEmailDate(generatedAt)), {
    x: metaX,
    y: state.y - 58,
    size: 10.5,
    font: bodyFont,
    color: rgb(0.32, 0.4, 0.45),
    maxWidth: metaColumnWidth - 28,
  });
  state.page.drawText("Tecnico", {
    x: metaX,
    y: state.y - 92,
    size: 8.5,
    font: titleFont,
    color: rgb(0.4, 0.48, 0.53),
  });
  state.page.drawText(normalizePdfText(resolvedTechnicianName), {
    x: metaX,
    y: state.y - 108,
    size: 10.5,
    font: bodyFont,
    color: rgb(0.32, 0.4, 0.45),
    maxWidth: metaColumnWidth - 28,
  });

  state.y = heroBottomY - 18;

  const cardGap = 12;
  const cardWidth = (PDF_TEXT_MAX_WIDTH - cardGap) / 2;
  const cardHeight = 72;
  drawPdfCard(state.page, titleFont, bodyFont, {
    x: PDF_PAGE.margin,
    y: state.y,
    width: cardWidth,
    height: cardHeight,
    label: clientPresentation.label,
    value: clientPresentation.value,
  });
  drawPdfCard(state.page, titleFont, bodyFont, {
    x: PDF_PAGE.margin + cardWidth + cardGap,
    y: state.y,
    width: cardWidth,
    height: cardHeight,
    label: "Activo",
    value: assetReference,
  });
  state.y -= cardHeight + 12;
  drawPdfCard(state.page, titleFont, bodyFont, {
    x: PDF_PAGE.margin,
    y: state.y,
    width: cardWidth,
    height: cardHeight,
    label: "Firmado por",
    value: [signedByName, signedByDocument].filter(Boolean).join(" | ") || "Sin firmante",
  });
  drawPdfCard(state.page, titleFont, bodyFont, {
    x: PDF_PAGE.margin + cardWidth + cardGap,
    y: state.y,
    width: cardWidth,
    height: cardHeight,
    label: "Responsable operativo",
    value: resolvedTechnicianName,
  });
  state.y -= cardHeight + 18;

  const summaryLines = [
    `Fecha de conformidad: ${formatEmailDate(signedAt)}`,
    `Firmado por: ${[signedByName, signedByDocument].filter(Boolean).join(" | ") || "Sin firmante"}`,
  ];
  if (assetReference && assetReference !== "Sin activo vinculado") {
    summaryLines.push(`Activo vinculado: ${assetReference}`);
  }
  if (context.asset?.serial_number) {
    summaryLines.push(`Serie: ${context.asset.serial_number}`);
  }
  if (context.asset?.model) {
    summaryLines.push(`Modelo: ${context.asset.model}`);
  }
  if (context.photos.length > 0) {
    summaryLines.push(`Evidencia fotografica incluida: ${context.photos.length} archivo(s)`);
  }
  if (context.incidents.length > 0) {
    summaryLines.push(`Incidencia(s) asociada(s): ${context.incidents.length}`);
  }

  drawSectionTitle(state, titleFont, "Resumen del cierre");
  state = drawPdfTextPanel(pdfDoc, state, bodyFont, summaryLines, {
    fillColor: rgb(0.982, 0.987, 0.989),
    borderColor: rgb(0.84, 0.88, 0.9),
    textColor: rgb(0.22, 0.3, 0.35),
    maxChars: 88,
    fontSize: 11,
    paddingX: 16,
    paddingTop: 16,
    paddingBottom: 14,
  });

  const gpsSnapshot = buildGpsMetadataSnapshot(gps);
  const gpsMapsUrl = buildGpsMapsUrl(gps);
  const geofence = providedGeofence || evaluateGeofence({
    gps,
    installation: context.installation,
    checkedAt: signedAt,
  });
  state.y -= 8;
  drawSectionTitle(state, titleFont, "Evidencia GPS");
  const gpsLines = [
    `Estado: ${formatGpsStatusLabel(gpsSnapshot.status)}`,
    `Fuente: ${normalizeOptionalString(gpsSnapshot.source, "none") || "none"}`,
  ];
  if (gpsSnapshot.status === "captured") {
    gpsLines.push(
      `Latitud: ${formatGpsCoordinate(gpsSnapshot.lat)}`,
      `Longitud: ${formatGpsCoordinate(gpsSnapshot.lng)}`,
      `Precision: ${formatGpsAccuracy(gpsSnapshot.accuracy_m)}`,
      `Capturada: ${formatEmailDate(gpsSnapshot.captured_at)}`,
    );
    if (gpsMapsUrl) {
      gpsLines.push(`Mapa: ${gpsMapsUrl}`);
    }
  } else if (gpsSnapshot.note) {
    gpsLines.push(`Motivo: ${gpsSnapshot.note}`);
  }
  state = drawPdfTextPanel(pdfDoc, state, bodyFont, gpsLines, {
    fillColor: rgb(0.95, 0.98, 0.99),
    borderColor: PDF_COLORS.border,
    textColor: PDF_COLORS.ink,
    maxChars: 84,
  });

  const staticMapAsset = await loadStaticMapAssetForPdf(env, gps);
  const staticMapImage = staticMapAsset
    ? await embedPdfImage(pdfDoc, staticMapAsset)
    : null;
  if (staticMapImage) {
    state.y -= 8;
    drawSectionTitle(state, titleFont, "Mapa de referencia");
    state = ensurePageSpace(pdfDoc, state, 220);
    const frameWidth = PDF_TEXT_MAX_WIDTH;
    const frameHeight = 170;
    const frameX = PDF_PAGE.margin;
    const frameTopY = state.y;
    const scale = Math.min(
      frameWidth / staticMapImage.width,
      frameHeight / staticMapImage.height,
    );
    const drawWidth = staticMapImage.width * scale;
    const drawHeight = staticMapImage.height * scale;
    const imageX = frameX + ((frameWidth - drawWidth) / 2);
    const imageY = frameTopY - drawHeight - 10;

    state.page.drawRectangle({
      x: frameX,
      y: frameTopY - frameHeight - 10,
      width: frameWidth,
      height: frameHeight + 10,
      color: rgb(0.98, 0.99, 1),
      borderWidth: 1,
      borderColor: PDF_COLORS.border,
    });
    state.page.drawImage(staticMapImage, {
      x: imageX,
      y: imageY,
      width: drawWidth,
      height: drawHeight,
    });
    state.y = frameTopY - frameHeight - 18;
    state = drawWrappedLines(
      pdfDoc,
      state,
      bodyFont,
      `Mapa estatico best-effort generado desde provider externo. Zoom ${staticMapAsset.zoom}.`,
      { maxChars: 82, size: 9, color: rgb(0.38, 0.41, 0.46) },
    );
  }

  state.y -= 8;
  drawSectionTitle(state, titleFont, "Geofence");
  const geofenceLines = [
    `Resultado: ${formatGeofenceResultLabel(geofence.geofence_result)}`,
  ];
  if (Number.isFinite(Number(geofence.geofence_distance_m))) {
    geofenceLines.push(`Distancia medida: ${Math.round(Number(geofence.geofence_distance_m))} m`);
  }
  if (Number.isFinite(Number(geofence.geofence_radius_m))) {
    geofenceLines.push(`Radio permitido: ${Math.round(Number(geofence.geofence_radius_m))} m`);
  }
  if (
    Number.isFinite(Number(context.installation?.site_lat)) &&
    Number.isFinite(Number(context.installation?.site_lng))
  ) {
    geofenceLines.push(
      `Referencia sitio: ${formatGpsCoordinate(context.installation.site_lat)}, ${formatGpsCoordinate(context.installation.site_lng)}`,
    );
  }
  if (geofence.geofence_result === "outside") {
    geofenceLines.push("Advertencia: la captura GPS quedo fuera del radio configurado.");
  }
  if (geofenceOverride?.override_applied && geofenceOverride?.override_note) {
    geofenceLines.push("Excepcion: override geofence aplicado.");
    geofenceLines.push(`Motivo: ${geofenceOverride.override_note}`);
    if (geofenceOverride.override_by) {
      geofenceLines.push(`Registrado por: ${geofenceOverride.override_by}`);
    }
    if (geofenceOverride.override_at) {
      geofenceLines.push(`Registrado el: ${formatEmailDate(geofenceOverride.override_at)}`);
    }
  }
  state = drawPdfTextPanel(pdfDoc, state, bodyFont, geofenceLines, {
    fillColor: rgb(0.99, 0.97, 0.92),
    borderColor: PDF_COLORS.border,
    textColor: PDF_COLORS.ink,
    maxChars: 84,
  });

  if (summaryNote) {
    state.y -= 8;
    drawSectionTitle(state, titleFont, "Nota de cierre");
    state = drawPdfTextPanel(pdfDoc, state, bodyFont, summaryNote, {
      fillColor: rgb(0.97, 0.984, 0.983),
      borderColor: rgb(0.82, 0.87, 0.89),
      textColor: rgb(0.16, 0.24, 0.28),
      maxChars: 88,
      fontSize: 12,
      paddingX: 18,
      paddingTop: 18,
      paddingBottom: 16,
    });
  }

  if (technicianNote || context.installation.notes) {
    state.y -= 8;
    drawSectionTitle(state, titleFont, "Notas");
    const noteLines = [];
    pushWrappedPdfLines(noteLines, "Tecnico", technicianNote, 88);
    pushWrappedPdfLines(noteLines, "Instalacion", context.installation.notes, 88);
    state = drawPdfTextPanel(pdfDoc, state, bodyFont, noteLines, {
      fillColor: rgb(0.95, 0.98, 0.99),
      borderColor: PDF_COLORS.border,
      textColor: PDF_COLORS.ink,
      maxChars: 88,
    });
  }

  const signatureImage = signatureBytes?.byteLength
    ? await pdfDoc.embedPng(signatureBytes)
    : null;
  if (signatureImage) {
    state.y -= 8;
    drawSectionTitle(state, titleFont, "Firma");
    state = ensurePageSpace(pdfDoc, state, 170);
    const scaled = signatureImage.scale(0.5);
    const maxWidth = PDF_TEXT_MAX_WIDTH;
    const ratio = Math.min(1, maxWidth / scaled.width, 120 / scaled.height);
    const width = scaled.width * ratio;
    const height = scaled.height * ratio;
    state.page.drawRectangle({
      x: PDF_PAGE.margin,
      y: state.y - height - 10,
      width: Math.max(width + 20, 180),
      height: height + 20,
      color: rgb(0.98, 0.99, 1),
      borderWidth: 1,
      borderColor: PDF_COLORS.border,
    });
    state.page.drawImage(signatureImage, {
      x: PDF_PAGE.margin + 10,
      y: state.y - height,
      width,
      height,
    });
    state.y -= height + 28;
  }

  if (context.incidents.length) {
    state.y -= 8;
    drawSectionTitle(state, titleFont, "Incidencias");
    for (const incident of context.incidents) {
      state = ensurePageSpace(pdfDoc, state, 48);
      state.page.drawRectangle({
        x: PDF_PAGE.margin,
        y: state.y - 30,
        width: PDF_TEXT_MAX_WIDTH,
        height: 26,
        color: PDF_COLORS.soft,
        borderColor: PDF_COLORS.border,
        borderWidth: 1,
      });
      state = drawWrappedLines(
        pdfDoc,
        state,
        bodyFont,
        `#${incident.id} | ${normalizeOptionalString(incident.severity, "medium")} | ${normalizeOptionalString(incident.incident_status, "open")} | ${normalizeOptionalString(incident.note, "")}`,
        { maxChars: 86, color: PDF_COLORS.ink },
      );
      state.y -= 2;
    }
  }

  const photoAssets = await loadPhotoAssetsForPdf(env, context.photos);
  const skippedAssets = [];
  for (const asset of photoAssets) {
    const embedded = await embedPdfImage(pdfDoc, asset);
    if (!embedded) {
      skippedAssets.push(asset);
      continue;
    }

    const page = addNewPage(pdfDoc);
    const photoHeaderHeight = 48;
    page.drawRectangle({
      x: PDF_PAGE.margin,
      y: PDF_PAGE.height - PDF_PAGE.margin - photoHeaderHeight,
      width: PDF_TEXT_MAX_WIDTH,
      height: photoHeaderHeight,
      color: PDF_COLORS.accentDark,
    });
    page.drawText("Evidencia fotografica", {
      x: PDF_PAGE.margin,
      y: PDF_PAGE.height - PDF_PAGE.margin - 18,
      size: 18,
      font: titleFont,
      color: rgb(1, 1, 1),
    });
    page.drawText(`Registro #${normalizePdfText(String(context.installation.id))}`, {
      x: PDF_PAGE.margin,
      y: PDF_PAGE.height - PDF_PAGE.margin - 34,
      size: 9,
      font: bodyFont,
      color: rgb(0.82, 0.91, 0.93),
    });
    const maxWidth = PDF_PAGE.width - PDF_PAGE.margin * 2;
    const imageTopY = PDF_PAGE.height - PDF_PAGE.margin - photoHeaderHeight - 20;
    const imageBottomY = PDF_PAGE.margin + 18;
    const maxHeight = imageTopY - imageBottomY;
    const ratio = Math.min(
      1,
      maxWidth / embedded.width,
      maxHeight / embedded.height,
    );
    const width = embedded.width * ratio;
    const height = embedded.height * ratio;
    const x = (PDF_PAGE.width - width) / 2;
    const y = imageTopY - height;
    page.drawImage(embedded, { x, y, width, height });
  }

  if (skippedAssets.length) {
    state = ensurePageSpace(pdfDoc, state, 60);
    state.y -= 8;
    drawSectionTitle(state, titleFont, "Fotos omitidas");
    for (const asset of skippedAssets) {
      const reason = asset.error || `content_type_no_soportado:${asset.contentType || "desconocido"}`;
      state = drawWrappedLines(
        pdfDoc,
        state,
        bodyFont,
        `Foto #${asset.photo?.id || "N/A"} omitida (${reason}).`,
        { maxChars: 84 },
      );
    }
  }

  return pdfDoc.save();
}

export async function storeConformityPdf(
  env,
  {
    tenantId,
    installationId,
    pdfBytes,
    generatedAt,
  },
) {
  const bucket = requireConformitiesBucketOperation(env, "put");
  const stamp = isoStampForKey(generatedAt);
  const r2Key = [
    "tenants",
    sanitizeStorageSegment(tenantId, "default"),
    "installations",
    String(installationId),
    "conformities",
    stamp,
    `conformity_${randomSuffix()}.pdf`,
  ].join("/");

  await bucket.put(r2Key, pdfBytes, {
    httpMetadata: {
      contentType: CONFORMITY_PDF_CONTENT_TYPE,
    },
  });

  return {
    r2Key,
  };
}

export async function persistInstallationConformity(
  env,
  {
    installationId,
    tenantId,
    signedByName,
    signedByDocument,
    emailTo,
    summaryNote,
    technicianNote,
    signatureR2Key,
    pdfR2Key,
    signedAt,
    generatedAt,
    generatedByUserId,
    generatedByUsername,
    sessionVersion,
    requestIp,
    platform = CONFORMITY_PLATFORM,
    status = "generated",
    photoCount = 0,
    metadataJson = "{}",
  },
) {
  const result = await env.DB.prepare(`
    INSERT INTO installation_conformities (
      installation_id,
      tenant_id,
      signed_by_name,
      signed_by_document,
      email_to,
      summary_note,
      technician_note,
      signature_r2_key,
      pdf_r2_key,
      signed_at,
      generated_at,
      generated_by_user_id,
      generated_by_username,
      session_version,
      request_ip,
      platform,
      status,
      photo_count,
      metadata_json
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
    .bind(
      installationId,
      tenantId,
      signedByName,
      signedByDocument,
      emailTo,
      summaryNote,
      technicianNote,
      signatureR2Key,
      pdfR2Key,
      signedAt,
      generatedAt,
      generatedByUserId ?? null,
      generatedByUsername,
      sessionVersion ?? null,
      requestIp,
      platform,
      status,
      Math.max(0, Number(photoCount) || 0),
      metadataJson || "{}",
    )
    .run();

  const conformityId = Number(result?.meta?.last_row_id || 0);
  const { results } = await env.DB.prepare(`
    SELECT *
    FROM installation_conformities
    WHERE id = ?
      AND tenant_id = ?
    LIMIT 1
  `)
    .bind(conformityId, tenantId)
    .all();
  return normalizeConformityRow(results?.[0] || null);
}

export async function loadLatestInstallationConformity(env, installationId, tenantId) {
  const { results } = await env.DB.prepare(`
    SELECT *
    FROM installation_conformities
    WHERE installation_id = ?
      AND tenant_id = ?
    ORDER BY generated_at DESC, id DESC
    LIMIT 1
  `)
    .bind(installationId, tenantId)
    .all();
  return normalizeConformityRow(results?.[0] || null);
}

export async function loadInstallationConformityPdfById(
  env,
  installationId,
  conformityId,
  tenantId,
) {
  const { results } = await env.DB.prepare(`
    SELECT id, pdf_r2_key, installation_id, tenant_id
    FROM installation_conformities
    WHERE id = ?
      AND installation_id = ?
      AND tenant_id = ?
    LIMIT 1
  `)
    .bind(conformityId, installationId, tenantId)
    .all();
  const row = results?.[0] || null;
  if (!row) return null;

  const bucket = requireConformitiesBucketOperation(env, "get");
  const object = await bucket.get(row.pdf_r2_key);
  if (!object || !object.body) return null;

  return {
    row,
    object,
  };
}

export async function sendConformityEmail(
  env,
  {
    to,
    installationId,
    pdfBytes,
    signedByName,
    clientName,
    assetClientName,
    assetLabel,
    technicianName,
    generatedAt,
    summaryNote,
    incidentCount,
    photoCount,
  },
) {
  const recipient = normalizeOptionalString(to, "");
  if (!recipient) {
    return {
      delivered: false,
      error: "missing_recipient",
    };
  }

  if (!env?.RESEND_API_KEY || !env?.RESEND_FROM_EMAIL) {
    return {
      delivered: false,
      error: "resend_not_configured",
    };
  }

  if (!pdfBytes?.byteLength) {
    return {
      delivered: false,
      error: "missing_pdf_attachment",
    };
  }

  if (pdfBytes.byteLength > RESEND_MAX_ATTACHMENT_BYTES) {
    return {
      delivered: false,
      error: "pdf_attachment_too_large",
      attachment_size_bytes: pdfBytes.byteLength,
    };
  }

  const signer = normalizeOptionalString(signedByName, "cliente");
  const asset = normalizeOptionalString(assetLabel, "Sin activo vinculado");
  const clientPresentation = resolveClientPresentation({
    installationClientName: clientName,
    assetClientName,
    assetLabel: asset,
  });
  const technician =
    normalizeOptionalString(technicianName, "") || "equipo tecnico";
  const generatedLabel = formatEmailDate(generatedAt);
  const summary = normalizeOptionalString(summaryNote, "");
  const normalizedIncidentCount = Math.max(0, Number(incidentCount) || 0);
  const normalizedPhotoCount = Math.max(0, Number(photoCount) || 0);
  const subject = `Conformidad de instalacion #${installationId}`;
  const filename = `conformidad_instalacion_${installationId}.pdf`;
  const attachmentBase64 = encodeBytesToBase64(pdfBytes);
  const attachmentSize = formatAttachmentSize(pdfBytes.byteLength);
  const text = [
    "Adjuntamos la conformidad de instalacion generada desde SiteOps.",
    `Instalacion: #${installationId}`,
    `${clientPresentation.label}: ${clientPresentation.value}`,
    `Activo: ${asset}`,
    `Firmado por: ${signer}`,
    `Tecnico responsable: ${technician}`,
    `Generada el: ${generatedLabel}`,
    `Incidencias incluidas: ${normalizedIncidentCount}`,
    `Fotos incluidas: ${normalizedPhotoCount}`,
    summary ? `Resumen: ${summary}` : "",
    "",
    `Adjunto: ${filename} (${attachmentSize})`,
  ].join("\n");
  const html = [
    "<div style=\"margin:0;padding:44px 18px;background:linear-gradient(180deg,#f1f5f5 0%,#e8efef 100%);font-family:Georgia,'Times New Roman',serif;color:#17232d;\">",
    "<table role=\"presentation\" width=\"100%\" cellspacing=\"0\" cellpadding=\"0\" style=\"max-width:680px;margin:0 auto;border-collapse:collapse;\">",
    "<tr><td style=\"padding:0 0 18px 0;\">",
    buildEmailBrandLockupHtml(),
    "</td></tr>",
    "<tr><td style=\"padding:0 0 18px 0;\">",
    "<table role=\"presentation\" cellspacing=\"0\" cellpadding=\"0\" style=\"border-collapse:collapse;\">",
    "<tr>",
    "<td style=\"padding:0 12px 0 0;vertical-align:middle;\">",
    "<div style=\"display:inline-block;padding:8px 12px;border:1px solid #c8dbda;border-radius:999px;background:rgba(255,255,255,.58);color:#0f7f79;font-size:11px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;font-family:'IBM Plex Mono','Courier New',monospace;\">Cierre operativo</div>",
    "</td>",
    "<td style=\"vertical-align:middle;\">",
    "<div style=\"height:1px;width:190px;background:linear-gradient(90deg,rgba(15,127,121,.55),rgba(15,127,121,0));\"></div>",
    "</td>",
    "</tr>",
    "</table>",
    "</td></tr>",
    "<tr><td style=\"background:linear-gradient(180deg,#fdfefe 0%,#f5f8f8 100%);border:1px solid #cad9dc;border-radius:34px;padding:34px 34px 36px 34px;box-shadow:0 24px 54px rgba(16,32,45,.08);\">",
    "<div style=\"font-size:11px;font-weight:800;letter-spacing:.18em;text-transform:uppercase;color:#6f808a;margin:0 0 18px 0;font-family:'IBM Plex Mono','Courier New',monospace;\">Conformidad de instalacion</div>",
    `<div style=\"font-size:42px;line-height:1;font-weight:700;color:#14252d;margin:0 0 12px 0;font-family:'IBM Plex Sans Condensed','Segoe UI',sans-serif;letter-spacing:.035em;text-transform:uppercase;\">Registro #${escapeHtml(String(installationId))}</div>`,
    "<div style=\"width:92px;height:2px;background:linear-gradient(90deg,#0f7f79,rgba(15,127,121,0));margin:0 0 18px 0;\"></div>",
    "<div style=\"font-size:18px;line-height:1.8;color:#304754;max-width:560px;font-family:Georgia,'Times New Roman',serif;\">La constancia final ya fue emitida desde <strong>SiteOps</strong>. El documento adjunto consolida el cierre operativo, la firma del responsable y la evidencia asociada en una sola pieza.</div>",
    "<div style=\"height:1px;background:linear-gradient(90deg,rgba(24,49,58,.12),rgba(24,49,58,0));margin:28px 0 22px 0;\"></div>",
    "<table role=\"presentation\" width=\"100%\" cellspacing=\"0\" cellpadding=\"0\" style=\"border-collapse:collapse;\">",
    "<tr>",
    "<td style=\"padding:0 24px 0 0;vertical-align:top;\">",
    `<div style=\"font-size:10px;font-weight:800;letter-spacing:.18em;text-transform:uppercase;color:#6f808a;margin:0 0 8px 0;font-family:'IBM Plex Mono','Courier New',monospace;\">${escapeHtml(clientPresentation.label)}</div>`,
    `<div style=\"font-size:23px;line-height:1.35;font-weight:700;color:#17232d;font-family:Georgia,'Times New Roman',serif;\">${escapeHtml(clientPresentation.value)}</div>`,
    "</td>",
    "<td style=\"width:1px;background:#d8e3e6;\"></td>",
    "<td style=\"padding:0 0 0 24px;vertical-align:top;\">",
    "<div style=\"font-size:10px;font-weight:800;letter-spacing:.18em;text-transform:uppercase;color:#6f808a;margin:0 0 8px 0;font-family:'IBM Plex Mono','Courier New',monospace;\">Activo</div>",
    `<div style=\"font-size:23px;line-height:1.35;font-weight:700;color:#17232d;font-family:Georgia,'Times New Roman',serif;\">${escapeHtml(asset)}</div>`,
    "</td>",
    "</tr>",
    "</table>",
    "<table role=\"presentation\" width=\"100%\" cellspacing=\"0\" cellpadding=\"0\" style=\"border-collapse:collapse;margin-top:22px;\">",
    "<tr>",
    "<td style=\"width:50%;padding:0 16px 0 0;vertical-align:top;\">",
    "<div style=\"font-size:10px;font-weight:800;letter-spacing:.18em;text-transform:uppercase;color:#6f808a;margin:0 0 8px 0;font-family:'IBM Plex Mono','Courier New',monospace;\">Firmado por</div>",
    `<div style=\"font-size:17px;line-height:1.55;color:#1d313a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;\">${escapeHtml(signer)}</div>`,
    "</td>",
    "<td style=\"width:50%;padding:0 0 0 16px;vertical-align:top;\">",
    "<div style=\"font-size:10px;font-weight:800;letter-spacing:.18em;text-transform:uppercase;color:#6f808a;margin:0 0 8px 0;font-family:'IBM Plex Mono','Courier New',monospace;\">Tecnico responsable</div>",
    `<div style=\"font-size:17px;line-height:1.55;color:#1d313a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;\">${escapeHtml(technician)}</div>`,
    "</td>",
    "</tr>",
    "</table>",
    "<div style=\"height:1px;background:linear-gradient(90deg,rgba(24,49,58,.12),rgba(24,49,58,0));margin:26px 0 18px 0;\"></div>",
    "<table role=\"presentation\" cellspacing=\"0\" cellpadding=\"0\" style=\"border-collapse:collapse;\">",
    "<tr>",
    `<td style=\"padding:0 18px 0 0;font-size:10px;font-weight:800;letter-spacing:.18em;text-transform:uppercase;color:#0f7f79;font-family:'IBM Plex Mono','Courier New',monospace;\">PDF adjunto</td>`,
    `<td style=\"padding:0 18px 0 0;font-size:10px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:#6f808a;font-family:'IBM Plex Mono','Courier New',monospace;\">${escapeHtml(generatedLabel)}</td>`,
    `<td style=\"padding:0 18px 0 0;font-size:10px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:#6f808a;font-family:'IBM Plex Mono','Courier New',monospace;\">${escapeHtml(String(normalizedIncidentCount))} incidencia(s)</td>`,
    `<td style=\"font-size:10px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:#6f808a;font-family:'IBM Plex Mono','Courier New',monospace;\">${escapeHtml(String(normalizedPhotoCount))} foto(s)</td>`,
    "</tr>",
    "</table>",
    summary
      ? `<div style=\"margin:28px 0 24px 0;padding:24px 26px;border-top:1px solid #d3dfdf;border-bottom:1px solid #d3dfdf;background:linear-gradient(180deg,rgba(240,246,246,.85),rgba(248,251,251,.92));\"><div style=\"font-size:10px;font-weight:800;letter-spacing:.2em;text-transform:uppercase;color:#6f808a;margin:0 0 12px 0;font-family:'IBM Plex Mono','Courier New',monospace;\">Nota de cierre</div><div style=\"font-size:19px;line-height:1.85;color:#243841;font-family:Georgia,'Times New Roman',serif;\">${escapeHtml(summary)}</div></div>`
      : "",
    "<table role=\"presentation\" width=\"100%\" cellspacing=\"0\" cellpadding=\"0\" style=\"border-collapse:collapse;border:1px solid #d7e2e4;border-radius:20px;\">",
    "<tr>",
    "<td style=\"padding:20px 22px;background:linear-gradient(180deg,#172830 0%,#1f3944 100%);border-radius:20px;\">",
    "<div style=\"font-size:10px;font-weight:800;letter-spacing:.18em;text-transform:uppercase;color:#9bded8;margin:0 0 10px 0;font-family:'IBM Plex Mono','Courier New',monospace;\">Documento adjunto</div>",
    `<div style=\"font-size:26px;line-height:1.2;font-weight:700;color:#ffffff;margin:0 0 10px 0;font-family:'IBM Plex Sans Condensed','Segoe UI',sans-serif;letter-spacing:.03em;text-transform:uppercase;\">${escapeHtml(filename)}</div>`,
    `<div style=\"font-size:14px;line-height:1.8;color:#d5e2e6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;\">La descarga inmediata viaja incluida en este correo. Tamano aproximado del archivo: <strong>${escapeHtml(attachmentSize)}</strong>.</div>`,
    "</td>",
    "</tr>",
    "</table>",
    "<div style=\"font-size:14px;line-height:1.9;color:#506471;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;margin:22px 0 0 0;\">Si necesitas reenviar la constancia o validar el cierre, el equipo tecnico puede regenerarla desde la instalacion correspondiente.</div>",
    "</td></tr>",
    "</table>",
    "</div>",
  ].join("");

  let response;
  try {
    response = await fetch(RESEND_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: env.RESEND_FROM_EMAIL,
        to: [recipient],
        subject,
        text,
        html,
        attachments: [
          {
            filename,
            content: attachmentBase64,
          },
        ],
      }),
    });
  } catch (error) {
    return {
      delivered: false,
      error: normalizeOptionalString(error?.message, "resend_request_failed"),
      provider: "resend",
    };
  }

  let responseBody = null;
  try {
    responseBody = await response.json();
  } catch {
    responseBody = null;
  }

  if (!response.ok) {
    const providerError =
      normalizeOptionalString(responseBody?.message, "") ||
      normalizeOptionalString(responseBody?.error, "") ||
      `resend_http_${response.status}`;
    return {
      delivered: false,
      error: providerError,
      provider: "resend",
      status_code: response.status,
    };
  }

  return {
    delivered: true,
    provider: "resend",
    message_id: normalizeOptionalString(responseBody?.id, ""),
    status_code: response.status,
  };
}
