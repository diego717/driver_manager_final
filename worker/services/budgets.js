import { PDFDocument, rgb } from "pdf-lib";

import { embedSiteOpsPdfFonts } from "./pdf-fonts.js";

import { HttpError, normalizeOptionalString } from "../lib/core.js";

const BUDGET_PDF_CONTENT_TYPE = "application/pdf";
const RESEND_API_URL = "https://api.resend.com/emails";
const RESEND_MAX_ATTACHMENT_BYTES = 28 * 1024 * 1024;

const PDF_PAGE = {
  width: 595.28,
  height: 841.89,
  margin: 40,
};
const PDF_TEXT_MAX_WIDTH = PDF_PAGE.width - PDF_PAGE.margin * 2;
const PDF_LINE_HEIGHT = 15;
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
};
const BRAND_NAME = "SiteOps";
const BRAND_TAG = "Field Control Console";
const EMAIL_FONT_DISPLAY = "'Bebas Neue','IBM Plex Sans Condensed','Arial Narrow','Franklin Gothic Condensed','Impact',sans-serif";
const EMAIL_FONT_BODY = "'Source Sans 3','Segoe UI',sans-serif";
const EMAIL_FONT_MONO = "'JetBrains Mono','IBM Plex Mono','Cascadia Mono','Consolas',monospace";

function requireBudgetsBucketOperation(env, operation) {
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

function formatDateTime(value) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return "Sin fecha";
  return date.toLocaleString("es-ES");
}

function normalizePdfText(value) {
  return normalizeOptionalString(value, "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x20-\x7E\n]/g, " ")
    .replace(/\r/g, "")
    .trim();
}

function escapeHtml(value) {
  return normalizeOptionalString(value, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function normalizeMoneyCents(value, fieldName) {
  const numeric = Number.parseInt(String(value ?? "0"), 10);
  if (!Number.isInteger(numeric) || numeric < 0) {
    throw new HttpError(400, `Campo '${fieldName}' invalido.`);
  }
  return numeric;
}

function normalizeBudgetRow(row) {
  if (!row) return null;
  return {
    ...row,
    id: Number(row.id),
    installation_id: Number(row.installation_id),
    labor_amount_cents: Number(row.labor_amount_cents) || 0,
    parts_amount_cents: Number(row.parts_amount_cents) || 0,
    tax_amount_cents: Number(row.tax_amount_cents) || 0,
    total_amount_cents: Number(row.total_amount_cents) || 0,
    estimated_days:
      row.estimated_days === null || row.estimated_days === undefined
        ? null
        : Number(row.estimated_days),
    created_by_user_id:
      row.created_by_user_id === null || row.created_by_user_id === undefined
        ? null
        : Number(row.created_by_user_id),
  };
}

function wrapText(text, maxChars = 90) {
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

function addPage(pdfDoc) {
  const page = pdfDoc.addPage([PDF_PAGE.width, PDF_PAGE.height]);
  drawPageBackdrop(page);
  return page;
}

function ensurePageSpace(pdfDoc, state, requiredHeight = PDF_LINE_HEIGHT * 3) {
  if (state.y - requiredHeight >= PDF_PAGE.margin) return state;
  return {
    page: addPage(pdfDoc),
    y: PDF_PAGE.height - PDF_PAGE.margin,
  };
}

function drawSectionTitle(pdfDoc, state, font, text) {
  const nextState = ensurePageSpace(pdfDoc, state, 26);
  nextState.page.drawRectangle({
    x: PDF_PAGE.margin,
    y: nextState.y - 3,
    width: 46,
    height: 3,
    color: PDF_COLORS.accentLine,
    opacity: 0.95,
  });
  nextState.page.drawText(normalizePdfText(text), {
    x: PDF_PAGE.margin,
    y: nextState.y - 14,
    size: 12.5,
    font,
    color: PDF_COLORS.accentGlow,
    characterSpacing: 0.55,
  });
  nextState.y -= 30;
  return nextState;
}

function drawLines(pdfDoc, state, font, lines, options = {}) {
  const safeLines = Array.isArray(lines) ? lines : [];
  let nextState = state;
  for (const line of safeLines) {
    nextState = ensurePageSpace(pdfDoc, nextState, PDF_LINE_HEIGHT + 3);
    nextState.page.drawText(normalizePdfText(line), {
      x: options.x || PDF_PAGE.margin,
      y: nextState.y,
      size: options.size || 11,
      font,
      color: options.color || PDF_COLORS.ink,
      maxWidth: options.maxWidth || PDF_TEXT_MAX_WIDTH,
    });
    nextState.y -= PDF_LINE_HEIGHT;
  }
  return nextState;
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

function drawBrandLockup(page, titleFont, bodyFont, {
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

function drawInfoCard(page, titleFont, bodyFont, {
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
  let lineY = y - 37;
  for (const line of valueLines) {
    page.drawText(normalizePdfText(line), {
      x: x + 14,
      y: lineY,
      size: 12.2,
      font: bodyFont,
      color: PDF_COLORS.ink,
    });
    lineY -= 15;
  }
}

function drawTextPanel(pdfDoc, state, bodyFont, text, {
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

  let cursorY = nextState.y - paddingTop - fontSize;
  for (const line of lines) {
    nextState.page.drawText(normalizePdfText(line), {
      x: PDF_PAGE.margin + paddingX,
      y: cursorY,
      size: fontSize,
      font: bodyFont,
      color: textColor,
      maxWidth: PDF_TEXT_MAX_WIDTH - (paddingX * 2),
    });
    cursorY -= lineHeight;
  }
  nextState.y = cursorY - paddingBottom;
  return nextState;
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
    "<div style=\"position:absolute;left:8px;top:8px;right:8px;height:1px;background:linear-gradient(90deg,rgba(191,242,100,.9),rgba(191,242,100,0));\"></div>",
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

function formatAttachmentSize(bytes) {
  const safeBytes = Math.max(0, Number(bytes) || 0);
  if (safeBytes >= 1024 * 1024) {
    return `${(safeBytes / (1024 * 1024)).toFixed(2)} MB`;
  }
  if (safeBytes >= 1024) {
    return `${Math.round(safeBytes / 1024)} KB`;
  }
  return `${safeBytes} bytes`;
}

function toBase64(bytes) {
  if (!bytes?.byteLength) return "";
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, index + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

function formatMoney(cents, currencyCode = "UYU") {
  const value = Number(cents) || 0;
  const normalizedCurrency = normalizeOptionalString(currencyCode, "UYU").toUpperCase() || "UYU";
  return new Intl.NumberFormat("es-UY", {
    style: "currency",
    currency: normalizedCurrency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value / 100);
}

function normalizeCurrencyCode(value) {
  const normalized = normalizeOptionalString(value, "UYU").trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(normalized)) {
    throw new HttpError(400, "Campo 'currency_code' invalido.");
  }
  return normalized;
}

function normalizeDateOnly(value, fieldName) {
  const normalized = normalizeOptionalString(value, "").trim();
  if (!normalized) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    throw new HttpError(400, `Campo '${fieldName}' invalido. Usa YYYY-MM-DD.`);
  }
  return normalized;
}

function normalizeShortText(value, fieldName, maxLength, required = false) {
  const normalized = normalizeOptionalString(value, "").replace(/\s+/g, " ").trim();
  if (required && !normalized) {
    throw new HttpError(400, `Campo '${fieldName}' es obligatorio.`);
  }
  if (normalized.length > maxLength) {
    throw new HttpError(400, `Campo '${fieldName}' supera el limite permitido.`);
  }
  return normalized;
}

function normalizeLongText(value, fieldName, maxLength, required = false) {
  const normalized = normalizeOptionalString(value, "").trim();
  if (required && !normalized) {
    throw new HttpError(400, `Campo '${fieldName}' es obligatorio.`);
  }
  if (normalized.length > maxLength) {
    throw new HttpError(400, `Campo '${fieldName}' supera el limite permitido.`);
  }
  return normalized;
}

export function normalizeBudgetCreatePayload(body) {
  const laborAmountCents = normalizeMoneyCents(body?.labor_amount_cents, "labor_amount_cents");
  const partsAmountCents = normalizeMoneyCents(body?.parts_amount_cents, "parts_amount_cents");
  const taxAmountCents = normalizeMoneyCents(body?.tax_amount_cents, "tax_amount_cents");
  const totalAmountCents = laborAmountCents + partsAmountCents + taxAmountCents;
  const estimatedDaysRaw = normalizeOptionalString(body?.estimated_days, "").trim();
  const estimatedDays = estimatedDaysRaw
    ? Number.parseInt(estimatedDaysRaw, 10)
    : null;
  if (estimatedDays !== null && (!Number.isInteger(estimatedDays) || estimatedDays < 0)) {
    throw new HttpError(400, "Campo 'estimated_days' invalido.");
  }

  return {
    incidenceSummary: normalizeLongText(body?.incidence_summary, "incidence_summary", 2000, true),
    scopeIncluded: normalizeLongText(body?.scope_included, "scope_included", 4000, true),
    scopeExcluded: normalizeLongText(body?.scope_excluded, "scope_excluded", 3000, false),
    laborAmountCents,
    partsAmountCents,
    taxAmountCents,
    totalAmountCents,
    currencyCode: normalizeCurrencyCode(body?.currency_code),
    estimatedDays,
    validUntil: normalizeDateOnly(body?.valid_until, "valid_until"),
    emailTo: normalizeShortText(body?.email_to, "email_to", 320, false),
    sendEmail: body?.send_email === true,
    metadataJson: normalizeOptionalString(body?.metadata_json, "").trim() || "{}",
  };
}

export function normalizeBudgetApprovePayload(body) {
  const approvedByName = normalizeShortText(body?.approved_by_name, "approved_by_name", 180, true);
  const approvedByChannel = normalizeShortText(
    body?.approved_by_channel,
    "approved_by_channel",
    80,
    true,
  ).toLowerCase();
  const approvalNote = normalizeLongText(body?.approval_note, "approval_note", 2000, false);

  return {
    approvedByName,
    approvedByChannel,
    approvalNote,
  };
}

export function buildBudgetPdfDownloadPath(installationId, budgetId) {
  return `/web/installations/${installationId}/budgets/${budgetId}/pdf`;
}

export function buildBudgetNumber(nowIsoValue, installationId) {
  const safeDate = normalizeOptionalString(nowIsoValue, new Date().toISOString()).slice(0, 10).replace(/-/g, "");
  const suffix = randomSuffix().slice(0, 4).toUpperCase();
  return `P-${safeDate}-${installationId}-${suffix}`;
}

export async function loadInstallationBudgetContext(env, { installationId, tenantId }) {
  const { results: installationRows } = await env.DB.prepare(`
    SELECT
      id,
      tenant_id,
      timestamp,
      driver_brand,
      driver_version,
      status,
      client_name,
      notes
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
        a.client_name
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

  return {
    installation,
    asset,
  };
}

export async function generateInstallationBudgetPdf({
  context,
  budget,
  createdAt,
  createdByUsername,
}) {
  const pdfDoc = await PDFDocument.create();
  pdfDoc.setTitle(`Presupuesto ${budget.budgetNumber}`);
  pdfDoc.setSubject("Presupuesto por incidencia");
  pdfDoc.setAuthor(normalizePdfText(createdByUsername || "SiteOps"));
  pdfDoc.setCreator("SiteOps Worker");
  pdfDoc.setProducer("pdf-lib");
  pdfDoc.setCreationDate(new Date(createdAt));
  pdfDoc.setModificationDate(new Date(createdAt));

  const { titleFont, bodyFont } = await embedSiteOpsPdfFonts(pdfDoc);
  const assetReference =
    normalizeOptionalString(context.asset?.external_code, "") ||
    normalizeOptionalString(context.asset?.serial_number, "") ||
    normalizeOptionalString(context.asset?.model, "") ||
    "Sin activo vinculado";
  const clientLabel =
    normalizeOptionalString(context.installation.client_name, "Sin cliente") ||
    "Sin cliente";
  const page = addPage(pdfDoc);
  let state = {
    page,
    y: PDF_PAGE.height - PDF_PAGE.margin,
  };
  const generatedLabel = formatDateTime(createdAt);
  const approvalStatusLabel =
    budget.approvalStatus === "approved"
      ? "Aprobado"
      : budget.approvalStatus === "superseded"
        ? "Reemplazado"
        : "Pendiente";

  const heroHeight = 168;
  const heroBottomY = state.y - heroHeight;
  const metaColumnWidth = 170;
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

  drawBrandLockup(state.page, titleFont, bodyFont, {
    x: PDF_PAGE.margin + 20,
    y: state.y - 20,
    scale: 0.88,
    light: true,
  });

  state.page.drawRectangle({
    x: PDF_PAGE.margin + 20,
    y: state.y - 74,
    width: 140,
    height: 18,
    color: PDF_COLORS.accentGlow,
    opacity: 0.9,
  });
  state.page.drawText("PRESUPUESTO OPERATIVO", {
    x: PDF_PAGE.margin + 26,
    y: state.y - 67,
    size: 7.5,
    font: titleFont,
    color: PDF_COLORS.accentDark,
    characterSpacing: 0.72,
  });
  state.page.drawText("Presupuesto de servicio", {
    x: PDF_PAGE.margin + 20,
    y: state.y - 114,
    size: 22.4,
    font: titleFont,
    color: rgb(0.965, 0.986, 0.992),
  });
  state.page.drawText(`Numero ${normalizePdfText(budget.budgetNumber)}`, {
    x: PDF_PAGE.margin + 20,
    y: state.y - 133,
    size: 12.3,
    font: bodyFont,
    color: rgb(0.79, 0.9, 0.93),
  });
  state.page.drawText("Documento comercial emitido por SiteOps", {
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
  state.page.drawText(normalizePdfText(generatedLabel), {
    x: heroMetaX + 14,
    y: state.y - 49,
    size: 9.8,
    font: bodyFont,
    color: PDF_COLORS.ink,
    maxWidth: metaColumnWidth - 28,
  });
  state.page.drawText("Moneda", {
    x: heroMetaX + 14,
    y: state.y - 74,
    size: 8.2,
    font: titleFont,
    color: PDF_COLORS.muted,
    characterSpacing: 0.6,
  });
  state.page.drawText(normalizePdfText(budget.currencyCode), {
    x: heroMetaX + 14,
    y: state.y - 89,
    size: 10.2,
    font: bodyFont,
    color: PDF_COLORS.ink,
    maxWidth: metaColumnWidth - 28,
  });
  state.page.drawText("Estado", {
    x: heroMetaX + 14,
    y: state.y - 114,
    size: 8.2,
    font: titleFont,
    color: PDF_COLORS.muted,
    characterSpacing: 0.6,
  });
  state.page.drawText(normalizePdfText(approvalStatusLabel), {
    x: heroMetaX + 14,
    y: state.y - 129,
    size: 10.2,
    font: bodyFont,
    color: PDF_COLORS.ink,
    maxWidth: metaColumnWidth - 28,
  });
  state.page.drawText("Total", {
    x: heroMetaX + 14,
    y: state.y - 149,
    size: 8.2,
    font: titleFont,
    color: PDF_COLORS.muted,
    characterSpacing: 0.6,
  });
  state.page.drawText(
    normalizePdfText(formatMoney(budget.totalAmountCents, budget.currencyCode)),
    {
      x: heroMetaX + 14,
      y: state.y - 163,
      size: 10.8,
      font: titleFont,
      color: PDF_COLORS.accentDark,
      maxWidth: metaColumnWidth - 28,
    },
  );
  state.y = heroBottomY - 20;

  const cardGap = 12;
  const cardWidth = (PDF_TEXT_MAX_WIDTH - cardGap) / 2;
  const cardHeight = 72;
  state = ensurePageSpace(pdfDoc, state, cardHeight * 2 + 24);
  drawInfoCard(state.page, titleFont, bodyFont, {
    x: PDF_PAGE.margin,
    y: state.y,
    width: cardWidth,
    height: cardHeight,
    label: "Cliente",
    value: clientLabel,
  });
  drawInfoCard(state.page, titleFont, bodyFont, {
    x: PDF_PAGE.margin + cardWidth + cardGap,
    y: state.y,
    width: cardWidth,
    height: cardHeight,
    label: "Activo",
    value: assetReference,
  });
  state.y -= cardHeight + 12;
  drawInfoCard(state.page, titleFont, bodyFont, {
    x: PDF_PAGE.margin,
    y: state.y,
    width: cardWidth,
    height: cardHeight,
    label: "Validez",
    value: budget.validUntil ? `Hasta ${budget.validUntil}` : "No informada",
  });
  drawInfoCard(state.page, titleFont, bodyFont, {
    x: PDF_PAGE.margin + cardWidth + cardGap,
    y: state.y,
    width: cardWidth,
    height: cardHeight,
    label: "Plazo",
    value:
      budget.estimatedDays === null
        ? "No informado"
        : `${budget.estimatedDays} dia(s) estimados`,
  });
  state.y -= cardHeight + 18;

  state = drawSectionTitle(pdfDoc, state, titleFont, "Incidencia");
  state = drawTextPanel(pdfDoc, state, bodyFont, wrapText(budget.incidenceSummary, 88), {
    fillColor: PDF_COLORS.card,
    borderColor: PDF_COLORS.border,
    textColor: PDF_COLORS.ink,
    maxChars: 88,
    fontSize: 10.8,
    paddingX: 16,
    paddingTop: 16,
    paddingBottom: 14,
  });
  state.y -= 8;

  state = drawSectionTitle(pdfDoc, state, titleFont, "Alcance");
  state = drawTextPanel(pdfDoc, state, bodyFont, wrapText(budget.scopeIncluded, 88), {
    fillColor: PDF_COLORS.soft,
    borderColor: PDF_COLORS.border,
    textColor: PDF_COLORS.ink,
    maxChars: 88,
    fontSize: 10.8,
    paddingX: 16,
    paddingTop: 16,
    paddingBottom: 14,
  });
  state.y -= 8;

  state = drawSectionTitle(pdfDoc, state, titleFont, "Exclusiones");
  state = drawTextPanel(
    pdfDoc,
    state,
    bodyFont,
    wrapText(budget.scopeExcluded || "Sin exclusiones declaradas.", 88),
    {
      fillColor: PDF_COLORS.accentSoft,
      borderColor: PDF_COLORS.accentLine,
      textColor: PDF_COLORS.ink,
      maxChars: 88,
      fontSize: 10.8,
      paddingX: 16,
      paddingTop: 16,
      paddingBottom: 14,
    },
  );
  state.y -= 8;

  state = drawSectionTitle(pdfDoc, state, titleFont, "Costos");
  state = drawTextPanel(pdfDoc, state, bodyFont, [
    `Mano de obra: ${formatMoney(budget.laborAmountCents, budget.currencyCode)}`,
    `Repuestos e insumos: ${formatMoney(budget.partsAmountCents, budget.currencyCode)}`,
    `Impuestos: ${formatMoney(budget.taxAmountCents, budget.currencyCode)}`,
    `TOTAL: ${formatMoney(budget.totalAmountCents, budget.currencyCode)}`,
  ], {
    fillColor: PDF_COLORS.card,
    borderColor: PDF_COLORS.border,
    textColor: PDF_COLORS.ink,
    maxChars: 88,
    fontSize: 10.8,
    paddingX: 16,
    paddingTop: 16,
    paddingBottom: 14,
  });
  state.y -= 8;

  state = drawSectionTitle(pdfDoc, state, titleFont, "Aprobacion");
  state = drawTextPanel(pdfDoc, state, bodyFont, [
    `Estado: ${approvalStatusLabel}`,
    `Aprobado por: ${budget.approvedByName || "Pendiente"}`,
    `Canal: ${budget.approvedByChannel || "Pendiente"}`,
    `Fecha: ${budget.approvedAt ? formatDateTime(budget.approvedAt) : "Pendiente"}`,
    budget.approvalNote ? `Nota: ${budget.approvalNote}` : "Nota: -",
    `Emitido por: ${normalizeOptionalString(createdByUsername, "SiteOps") || "SiteOps"}`,
  ], {
    fillColor:
      budget.approvalStatus === "approved" ? PDF_COLORS.accentSoft : PDF_COLORS.soft,
    borderColor:
      budget.approvalStatus === "approved" ? PDF_COLORS.accentLine : PDF_COLORS.border,
    textColor: PDF_COLORS.ink,
    maxChars: 88,
    fontSize: 10.8,
    paddingX: 16,
    paddingTop: 16,
    paddingBottom: 14,
  });

  return pdfDoc.save();
}

export async function storeInstallationBudgetPdf(
  env,
  {
    tenantId,
    installationId,
    budgetNumber,
    pdfBytes,
    createdAt,
  },
) {
  const bucket = requireBudgetsBucketOperation(env, "put");
  const stamp = isoStampForKey(createdAt);
  const r2Key = [
    "tenants",
    sanitizeStorageSegment(tenantId, "default"),
    "installations",
    String(installationId),
    "budgets",
    stamp,
    `${sanitizeStorageSegment(budgetNumber, "budget")}.pdf`,
  ].join("/");

  await bucket.put(r2Key, pdfBytes, {
    httpMetadata: {
      contentType: BUDGET_PDF_CONTENT_TYPE,
    },
  });

  return {
    r2Key,
  };
}

export async function persistInstallationBudget(
  env,
  {
    installationId,
    tenantId,
    budgetNumber,
    incidenceSummary,
    scopeIncluded,
    scopeExcluded,
    laborAmountCents,
    partsAmountCents,
    taxAmountCents,
    totalAmountCents,
    currencyCode = "UYU",
    estimatedDays = null,
    validUntil = null,
    emailTo = "",
    deliveryStatus = "generated",
    approvalStatus = "pending",
    approvedByName = "",
    approvedByChannel = "",
    approvedAt = null,
    approvalNote = "",
    pdfR2Key,
    metadataJson = "{}",
    createdAt,
    createdByUserId = null,
    createdByUsername = "web",
    updatedAt,
  },
) {
  const result = await env.DB.prepare(`
    INSERT INTO installation_budgets (
      installation_id,
      tenant_id,
      budget_number,
      incidence_summary,
      scope_included,
      scope_excluded,
      labor_amount_cents,
      parts_amount_cents,
      tax_amount_cents,
      total_amount_cents,
      currency_code,
      estimated_days,
      valid_until,
      email_to,
      delivery_status,
      approval_status,
      approved_by_name,
      approved_by_channel,
      approved_at,
      approval_note,
      pdf_r2_key,
      metadata_json,
      created_at,
      created_by_user_id,
      created_by_username,
      updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
    .bind(
      installationId,
      tenantId,
      budgetNumber,
      incidenceSummary,
      scopeIncluded,
      scopeExcluded,
      Math.max(0, Number(laborAmountCents) || 0),
      Math.max(0, Number(partsAmountCents) || 0),
      Math.max(0, Number(taxAmountCents) || 0),
      Math.max(0, Number(totalAmountCents) || 0),
      normalizeCurrencyCode(currencyCode),
      estimatedDays,
      validUntil,
      emailTo,
      deliveryStatus,
      approvalStatus,
      approvedByName,
      approvedByChannel,
      approvedAt,
      approvalNote,
      pdfR2Key,
      metadataJson || "{}",
      createdAt,
      createdByUserId,
      createdByUsername,
      updatedAt || createdAt,
    )
    .run();

  const budgetId = Number(result?.meta?.last_row_id || 0);
  const { results } = await env.DB.prepare(`
    SELECT *
    FROM installation_budgets
    WHERE id = ?
      AND tenant_id = ?
    LIMIT 1
  `)
    .bind(budgetId, tenantId)
    .all();
  return normalizeBudgetRow(results?.[0] || null);
}

export async function listInstallationBudgets(env, { installationId, tenantId, limit = 50 }) {
  const safeLimit = Math.min(200, Math.max(1, Number.parseInt(String(limit || 50), 10) || 50));
  const { results } = await env.DB.prepare(`
    SELECT *
    FROM installation_budgets
    WHERE installation_id = ?
      AND tenant_id = ?
    ORDER BY created_at DESC, id DESC
    LIMIT ?
  `)
    .bind(installationId, tenantId, safeLimit)
    .all();
  return (results || []).map((row) => normalizeBudgetRow(row));
}

export async function loadLatestInstallationBudget(env, installationId, tenantId) {
  const { results } = await env.DB.prepare(`
    SELECT *
    FROM installation_budgets
    WHERE installation_id = ?
      AND tenant_id = ?
    ORDER BY created_at DESC, id DESC
    LIMIT 1
  `)
    .bind(installationId, tenantId)
    .all();
  return normalizeBudgetRow(results?.[0] || null);
}

export async function loadLatestApprovedInstallationBudget(env, installationId, tenantId) {
  const { results } = await env.DB.prepare(`
    SELECT *
    FROM installation_budgets
    WHERE installation_id = ?
      AND tenant_id = ?
      AND approval_status = 'approved'
    ORDER BY approved_at DESC, id DESC
    LIMIT 1
  `)
    .bind(installationId, tenantId)
    .all();
  return normalizeBudgetRow(results?.[0] || null);
}

export async function loadInstallationBudgetById(env, installationId, budgetId, tenantId) {
  const { results } = await env.DB.prepare(`
    SELECT *
    FROM installation_budgets
    WHERE installation_id = ?
      AND id = ?
      AND tenant_id = ?
    LIMIT 1
  `)
    .bind(installationId, budgetId, tenantId)
    .all();
  return normalizeBudgetRow(results?.[0] || null);
}

export async function loadInstallationBudgetPdfById(env, installationId, budgetId, tenantId) {
  const { results } = await env.DB.prepare(`
    SELECT id, pdf_r2_key, installation_id, tenant_id
    FROM installation_budgets
    WHERE id = ?
      AND installation_id = ?
      AND tenant_id = ?
    LIMIT 1
  `)
    .bind(budgetId, installationId, tenantId)
    .all();
  const row = results?.[0] || null;
  if (!row) return null;

  const bucket = requireBudgetsBucketOperation(env, "get");
  const object = await bucket.get(row.pdf_r2_key);
  if (!object || !object.body) return null;
  return {
    row,
    object,
  };
}

export async function approveInstallationBudget(
  env,
  {
    installationId,
    budgetId,
    tenantId,
    approvedByName,
    approvedByChannel,
    approvalNote = "",
    approvedAt,
    updatedAt,
  },
) {
  await env.DB.prepare(`
    UPDATE installation_budgets
    SET approval_status = 'approved',
        approved_by_name = ?,
        approved_by_channel = ?,
        approved_at = ?,
        approval_note = ?,
        updated_at = ?
    WHERE id = ?
      AND installation_id = ?
      AND tenant_id = ?
  `)
    .bind(
      approvedByName,
      approvedByChannel,
      approvedAt,
      approvalNote,
      updatedAt,
      budgetId,
      installationId,
      tenantId,
    )
    .run();

  await env.DB.prepare(`
    UPDATE installation_budgets
    SET approval_status = 'superseded',
        updated_at = ?
    WHERE installation_id = ?
      AND tenant_id = ?
      AND id <> ?
      AND approval_status = 'approved'
  `)
    .bind(updatedAt, installationId, tenantId, budgetId)
    .run();

  return loadInstallationBudgetById(env, installationId, budgetId, tenantId);
}

export async function updateInstallationBudgetPdfReference(
  env,
  {
    budgetId,
    tenantId,
    pdfR2Key,
    updatedAt,
  },
) {
  await env.DB.prepare(`
    UPDATE installation_budgets
    SET pdf_r2_key = ?,
        updated_at = ?
    WHERE id = ?
      AND tenant_id = ?
  `)
    .bind(pdfR2Key, updatedAt, budgetId, tenantId)
    .run();
}

export async function sendBudgetEmail(
  env,
  {
    to,
    installationId,
    budgetNumber,
    pdfBytes,
    clientName,
    assetLabel,
    totalAmountCents,
    currencyCode,
    validUntil,
    incidenceSummary,
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

  const subject = `SiteOps | Documento comercial ${budgetNumber} | instalacion #${installationId}`;
  const filename = `presupuesto_instalacion_${installationId}_${normalizeOptionalString(budgetNumber, "budget")}.pdf`;
  const client = normalizeOptionalString(clientName, "Sin cliente") || "Sin cliente";
  const asset = normalizeOptionalString(assetLabel, "Sin activo vinculado") || "Sin activo vinculado";
  const total = formatMoney(totalAmountCents, currencyCode);
  const validity = normalizeOptionalString(validUntil, "No informada") || "No informada";
  const summary = normalizeOptionalString(incidenceSummary, "");
  const attachmentBase64 = toBase64(pdfBytes);
  const attachmentSize = formatAttachmentSize(pdfBytes.byteLength);
  const text = [
    "Adjuntamos el presupuesto de servicio emitido desde SiteOps.",
    `Registro: #${installationId}`,
    `Numero: ${budgetNumber}`,
    `Cliente: ${client}`,
    `Activo: ${asset}`,
    `Total: ${total}`,
    `Validez: ${validity}`,
    summary ? `Incidencia: ${summary}` : "",
    "",
    `Adjunto: ${filename} (${attachmentSize})`,
  ]
    .filter(Boolean)
    .join("\n");
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
    `<div style="display:inline-block;padding:7px 11px;border:1px dashed rgba(158,220,174,.78);border-radius:999px;background:rgba(22,28,43,.9);color:#dce7f0;font-size:10px;font-weight:800;letter-spacing:.16em;text-transform:uppercase;font-family:${EMAIL_FONT_MONO};">Documento comercial</div>`,
    "</td>",
    "<td style=\"vertical-align:middle;\">",
    "<div style=\"height:1px;width:120px;background:linear-gradient(90deg,rgba(147,221,214,.55),rgba(147,221,214,0));\"></div>",
    "</td>",
    "</tr>",
    "</table>",
    "</td></tr>",
    "<tr><td style=\"background:linear-gradient(180deg,rgba(24,28,43,.98),rgba(18,24,38,.98));border:1px solid rgba(158,220,174,.72);border-radius:26px;padding:0;box-shadow:0 20px 44px rgba(0,0,0,.28);overflow:hidden;\">",
    "<div style=\"height:3px;background:linear-gradient(90deg,#bff264 0%,#65c9ff 52%,rgba(101,201,255,.12) 100%);\"></div>",
    "<table role=\"presentation\" width=\"100%\" cellspacing=\"0\" cellpadding=\"0\" style=\"border-collapse:collapse;\">",
    "<tr>",
    "<td style=\"padding:22px 22px 20px 22px;vertical-align:top;background:linear-gradient(90deg,rgba(72,33,38,.26) 0%,rgba(25,35,49,.98) 36%,rgba(18,24,38,.98) 100%);border-right:1px solid rgba(158,220,174,.36);\">",
    `<div style="display:inline-block;padding:8px 12px;border:1px solid rgba(158,220,174,.78);border-radius:999px;background:rgba(18,24,38,.46);color:#dce7f0;font-size:10px;font-weight:800;letter-spacing:.16em;text-transform:uppercase;font-family:${EMAIL_FONT_MONO};">Presupuesto de servicio</div>`,
    `<div style="font-size:40px;line-height:.94;font-weight:700;color:#eef2f7;margin:18px 0 10px 0;font-family:${EMAIL_FONT_DISPLAY};letter-spacing:.06em;text-transform:uppercase;">Registro #${escapeHtml(String(installationId))}</div>`,
    "<div style=\"width:108px;height:2px;background:linear-gradient(90deg,#bff264,#65c9ff 72%,rgba(101,201,255,0));margin:0 0 16px 0;\"></div>",
    `<div style="font-size:15px;line-height:1.72;color:#b7c0cf;max-width:420px;font-family:${EMAIL_FONT_BODY};">El presupuesto de servicio ya fue emitido desde <strong>SiteOps</strong>. El documento adjunto resume alcance tecnico, detalle economico, plazos y validez comercial dentro del mismo contexto operativo del registro.</div>`,
    "</td>",
    "<td style=\"width:220px;padding:18px 18px 12px 18px;vertical-align:top;background:linear-gradient(180deg,rgba(27,39,59,.82),rgba(18,24,38,.96));\">",
    buildEmailHeroStatHtml("Numero", budgetNumber),
    buildEmailHeroStatHtml("Total", total, { tone: "accent" }),
    buildEmailHeroStatHtml("Validez", validity),
    buildEmailHeroStatHtml("Documento", "Comercial"),
    "</td>",
    "</tr>",
    "<tr><td colspan=\"2\" style=\"padding:14px 22px 18px 22px;border-top:1px solid rgba(158,220,174,.3);background:rgba(18,24,38,.72);\">",
    buildEmailHeroChipHtml("registro operativo"),
    buildEmailHeroChipHtml("presupuesto listo"),
    buildEmailHeroChipHtml(currencyCode || "UYU"),
    "</td></tr>",
    "</table>",
    "<div style=\"padding:20px 22px 4px 22px;\">",
    "<table role=\"presentation\" width=\"100%\" cellspacing=\"0\" cellpadding=\"0\" style=\"border-collapse:collapse;\">",
    "<tr>",
    buildEmailInfoCardHtml("Numero", budgetNumber),
    buildEmailInfoCardHtml("Cliente", client),
    "</tr>",
    "<tr>",
    buildEmailInfoCardHtml("Activo", asset, { size: 18 }),
    buildEmailInfoCardHtml("Total", total, { tone: "accent", size: 20 }),
    "</tr>",
    "<tr>",
    buildEmailInfoCardHtml("Validez", validity, { size: 18 }),
    buildEmailInfoCardHtml("Documento", "Comercial", { size: 18 }),
    "</tr>",
    "</table>",
    summary
      ? `<div style="margin:8px 0 20px 0;padding:18px 18px;border:1px solid rgba(158,220,174,.56);background:linear-gradient(180deg,rgba(26,33,49,.96),rgba(18,24,38,.96));border-radius:18px;box-shadow:inset 0 1px 0 rgba(255,255,255,.08);"><div style="font-size:10px;font-weight:800;letter-spacing:.18em;text-transform:uppercase;color:#b7c0cf;margin:0 0 10px 0;font-family:${EMAIL_FONT_MONO};">Resumen de incidencia</div><div style="font-size:15px;line-height:1.72;color:#eef2f7;font-family:${EMAIL_FONT_BODY};">${escapeHtml(summary)}</div></div>`
      : "",
    "<table role=\"presentation\" width=\"100%\" cellspacing=\"0\" cellpadding=\"0\" style=\"border-collapse:collapse;border:1px solid rgba(158,220,174,.56);border-radius:18px;\">",
    "<tr>",
    "<td style=\"padding:18px 18px;background:linear-gradient(180deg,rgba(24,28,43,.92) 0%,rgba(27,39,59,.94) 100%);border-radius:18px;\">",
    `<div style="font-size:10px;font-weight:800;letter-spacing:.18em;text-transform:uppercase;color:#b7c0cf;margin:0 0 10px 0;font-family:${EMAIL_FONT_MONO};">Documento adjunto</div>`,
    `<div style="font-size:26px;line-height:1.02;font-weight:700;color:#eef2f7;margin:0 0 10px 0;font-family:${EMAIL_FONT_DISPLAY};letter-spacing:.05em;text-transform:uppercase;word-break:break-word;">${escapeHtml(filename)}</div>`,
    `<div style="font-size:13px;line-height:1.75;color:#d7e8f6;font-family:${EMAIL_FONT_BODY};">El PDF viaja adjunto en este correo para revision comercial. Tamano aproximado del archivo: <strong>${escapeHtml(attachmentSize)}</strong>.</div>`,
    "</td>",
    "</tr>",
    "</table>",
    `<div style="font-size:13px;line-height:1.8;color:#b7c0cf;font-family:${EMAIL_FONT_BODY};margin:18px 0 0 0;">Si necesitas ajustar alcance, costos o condiciones comerciales, el equipo puede emitir una nueva version desde la misma instalacion.</div>`,
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
