import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

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
  return pdfDoc.addPage([PDF_PAGE.width, PDF_PAGE.height]);
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
  nextState.page.drawText(normalizePdfText(text), {
    x: PDF_PAGE.margin,
    y: nextState.y,
    size: 13,
    font,
    color: rgb(0.12, 0.2, 0.26),
  });
  nextState.y -= 20;
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
      color: options.color || rgb(0.14, 0.14, 0.14),
      maxWidth: options.maxWidth || PDF_TEXT_MAX_WIDTH,
    });
    nextState.y -= PDF_LINE_HEIGHT;
  }
  return nextState;
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

  const titleFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const bodyFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const page = addPage(pdfDoc);
  let state = {
    page,
    y: PDF_PAGE.height - PDF_PAGE.margin,
  };

  state.page.drawRectangle({
    x: PDF_PAGE.margin,
    y: state.y - 78,
    width: PDF_TEXT_MAX_WIDTH,
    height: 78,
    color: rgb(0.96, 0.98, 0.99),
    borderColor: rgb(0.83, 0.88, 0.9),
    borderWidth: 1,
  });
  state.page.drawText("Presupuesto de servicio", {
    x: PDF_PAGE.margin + 14,
    y: state.y - 28,
    size: 21,
    font: titleFont,
    color: rgb(0.1, 0.16, 0.2),
  });
  state.page.drawText(`Numero: ${normalizePdfText(budget.budgetNumber)}`, {
    x: PDF_PAGE.margin + 14,
    y: state.y - 48,
    size: 11,
    font: bodyFont,
    color: rgb(0.2, 0.27, 0.33),
  });
  state.page.drawText(`Generado: ${formatDateTime(createdAt)}`, {
    x: PDF_PAGE.margin + 14,
    y: state.y - 62,
    size: 10,
    font: bodyFont,
    color: rgb(0.3, 0.36, 0.41),
  });
  state.y -= 98;

  const referenceLines = [
    `Registro: #${context.installation.id}`,
    `Cliente: ${normalizeOptionalString(context.installation.client_name, "Sin cliente") || "Sin cliente"}`,
    `Activo: ${normalizeOptionalString(context.asset?.external_code, "") || normalizeOptionalString(context.asset?.serial_number, "") || "Sin activo vinculado"}`,
    `Moneda: ${budget.currencyCode}`,
  ];
  state = drawLines(pdfDoc, state, bodyFont, referenceLines, {
    size: 10.5,
    color: rgb(0.28, 0.35, 0.4),
  });
  state.y -= 8;

  state = drawSectionTitle(pdfDoc, state, titleFont, "Incidencia");
  state = drawLines(pdfDoc, state, bodyFont, wrapText(budget.incidenceSummary, 92));
  state.y -= 8;

  state = drawSectionTitle(pdfDoc, state, titleFont, "Alcance");
  state = drawLines(pdfDoc, state, bodyFont, wrapText(budget.scopeIncluded, 92));
  state.y -= 8;

  state = drawSectionTitle(pdfDoc, state, titleFont, "Exclusiones");
  state = drawLines(
    pdfDoc,
    state,
    bodyFont,
    wrapText(budget.scopeExcluded || "Sin exclusiones declaradas.", 92),
  );
  state.y -= 8;

  state = drawSectionTitle(pdfDoc, state, titleFont, "Costos");
  state = drawLines(pdfDoc, state, bodyFont, [
    `Mano de obra: ${formatMoney(budget.laborAmountCents, budget.currencyCode)}`,
    `Repuestos e insumos: ${formatMoney(budget.partsAmountCents, budget.currencyCode)}`,
    `Impuestos: ${formatMoney(budget.taxAmountCents, budget.currencyCode)}`,
    `TOTAL: ${formatMoney(budget.totalAmountCents, budget.currencyCode)}`,
  ]);
  state.y -= 8;

  state = drawSectionTitle(pdfDoc, state, titleFont, "Plazo");
  state = drawLines(pdfDoc, state, bodyFont, [
    budget.estimatedDays === null
      ? "Plazo estimado: No informado."
      : `Plazo estimado: ${budget.estimatedDays} dia(s).`,
  ]);
  state.y -= 8;

  state = drawSectionTitle(pdfDoc, state, titleFont, "Validez");
  state = drawLines(pdfDoc, state, bodyFont, [
    budget.validUntil ? `Valido hasta: ${budget.validUntil}` : "Validez: No informada.",
  ]);
  state.y -= 8;

  state = drawSectionTitle(pdfDoc, state, titleFont, "Aprobacion");
  const approvalStatusLabel =
    budget.approvalStatus === "approved"
      ? "Aprobado"
      : budget.approvalStatus === "superseded"
        ? "Reemplazado"
        : "Pendiente";
  state = drawLines(pdfDoc, state, bodyFont, [
    `Estado: ${approvalStatusLabel}`,
    `Aprobado por: ${budget.approvedByName || "Pendiente"}`,
    `Canal: ${budget.approvedByChannel || "Pendiente"}`,
    `Fecha: ${budget.approvedAt ? formatDateTime(budget.approvedAt) : "Pendiente"}`,
    budget.approvalNote ? `Nota: ${budget.approvalNote}` : "Nota: -",
  ]);

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

  const subject = `Presupuesto ${budgetNumber} - instalacion #${installationId}`;
  const filename = `presupuesto_instalacion_${installationId}_${normalizeOptionalString(budgetNumber, "budget")}.pdf`;
  const text = [
    "Adjuntamos el presupuesto generado desde SiteOps.",
    `Registro: #${installationId}`,
    `Numero: ${budgetNumber}`,
    `Cliente: ${normalizeOptionalString(clientName, "Sin cliente") || "Sin cliente"}`,
    `Activo: ${normalizeOptionalString(assetLabel, "Sin activo vinculado") || "Sin activo vinculado"}`,
    `Total: ${formatMoney(totalAmountCents, currencyCode)}`,
    validUntil ? `Validez: ${validUntil}` : "Validez: No informada",
    incidenceSummary ? `Incidencia: ${normalizeOptionalString(incidenceSummary, "")}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  const html = [
    "<div style=\"font-family:Arial,sans-serif;background:#111;color:#f4f4f4;padding:18px;\">",
    `<h2 style=\"margin:0 0 10px 0;\">Presupuesto ${normalizePdfText(budgetNumber)}</h2>`,
    `<p style=\"margin:0 0 8px 0;\">Registro <strong>#${installationId}</strong></p>`,
    `<p style=\"margin:0 0 8px 0;\">Cliente: ${normalizePdfText(clientName || "Sin cliente")}</p>`,
    `<p style=\"margin:0 0 8px 0;\">Activo: ${normalizePdfText(assetLabel || "Sin activo vinculado")}</p>`,
    `<p style=\"margin:0 0 8px 0;\">Total: ${normalizePdfText(formatMoney(totalAmountCents, currencyCode))}</p>`,
    `<p style=\"margin:0 0 8px 0;\">Validez: ${normalizePdfText(validUntil || "No informada")}</p>`,
    incidenceSummary
      ? `<p style=\"margin:0 0 8px 0;\">Incidencia: ${normalizePdfText(incidenceSummary)}</p>`
      : "",
    "<p style=\"margin:14px 0 0 0;\">El PDF viaja adjunto en este correo.</p>",
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
            content: toBase64(pdfBytes),
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
