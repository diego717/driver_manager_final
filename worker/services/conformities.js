import { PDFDocument, rgb } from "pdf-lib";

import { embedSiteOpsPdfFonts } from "./pdf-fonts.js";

import { HttpError, normalizeOptionalString } from "../lib/core.js";
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
  backdrop: rgb(0.133, 0.118, 0.188),
  canvas: rgb(0.094, 0.11, 0.17),
  card: rgb(0.125, 0.149, 0.208),
  cardSoft: rgb(0.1, 0.184, 0.153),
  ink: rgb(0.949, 0.953, 0.969),
  muted: rgb(0.72, 0.761, 0.824),
  soft: rgb(0.09, 0.122, 0.184),
  border: rgb(0.62, 0.863, 0.675),
  accent: rgb(0.788, 0.949, 0.392),
  accentSoft: rgb(0.106, 0.173, 0.153),
  accentDark: rgb(0.086, 0.11, 0.161),
  accentGlow: rgb(0.953, 0.784, 0.365),
  accentLine: rgb(0.62, 0.863, 0.675),
  warning: rgb(0.953, 0.784, 0.365),
  info: rgb(0.396, 0.788, 1),
};
const BRAND_NAME = "SiteOps";
const BRAND_TAG = "Field Control Console";
const EMAIL_FONT_DISPLAY = "'Bebas Neue','IBM Plex Sans Condensed','Arial Narrow','Franklin Gothic Condensed','Impact',sans-serif";
const EMAIL_FONT_BODY = "'Source Sans 3','Segoe UI',sans-serif";
const EMAIL_FONT_MONO = "'JetBrains Mono','IBM Plex Mono','Cascadia Mono','Consolas',monospace";

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
  const page = pdfDoc.addPage([PDF_PAGE.width, PDF_PAGE.height]);
  drawPageBackdrop(page);
  return page;
}

function createPageState(pdfDoc) {
  return {
    page: addNewPage(pdfDoc),
    y: PDF_PAGE.height - PDF_PAGE.margin,
  };
}

function drawPageBackdrop(page) {
  page.drawRectangle({
    x: 0,
    y: 0,
    width: PDF_PAGE.width,
    height: PDF_PAGE.height,
    color: PDF_COLORS.backdrop,
  });
  page.drawRectangle({
    x: 16,
    y: 16,
    width: PDF_PAGE.width - 32,
    height: PDF_PAGE.height - 32,
    borderColor: PDF_COLORS.border,
    borderWidth: 1,
    opacity: 0.55,
  });
  page.drawRectangle({
    x: PDF_PAGE.margin,
    y: PDF_PAGE.height - PDF_PAGE.margin - 6,
    width: PDF_TEXT_MAX_WIDTH,
    height: 2,
    color: PDF_COLORS.accentLine,
    opacity: 0.45,
  });
  page.drawRectangle({
    x: 88,
    y: 0,
    width: 1,
    height: PDF_PAGE.height,
    color: PDF_COLORS.border,
    opacity: 0.16,
  });
  page.drawRectangle({
    x: PDF_PAGE.width - 164,
    y: 0,
    width: 148,
    height: PDF_PAGE.height,
    color: rgb(1, 0.55, 0.1),
    opacity: 0.045,
  });
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
    "<div style=\"height:2px;width:104px;background:linear-gradient(90deg,#bff264,rgba(191,242,100,0));margin:0 0 12px 0;\"></div>",
    "<table role=\"presentation\" cellspacing=\"0\" cellpadding=\"0\" style=\"border-collapse:collapse;\">",
    "<tr>",
    "<td style=\"vertical-align:middle;padding:0 14px 0 0;\">",
    "<div style=\"width:42px;height:42px;border-radius:14px;background:linear-gradient(150deg,rgba(191,242,100,.16),rgba(32,38,53,.96));border:1px solid #9edcae;box-shadow:inset 0 1px 0 rgba(255,255,255,.18),0 10px 22px rgba(0,0,0,.26);position:relative;\">",
    "<div style=\"position:absolute;left:8px;top:8px;right:8px;height:1px;background:linear-gradient(90deg,#bff264,rgba(191,242,100,0));\"></div>",
    "<div style=\"position:absolute;left:9px;top:9px;width:15px;height:15px;border:2px solid #bff264;border-right-color:transparent;border-radius:999px;\"></div>",
    "<div style=\"position:absolute;left:9px;right:10px;top:20px;height:1px;background:#9edcae;\"></div>",
    "<div style=\"position:absolute;top:10px;bottom:10px;left:19px;width:1px;background:rgba(158,220,174,.45);\"></div>",
    "<div style=\"position:absolute;right:8px;top:8px;width:8px;height:8px;border-radius:999px;background:#bff264;box-shadow:0 0 0 3px rgba(191,242,100,.12);\"></div>",
    "</div>",
    "</td>",
    "<td style=\"vertical-align:middle;\">",
    `<div style=\"font-family:${EMAIL_FONT_DISPLAY};font-size:30px;line-height:.92;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#eef2f7;\">${escapeHtml(BRAND_NAME)}</div>`,
    `<div style=\"font-family:${EMAIL_FONT_MONO};font-size:9px;line-height:1.4;letter-spacing:.24em;text-transform:uppercase;color:#b7c0cf;margin-top:4px;\">${escapeHtml(BRAND_TAG)}</div>`,
    "</td>",
    "</tr>",
    "</table>",
    "</div>",
    "</td>",
    "</tr>",
    "</table>",
  ].join("");
}

function buildEmailInfoCardHtml(label, value, options = {}) {
  const tone = options.tone === "accent" ? "#f3c85d" : "#eef2f7";
  const size = options.size || 24;
  return [
    "<td style=\"width:50%;padding:0 8px 16px 0;vertical-align:top;\">",
    "<div style=\"position:relative;background:linear-gradient(145deg,rgba(26,33,49,.98),rgba(21,28,43,.98));border:1px solid #9edcae;border-radius:18px;padding:16px 16px 14px 16px;overflow:hidden;box-shadow:0 12px 24px rgba(0,0,0,.2);\">",
    "<div style=\"position:absolute;left:0;top:14px;bottom:14px;width:3px;background:linear-gradient(180deg,#bff264,#65c9ff);opacity:.92;\"></div>",
    "<div style=\"height:1px;background:rgba(158,220,174,.4);margin:0 0 12px 14px;\"></div>",
    `<div style=\"font-family:${EMAIL_FONT_MONO};font-size:10px;line-height:1.3;letter-spacing:.16em;text-transform:uppercase;color:#b7c0cf;margin:0 0 10px 0;\">${escapeHtml(label)}</div>`,
    `<div style=\"font-family:${EMAIL_FONT_BODY};font-size:${escapeHtml(String(size))}px;line-height:1.35;font-weight:700;color:${tone};word-break:break-word;\">${escapeHtml(value || "-")}</div>`,
    "</div>",
    "</td>",
  ].join("");
}

function buildEmailHeroStatHtml(label, value, options = {}) {
  const tone = options.tone === "accent" ? "#f3c85d" : "#eef2f7";
  return [
    "<div style=\"margin:0 0 10px 0;padding:12px 12px 10px 12px;border:1px solid rgba(158,220,174,.56);border-radius:14px;background:rgba(18,24,38,.72);\">",
    `<div style=\"font-family:${EMAIL_FONT_MONO};font-size:9px;line-height:1.3;letter-spacing:.16em;text-transform:uppercase;color:#b7c0cf;margin:0 0 6px 0;\">${escapeHtml(label)}</div>`,
    `<div style=\"font-family:${EMAIL_FONT_DISPLAY};font-size:22px;line-height:1.02;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:${tone};word-break:break-word;\">${escapeHtml(value || "-")}</div>`,
    "</div>",
  ].join("");
}

function buildEmailHeroChipHtml(value) {
  return `<span style=\"display:inline-block;margin:0 8px 8px 0;padding:7px 10px;border:1px dashed rgba(158,220,174,.72);border-radius:999px;background:rgba(18,24,38,.92);font-family:${EMAIL_FONT_MONO};font-size:10px;line-height:1;letter-spacing:.14em;text-transform:uppercase;color:#dce7f0;\">${escapeHtml(value)}</span>`;
}

function drawSectionTitle(state, font, text) {
  state.page.drawRectangle({
    x: PDF_PAGE.margin,
    y: state.y - 3,
    width: 46,
    height: 3,
    color: PDF_COLORS.accentLine,
    opacity: 0.95,
  });
  state.page.drawText(normalizePdfText(text), {
    x: PDF_PAGE.margin,
    y: state.y - 14,
    size: 12.5,
    font,
    color: PDF_COLORS.accentGlow,
    characterSpacing: 0.55,
  });
  state.y -= 30;
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
    color: PDF_COLORS.card,
    borderColor: PDF_COLORS.border,
    borderWidth: 1,
    opacity: 0.98,
  });
  page.drawRectangle({
    x: x + 14,
    y: y - 10,
    width: width - 28,
    height: 1,
    color: PDF_COLORS.border,
    opacity: 0.36,
  });
  page.drawRectangle({
    x,
    y: y - height + 14,
    width: 2,
    height: height - 28,
    color: PDF_COLORS.accentLine,
    opacity: 0.9,
  });
  page.drawRectangle({
    x,
    y: y - 3,
    width,
    height: 3,
    color: PDF_COLORS.accentLine,
    opacity: 0.95,
  });
  page.drawRectangle({
    x: x + 1,
    y: y - height + 1,
    width: width - 2,
    height: 20,
    color: PDF_COLORS.cardSoft,
    opacity: 0.3,
  });

  page.drawText(normalizePdfText(label), {
    x: x + 14,
    y: y - 18,
    size: 8.6,
    font: titleFont,
    color: PDF_COLORS.muted,
    characterSpacing: 0.5,
  });

  const valueLines = wrapText(value, Math.max(18, Math.floor((width - 28) / 7))).slice(0, 3);
  drawLinesInBox(page, bodyFont, valueLines, {
    x: x + 14,
    y: y - 37,
    size: 12.2,
    lineHeight: 15,
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
    x: PDF_PAGE.margin + 2,
    y: nextState.y - boxHeight - 3,
    width: PDF_TEXT_MAX_WIDTH,
    height: boxHeight,
    color: rgb(0.2, 0.32, 0.4),
    opacity: 0.06,
  });
  nextState.page.drawRectangle({
    x: PDF_PAGE.margin,
    y: nextState.y - boxHeight,
    width: PDF_TEXT_MAX_WIDTH,
    height: boxHeight,
    color: fillColor,
    borderColor,
    borderWidth: 1,
  });
  nextState.page.drawRectangle({
    x: PDF_PAGE.margin + 14,
    y: nextState.y - 10,
    width: PDF_TEXT_MAX_WIDTH - 28,
    height: 1,
    color: PDF_COLORS.border,
    opacity: 0.3,
  });
  nextState.page.drawRectangle({
    x: PDF_PAGE.margin,
    y: nextState.y - boxHeight + 14,
    width: 2,
    height: Math.max(18, boxHeight - 28),
    color: PDF_COLORS.accentLine,
    opacity: 0.9,
  });
  nextState.page.drawRectangle({
    x: PDF_PAGE.margin,
    y: nextState.y - 3,
    width: Math.min(82, PDF_TEXT_MAX_WIDTH),
    height: 3,
    color: PDF_COLORS.accentLine,
    opacity: 0.9,
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
    budget_id:
      row.budget_id === null || row.budget_id === undefined
        ? null
        : Number(row.budget_id),
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
  let installation = null;
  try {
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
        commercial_closure_mode,
        commercial_closure_note,
        commercial_closure_set_at,
        commercial_closure_set_by
      FROM installations
      WHERE id = ?
        AND tenant_id = ?
      LIMIT 1
    `)
      .bind(installationId, tenantId)
      .all();
    installation = installationRows?.[0] || null;
  } catch (error) {
    const message = normalizeOptionalString(error?.message, "").toLowerCase();
    const missingCommercialClosureColumn =
      (message.includes("no such column") || message.includes("has no column named")) &&
      message.includes("commercial_closure_mode");
    if (!missingCommercialClosureColumn) {
      throw error;
    }
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
        notes
      FROM installations
      WHERE id = ?
        AND tenant_id = ?
      LIMIT 1
    `)
      .bind(installationId, tenantId)
      .all();
    const legacyInstallation = installationRows?.[0] || null;
    installation = legacyInstallation
      ? {
          ...legacyInstallation,
          commercial_closure_mode: "budget_required",
          commercial_closure_note: "",
          commercial_closure_set_at: "",
          commercial_closure_set_by: "",
        }
      : null;
  }
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

  const { titleFont, bodyFont } = await embedSiteOpsPdfFonts(pdfDoc);
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
  const heroHeight = 162;
  const heroBottomY = state.y - heroHeight;
  const metaColumnWidth = 164;
  const heroLeftWidth = PDF_TEXT_MAX_WIDTH - metaColumnWidth - 14;
  const heroMetaX = PDF_PAGE.margin + heroLeftWidth + 14;
  state.page.drawRectangle({
    x: PDF_PAGE.margin,
    y: heroBottomY,
    width: PDF_TEXT_MAX_WIDTH,
    height: heroHeight,
    color: PDF_COLORS.canvas,
    borderColor: PDF_COLORS.border,
    borderWidth: 1,
  });
  state.page.drawRectangle({
    x: PDF_PAGE.margin,
    y: state.y - 4,
    width: PDF_TEXT_MAX_WIDTH,
    height: 4,
    color: PDF_COLORS.accentLine,
    opacity: 0.96,
  });
  state.page.drawRectangle({
    x: PDF_PAGE.margin,
    y: heroBottomY,
    width: heroLeftWidth,
    height: heroHeight,
    color: PDF_COLORS.accentDark,
  });
  state.page.drawRectangle({
    x: PDF_PAGE.margin,
    y: heroBottomY + 10,
    width: heroLeftWidth,
    height: heroHeight - 20,
    color: rgb(0.2, 0.38, 0.44),
    opacity: 0.14,
  });
  state.page.drawRectangle({
    x: heroMetaX,
    y: heroBottomY,
    width: metaColumnWidth,
    height: heroHeight,
    color: PDF_COLORS.cardSoft,
  });
  state.page.drawRectangle({
    x: heroMetaX,
    y: heroBottomY,
    width: 1,
    height: heroHeight,
    color: PDF_COLORS.border,
  });

  drawPdfBrandLockup(state.page, titleFont, bodyFont, {
    x: PDF_PAGE.margin + 20,
    y: state.y - 20,
    scale: 0.88,
    light: true,
  });

  state.page.drawRectangle({
    x: PDF_PAGE.margin + 20,
    y: state.y - 74,
    width: 122,
    height: 18,
    color: PDF_COLORS.accentGlow,
    opacity: 0.9,
  });
  state.page.drawText("CONFORMIDAD FINAL", {
    x: PDF_PAGE.margin + 26,
    y: state.y - 67,
    size: 7.5,
    font: titleFont,
    color: PDF_COLORS.accentDark,
    characterSpacing: 0.7,
  });

  state.page.drawText("Constancia Operativa", {
    x: PDF_PAGE.margin + 20,
    y: state.y - 114,
    size: 23,
    font: titleFont,
    color: rgb(0.965, 0.986, 0.992),
  });
  state.page.drawText(`Registro #${normalizePdfText(String(context.installation.id))}`, {
    x: PDF_PAGE.margin + 20,
    y: state.y - 133,
    size: 12.5,
    font: bodyFont,
    color: rgb(0.79, 0.9, 0.93),
  });
  state.page.drawText("Documento operativo emitido por SiteOps", {
    x: PDF_PAGE.margin + 20,
    y: state.y - 147,
    size: 8.6,
    font: bodyFont,
    color: rgb(0.66, 0.79, 0.83),
  });

  state.page.drawText("Generado", {
    x: heroMetaX + 14,
    y: state.y - 34,
    size: 8.2,
    font: titleFont,
    color: PDF_COLORS.muted,
    characterSpacing: 0.6,
  });
  state.page.drawText(normalizePdfText(formatEmailDate(generatedAt)), {
    x: heroMetaX + 14,
    y: state.y - 49,
    size: 10,
    font: bodyFont,
    color: PDF_COLORS.ink,
    maxWidth: metaColumnWidth - 28,
  });
  state.page.drawText("Firmante", {
    x: heroMetaX + 14,
    y: state.y - 74,
    size: 8.2,
    font: titleFont,
    color: PDF_COLORS.muted,
    characterSpacing: 0.6,
  });
  state.page.drawText(normalizePdfText(signedByName || "Sin firmante"), {
    x: heroMetaX + 14,
    y: state.y - 89,
    size: 10,
    font: bodyFont,
    color: PDF_COLORS.ink,
    maxWidth: metaColumnWidth - 28,
  });
  state.page.drawText("Tecnico", {
    x: heroMetaX + 14,
    y: state.y - 114,
    size: 8.2,
    font: titleFont,
    color: PDF_COLORS.muted,
    characterSpacing: 0.6,
  });
  state.page.drawText(normalizePdfText(resolvedTechnicianName), {
    x: heroMetaX + 14,
    y: state.y - 129,
    size: 10,
    font: bodyFont,
    color: PDF_COLORS.ink,
    maxWidth: metaColumnWidth - 28,
  });

  state.y = heroBottomY - 20;

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
    fillColor: PDF_COLORS.card,
    borderColor: PDF_COLORS.border,
    textColor: PDF_COLORS.ink,
    maxChars: 88,
    fontSize: 10.8,
    paddingX: 16,
    paddingTop: 16,
    paddingBottom: 14,
  });

  const gpsSnapshot = buildGpsMetadataSnapshot(gps);
  const gpsMapsUrl = buildGpsMapsUrl(gps);
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
    fillColor: PDF_COLORS.soft,
    borderColor: PDF_COLORS.info,
    textColor: PDF_COLORS.ink,
    maxChars: 84,
    fontSize: 10.6,
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
      color: PDF_COLORS.card,
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
      { maxChars: 82, size: 9, color: PDF_COLORS.muted },
    );
  }

  if (summaryNote) {
    state.y -= 8;
    drawSectionTitle(state, titleFont, "Nota de cierre");
    state = drawPdfTextPanel(pdfDoc, state, bodyFont, summaryNote, {
      fillColor: PDF_COLORS.accentSoft,
      borderColor: PDF_COLORS.accentLine,
      textColor: PDF_COLORS.ink,
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
      fillColor: PDF_COLORS.soft,
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
      color: PDF_COLORS.card,
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
      const incidentLineItems = wrapText(
        `#${incident.id} | ${normalizeOptionalString(incident.severity, "medium")} | ${normalizeOptionalString(incident.incident_status, "open")} | ${normalizeOptionalString(incident.note, "")}`,
        82,
      );
      const incidentPaddingTop = 11;
      const incidentPaddingBottom = 9;
      const incidentTextSize = 10.6;
      const incidentLineHeight = PDF_LINE_HEIGHT;
      const incidentBoxHeight = Math.max(
        27,
        incidentPaddingTop + incidentPaddingBottom + (incidentLineItems.length * incidentLineHeight) - 3,
      );
      state = ensurePageSpace(pdfDoc, state, incidentBoxHeight + 12);
      state.page.drawRectangle({
        x: PDF_PAGE.margin,
        y: state.y - incidentBoxHeight,
        width: PDF_TEXT_MAX_WIDTH,
        height: incidentBoxHeight,
        color: PDF_COLORS.card,
        borderColor: PDF_COLORS.border,
        borderWidth: 1,
      });
      state.page.drawRectangle({
        x: PDF_PAGE.margin,
        y: state.y - 3,
        width: 64,
        height: 3,
        color: PDF_COLORS.accentLine,
        opacity: 0.92,
      });
      drawLinesInBox(state.page, bodyFont, incidentLineItems, {
        x: PDF_PAGE.margin + 10,
        y: state.y - incidentPaddingTop - incidentTextSize,
        size: incidentTextSize,
        color: PDF_COLORS.ink,
        lineHeight: incidentLineHeight,
      });
      state.y -= incidentBoxHeight + 8;
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
      y: PDF_PAGE.margin,
      width: PDF_TEXT_MAX_WIDTH,
      height: PDF_PAGE.height - (PDF_PAGE.margin * 2),
      color: PDF_COLORS.canvas,
      borderColor: PDF_COLORS.border,
      borderWidth: 1,
    });
    page.drawRectangle({
      x: PDF_PAGE.margin,
      y: PDF_PAGE.height - PDF_PAGE.margin - photoHeaderHeight,
      width: PDF_TEXT_MAX_WIDTH,
      height: photoHeaderHeight,
      color: PDF_COLORS.accentDark,
    });
    page.drawRectangle({
      x: PDF_PAGE.margin,
      y: PDF_PAGE.height - PDF_PAGE.margin - 4,
      width: PDF_TEXT_MAX_WIDTH,
      height: 4,
      color: PDF_COLORS.accentLine,
      opacity: 0.96,
    });
    page.drawText("Evidencia fotografica", {
      x: PDF_PAGE.margin + 12,
      y: PDF_PAGE.height - PDF_PAGE.margin - 18,
      size: 16.5,
      font: titleFont,
      color: rgb(1, 1, 1),
    });
    page.drawText(`Registro #${normalizePdfText(String(context.installation.id))}`, {
      x: PDF_PAGE.margin + 12,
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
    budgetId = null,
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
      budget_id,
      metadata_json
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      budgetId,
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
  const subject = `SiteOps | Documento operativo | instalacion #${installationId}`;
  const filename = `conformidad_instalacion_${installationId}.pdf`;
  const attachmentBase64 = encodeBytesToBase64(pdfBytes);
  const attachmentSize = formatAttachmentSize(pdfBytes.byteLength);
  const text = [
    "Adjuntamos la conformidad de servicio emitida desde SiteOps.",
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
    `<div style="margin:0;padding:30px 16px;background:#211c2e;background-image:linear-gradient(90deg,rgba(94,122,255,.1) 1px,transparent 1px),linear-gradient(0deg,rgba(94,122,255,.08) 1px,transparent 1px),radial-gradient(circle at 8% -10%,rgba(243,200,93,.18),transparent 34%),radial-gradient(circle at 98% 2%,rgba(167,243,107,.14),transparent 34%),linear-gradient(125deg,#211c2e,#162231 42%,#173127);background-size:120px 120px,120px 120px,auto,auto,auto;font-family:${EMAIL_FONT_BODY};color:#eef2f7;">`,
    "<table role=\"presentation\" width=\"100%\" cellspacing=\"0\" cellpadding=\"0\" style=\"max-width:760px;margin:0 auto;border-collapse:collapse;\">",
    "<tr><td style=\"padding:0 0 16px 0;\">",
    buildEmailBrandLockupHtml(),
    "</td></tr>",
    "<tr><td style=\"padding:0 0 16px 0;\">",
    "<table role=\"presentation\" cellspacing=\"0\" cellpadding=\"0\" style=\"border-collapse:collapse;\">",
    "<tr>",
    "<td style=\"padding:0 12px 0 0;vertical-align:middle;\">",
    `<div style="display:inline-block;padding:7px 11px;border:1px dashed rgba(158,220,174,.78);border-radius:999px;background:rgba(22,28,43,.9);color:#dce7f0;font-size:10px;font-weight:800;letter-spacing:.16em;text-transform:uppercase;font-family:${EMAIL_FONT_MONO};">Documento operativo</div>`,
    "</td>",
    "<td style=\"vertical-align:middle;\">",
    "<div style=\"height:1px;width:120px;background:linear-gradient(90deg,rgba(191,242,100,.62),rgba(101,201,255,0));\"></div>",
    "</td>",
    "</tr>",
    "</table>",
    "</td></tr>",
    "<tr><td style=\"background:linear-gradient(180deg,rgba(24,28,43,.98),rgba(18,24,38,.98));border:1px solid rgba(158,220,174,.72);border-radius:26px;padding:0;box-shadow:0 20px 44px rgba(0,0,0,.28);overflow:hidden;\">",
    "<div style=\"height:3px;background:linear-gradient(90deg,#bff264 0%,#65c9ff 52%,rgba(101,201,255,.12) 100%);\"></div>",
    "<table role=\"presentation\" width=\"100%\" cellspacing=\"0\" cellpadding=\"0\" style=\"border-collapse:collapse;\">",
    "<tr>",
    "<td style=\"padding:22px 22px 20px 22px;vertical-align:top;background:linear-gradient(90deg,rgba(72,33,38,.26) 0%,rgba(25,35,49,.98) 36%,rgba(18,24,38,.98) 100%);border-right:1px solid rgba(158,220,174,.36);\">",
    `<div style="display:inline-block;padding:8px 12px;border:1px solid rgba(158,220,174,.78);border-radius:999px;background:rgba(18,24,38,.46);color:#dce7f0;font-size:10px;font-weight:800;letter-spacing:.16em;text-transform:uppercase;font-family:${EMAIL_FONT_MONO};">Conformidad final</div>`,
    `<div style="font-size:40px;line-height:.94;font-weight:700;color:#eef2f7;margin:18px 0 10px 0;font-family:${EMAIL_FONT_DISPLAY};letter-spacing:.06em;text-transform:uppercase;">Registro #${escapeHtml(String(installationId))}</div>`,
    "<div style=\"width:108px;height:2px;background:linear-gradient(90deg,#bff264,#65c9ff 72%,rgba(101,201,255,0));margin:0 0 16px 0;\"></div>",
    `<div style="font-size:15px;line-height:1.72;color:#b7c0cf;max-width:420px;font-family:${EMAIL_FONT_BODY};">La conformidad final ya fue emitida desde <strong>SiteOps</strong>. El documento adjunto consolida cierre operativo, firma del responsable y evidencia asociada dentro del mismo contexto del registro.</div>`,
    "</td>",
    "<td style=\"width:220px;padding:18px 18px 12px 18px;vertical-align:top;background:linear-gradient(180deg,rgba(27,39,59,.82),rgba(18,24,38,.96));\">",
    buildEmailHeroStatHtml("Generado", generatedLabel),
    buildEmailHeroStatHtml("Incidencias", String(normalizedIncidentCount), { tone: "accent" }),
    buildEmailHeroStatHtml("Fotos", String(normalizedPhotoCount)),
    buildEmailHeroStatHtml("Documento", "Operativo"),
    "</td>",
    "</tr>",
    "<tr><td colspan=\"2\" style=\"padding:14px 22px 18px 22px;border-top:1px solid rgba(158,220,174,.3);background:rgba(18,24,38,.72);\">",
    buildEmailHeroChipHtml("cierre operativo"),
    buildEmailHeroChipHtml("constancia emitida"),
    buildEmailHeroChipHtml("siteops"),
    "</td></tr>",
    "</table>",
    "<div style=\"padding:20px 22px 4px 22px;\">",
    "<table role=\"presentation\" width=\"100%\" cellspacing=\"0\" cellpadding=\"0\" style=\"border-collapse:collapse;\">",
    "<tr>",
    buildEmailInfoCardHtml(clientPresentation.label, clientPresentation.value),
    buildEmailInfoCardHtml("Activo", asset, { size: 18 }),
    "</tr>",
    "<tr>",
    buildEmailInfoCardHtml("Firmado por", signer, { size: 18 }),
    buildEmailInfoCardHtml("Tecnico responsable", technician, { size: 18 }),
    "</tr>",
    "</table>",
    `<div style="font-size:10px;font-weight:800;letter-spacing:.16em;text-transform:uppercase;color:#b7c0cf;margin:0 0 8px 0;font-family:${EMAIL_FONT_MONO};">PDF adjunto</div>`,
    `<div style="font-size:10px;line-height:1.75;color:#b7c0cf;font-family:${EMAIL_FONT_MONO};text-transform:uppercase;letter-spacing:.12em;">${escapeHtml(generatedLabel)}&nbsp;&nbsp;|&nbsp;&nbsp;${escapeHtml(String(normalizedIncidentCount))} incidencia(s)&nbsp;&nbsp;|&nbsp;&nbsp;${escapeHtml(String(normalizedPhotoCount))} foto(s)</div>`,
    summary
      ? `<div style="margin:22px 0 20px 0;padding:18px 18px;border:1px solid rgba(158,220,174,.56);background:linear-gradient(180deg,rgba(26,33,49,.96),rgba(18,24,38,.96));border-radius:18px;box-shadow:inset 0 1px 0 rgba(255,255,255,.08);"><div style="font-size:10px;font-weight:800;letter-spacing:.18em;text-transform:uppercase;color:#b7c0cf;margin:0 0 10px 0;font-family:${EMAIL_FONT_MONO};">Nota de cierre</div><div style="font-size:15px;line-height:1.72;color:#eef2f7;font-family:${EMAIL_FONT_BODY};">${escapeHtml(summary)}</div></div>`
      : "",
    "<table role=\"presentation\" width=\"100%\" cellspacing=\"0\" cellpadding=\"0\" style=\"border-collapse:collapse;border:1px solid rgba(158,220,174,.56);border-radius:18px;\">",
    "<tr>",
    "<td style=\"padding:18px 18px;background:linear-gradient(180deg,rgba(24,28,43,.92) 0%,rgba(27,39,59,.94) 100%);border-radius:18px;\">",
    `<div style="font-size:10px;font-weight:800;letter-spacing:.18em;text-transform:uppercase;color:#b7c0cf;margin:0 0 10px 0;font-family:${EMAIL_FONT_MONO};">Documento adjunto</div>`,
    `<div style="font-size:26px;line-height:1.02;font-weight:700;color:#eef2f7;margin:0 0 10px 0;font-family:${EMAIL_FONT_DISPLAY};letter-spacing:.05em;text-transform:uppercase;word-break:break-word;">${escapeHtml(filename)}</div>`,
    `<div style="font-size:13px;line-height:1.75;color:#d7e8f6;font-family:${EMAIL_FONT_BODY};">El PDF viaja adjunto en este correo como constancia operativa del cierre. Tamano aproximado del archivo: <strong>${escapeHtml(attachmentSize)}</strong>.</div>`,
    "</td>",
    "</tr>",
    "</table>",
    `<div style="font-size:13px;line-height:1.8;color:#b7c0cf;font-family:${EMAIL_FONT_BODY};margin:18px 0 0 0;">Si necesitas reenviar la conformidad o validar el cierre, el equipo puede regenerarla desde la misma instalacion sin perder el contexto operativo.</div>`,
    "</div>",
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
