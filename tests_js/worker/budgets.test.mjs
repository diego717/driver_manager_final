import assert from "node:assert/strict";
import test from "node:test";

import { createBudgetsRouteHandlers } from "../../worker/routes/budgets.js";
import {
  approveInstallationBudget,
  normalizeBudgetCreatePayload,
  sendBudgetEmail,
} from "../../worker/services/budgets.js";

function jsonResponse(_request, _env, _corsPolicy, body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
    },
  });
}

test("normalizeBudgetCreatePayload computes total cents and defaults", () => {
  const payload = normalizeBudgetCreatePayload({
    incidence_summary: "Falla en equipo",
    scope_included: "Reemplazo de fuente",
    labor_amount_cents: 15000,
    parts_amount_cents: 22000,
    tax_amount_cents: 8140,
    currency_code: "uyu",
  });

  assert.equal(payload.totalAmountCents, 45140);
  assert.equal(payload.currencyCode, "UYU");
  assert.equal(payload.sendEmail, false);
});

test("approveInstallationBudget supersedes previously approved budgets", async () => {
  const executedSql = [];
  const env = {
    DB: {
      prepare(sql) {
        const normalized = String(sql || "").replace(/\s+/g, " ").trim();
        executedSql.push(normalized);
        return {
          bind(...args) {
            this.args = args;
            return this;
          },
          async run() {
            return { success: true };
          },
          async all() {
            if (normalized.startsWith("SELECT * FROM installation_budgets WHERE installation_id = ?")) {
              return {
                results: [{
                  id: 7,
                  installation_id: 42,
                  tenant_id: "default",
                  budget_number: "P-20260412-42-ABCD",
                  approval_status: "approved",
                  approved_by_name: "Cliente Demo",
                  approved_by_channel: "email",
                  approved_at: "2026-04-12T13:00:00.000Z",
                }],
              };
            }
            return { results: [] };
          },
        };
      },
    },
  };

  const result = await approveInstallationBudget(env, {
    installationId: 42,
    budgetId: 7,
    tenantId: "default",
    approvedByName: "Cliente Demo",
    approvedByChannel: "email",
    approvalNote: "OK por correo",
    approvedAt: "2026-04-12T13:00:00.000Z",
    updatedAt: "2026-04-12T13:00:00.000Z",
  });

  assert.equal(result?.id, 7);
  assert.ok(executedSql.some((sql) => sql.includes("SET approval_status = 'approved'")));
  assert.ok(executedSql.some((sql) => sql.includes("SET approval_status = 'superseded'")));
});

test("sendBudgetEmail returns resend_not_configured when secrets are missing", async () => {
  const result = await sendBudgetEmail(
    {},
    {
      to: "cliente@example.com",
      installationId: 42,
      budgetNumber: "P-20260412-42-ABCD",
      pdfBytes: new Uint8Array([1, 2, 3]),
      clientName: "Acme",
      assetLabel: "EQ-01",
      totalAmountCents: 10000,
      currencyCode: "UYU",
      validUntil: "2026-04-20",
      incidenceSummary: "Falla general",
    },
  );

  assert.deepEqual(result, {
    delivered: false,
    error: "resend_not_configured",
  });
});

test("budgets route persists creation with emailed delivery status", async () => {
  let persistedInput = null;
  let auditPayload = null;

  const { handleInstallationBudgetsRoute } = createBudgetsRouteHandlers({
    jsonResponse,
    corsHeaders() {
      return {};
    },
    parsePositiveInt(value, field = "id") {
      const parsed = Number.parseInt(String(value), 10);
      if (!Number.isInteger(parsed) || parsed <= 0) {
        throw new Error(`invalid_${field}`);
      }
      return parsed;
    },
    normalizeOptionalString(value, fallback = "") {
      if (value === null || value === undefined) return fallback;
      return String(value).trim();
    },
    normalizeRealtimeTenantId(value) {
      return String(value || "").trim().toLowerCase() || "default";
    },
    requireWebWriteRole() {},
    async readJsonOrThrowBadRequest(request) {
      return request.json();
    },
    async logAuditEvent(_env, payload) {
      auditPayload = payload;
    },
    getClientIpForRateLimit() {
      return "127.0.0.1";
    },
    nowIso() {
      return "2026-04-12T13:00:00.000Z";
    },
    normalizeBudgetCreatePayload,
    normalizeBudgetApprovePayload() {
      return {
        approvedByName: "x",
        approvedByChannel: "email",
        approvalNote: "",
      };
    },
    buildBudgetPdfDownloadPath(installationId, budgetId) {
      return `/web/installations/${installationId}/budgets/${budgetId}/pdf`;
    },
    buildBudgetNumber() {
      return "P-20260412-42-ABCD";
    },
    async loadInstallationBudgetContext() {
      return {
        installation: { id: 42, client_name: "Acme" },
        asset: { id: 9, external_code: "EQ-9" },
      };
    },
    async generateInstallationBudgetPdf() {
      return new Uint8Array([1, 2, 3, 4]);
    },
    async storeInstallationBudgetPdf() {
      return { r2Key: "tenants/default/installations/42/budgets/test.pdf" };
    },
    async persistInstallationBudget(_env, input) {
      persistedInput = input;
      return {
        id: 19,
        installation_id: input.installationId,
        tenant_id: input.tenantId,
        budget_number: input.budgetNumber,
        approval_status: input.approvalStatus,
        delivery_status: input.deliveryStatus,
        total_amount_cents: input.totalAmountCents,
        currency_code: input.currencyCode,
      };
    },
    async listInstallationBudgets() {
      return [];
    },
    async loadLatestInstallationBudget() {
      return null;
    },
    async loadLatestApprovedInstallationBudget() {
      return null;
    },
    async loadInstallationBudgetPdfById() {
      return null;
    },
    async loadInstallationBudgetById() {
      return null;
    },
    async approveInstallationBudget() {
      return null;
    },
    async updateInstallationBudgetPdfReference() {},
    async sendBudgetEmail() {
      return {
        delivered: true,
        provider: "resend",
        message_id: "email_456",
      };
    },
  });

  const response = await handleInstallationBudgetsRoute(
    new Request("https://worker.example/web/installations/42/budgets", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        incidence_summary: "Error en fuente",
        scope_included: "Cambio de fuente y prueba",
        scope_excluded: "No incluye cableado externo",
        labor_amount_cents: 10000,
        parts_amount_cents: 20000,
        tax_amount_cents: 6300,
        currency_code: "UYU",
        estimated_days: 2,
        valid_until: "2026-04-20",
        email_to: "cliente@example.com",
        send_email: true,
      }),
    }),
    {},
    {},
    ["installations", "42", "budgets"],
    true,
    {
      tenant_id: "default",
      role: "admin",
      sub: "ops-admin",
      user_id: 3,
    },
  );

  assert.equal(response.status, 201);
  const body = await response.json();
  assert.equal(body?.budget?.id, 19);
  assert.equal(persistedInput?.deliveryStatus, "emailed");
  assert.equal(persistedInput?.totalAmountCents, 36300);
  assert.equal(auditPayload?.action, "generate_installation_budget");
});

test("budgets route approval endpoint records approval payload", async () => {
  let approvePayload = null;

  const { handleInstallationBudgetsRoute } = createBudgetsRouteHandlers({
    jsonResponse,
    corsHeaders() {
      return {};
    },
    parsePositiveInt(value) {
      return Number(value);
    },
    normalizeOptionalString(value, fallback = "") {
      if (value === null || value === undefined) return fallback;
      return String(value).trim();
    },
    normalizeRealtimeTenantId(value) {
      return String(value || "").trim().toLowerCase() || "default";
    },
    requireWebWriteRole() {},
    async readJsonOrThrowBadRequest(request) {
      return request.json();
    },
    async logAuditEvent() {},
    getClientIpForRateLimit() {
      return "127.0.0.1";
    },
    nowIso() {
      return "2026-04-12T13:30:00.000Z";
    },
    normalizeBudgetCreatePayload,
    normalizeBudgetApprovePayload(body) {
      return {
        approvedByName: String(body?.approved_by_name || "").trim(),
        approvedByChannel: String(body?.approved_by_channel || "").trim(),
        approvalNote: String(body?.approval_note || "").trim(),
      };
    },
    buildBudgetPdfDownloadPath(installationId, budgetId) {
      return `/web/installations/${installationId}/budgets/${budgetId}/pdf`;
    },
    buildBudgetNumber() {
      return "P-20260412-42-ABCD";
    },
    async loadInstallationBudgetContext() {
      return null;
    },
    async generateInstallationBudgetPdf() {
      return new Uint8Array([1]);
    },
    async storeInstallationBudgetPdf() {
      return { r2Key: "x" };
    },
    async persistInstallationBudget() {
      return null;
    },
    async listInstallationBudgets() {
      return [];
    },
    async loadLatestInstallationBudget() {
      return null;
    },
    async loadLatestApprovedInstallationBudget() {
      return null;
    },
    async loadInstallationBudgetPdfById() {
      return null;
    },
    async loadInstallationBudgetById() {
      return {
        id: 33,
        installation_id: 42,
        tenant_id: "default",
        budget_number: "P-20260412-42-ABCD",
        approval_status: "pending",
      };
    },
    async approveInstallationBudget(_env, input) {
      approvePayload = input;
      return {
        id: input.budgetId,
        installation_id: input.installationId,
        tenant_id: input.tenantId,
        budget_number: "P-20260412-42-ABCD",
        approval_status: "approved",
      };
    },
    async updateInstallationBudgetPdfReference() {},
    async sendBudgetEmail() {
      return { delivered: false, skipped: true, error: null };
    },
  });

  const response = await handleInstallationBudgetsRoute(
    new Request("https://worker.example/web/installations/42/budgets/33/approve", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        approved_by_name: "Cliente ACME",
        approved_by_channel: "whatsapp",
        approval_note: "Confirmado por mensaje",
      }),
    }),
    {},
    {},
    ["installations", "42", "budgets", "33", "approve"],
    true,
    {
      tenant_id: "default",
      role: "admin",
      sub: "ops-admin",
      user_id: 3,
    },
  );

  assert.equal(response.status, 200);
  assert.equal(approvePayload?.budgetId, 33);
  assert.equal(approvePayload?.approvedByName, "Cliente ACME");
  assert.equal(approvePayload?.approvedByChannel, "whatsapp");
});
