import assert from "node:assert/strict";
import test from "node:test";

import { createConformitiesRouteHandlers } from "../../worker/routes/conformities.js";
import {
  buildGpsMapsUrl,
  buildGpsMetadataSnapshot,
  normalizeGpsPayload,
} from "../../worker/lib/gps.js";
import {
  loadStaticMapAssetForPdf as loadStaticMapAssetForPdfFromService,
  sendConformityEmail,
} from "../../worker/services/conformities.js";

function jsonResponse(_request, _env, _corsPolicy, body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
    },
  });
}

test("sendConformityEmail sends the PDF through Resend", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  let capturedRequest = null;
  globalThis.fetch = async (url, init) => {
    capturedRequest = {
      url,
      method: init?.method,
      headers: init?.headers,
      body: JSON.parse(init?.body || "{}"),
    };
    return new Response(JSON.stringify({ id: "email_123" }), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
      },
    });
  };

  const result = await sendConformityEmail(
    {
      RESEND_API_KEY: "re_test_123",
      RESEND_FROM_EMAIL: "SiteOps <ops@example.com>",
    },
    {
      to: "cliente@example.com",
      installationId: 42,
      pdfBytes: new Uint8Array([1, 2, 3]),
      signedByName: "Juan Perez",
      clientName: "Acme",
      assetClientName: "Acme",
      assetLabel: "ATM-001",
      technicianName: "tech1",
      generatedAt: "2026-03-23T18:00:00.000Z",
      summaryNote: "Instalacion validada en sitio",
      incidentCount: 2,
      photoCount: 3,
    },
  );

  assert.deepEqual(result, {
    delivered: true,
    provider: "resend",
    message_id: "email_123",
    status_code: 200,
  });
  assert.equal(capturedRequest?.url, "https://api.resend.com/emails");
  assert.equal(capturedRequest?.method, "POST");
  assert.equal(capturedRequest?.headers?.Authorization, "Bearer re_test_123");
  assert.equal(capturedRequest?.body?.from, "SiteOps <ops@example.com>");
  assert.deepEqual(capturedRequest?.body?.to, ["cliente@example.com"]);
  assert.equal(capturedRequest?.body?.subject, "SiteOps | Documento operativo | instalacion #42");
  assert.equal(capturedRequest?.body?.attachments?.[0]?.filename, "conformidad_instalacion_42.pdf");
  assert.equal(capturedRequest?.body?.attachments?.[0]?.content, "AQID");
  assert.match(capturedRequest?.body?.html || "", /Acme/);
  assert.match(capturedRequest?.body?.html || "", /ATM-001/);
  assert.match(capturedRequest?.body?.html || "", /Instalacion validada en sitio/);
});

test("sendConformityEmail relabels client block when it only mirrors the asset reference", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  let capturedRequest = null;
  globalThis.fetch = async (_url, init) => {
    capturedRequest = JSON.parse(init?.body || "{}");
    return new Response(JSON.stringify({ id: "email_456" }), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
      },
    });
  };

  await sendConformityEmail(
    {
      RESEND_API_KEY: "re_test_123",
      RESEND_FROM_EMAIL: "SiteOps <ops@example.com>",
    },
    {
      to: "cliente@example.com",
      installationId: 41,
      pdfBytes: new Uint8Array([1, 2, 3]),
      signedByName: "Diego",
      clientName: "Equipo ARSL3-001",
      assetClientName: "Equipo ARSL3-001",
      assetLabel: "ARSL3-001",
      technicianName: "tech1",
      generatedAt: "2026-03-26T01:37:00.000Z",
      summaryNote: "Instalacion validada en sitio",
      incidentCount: 2,
      photoCount: 0,
    },
  );

  assert.match(capturedRequest?.html || "", /Referencia operativa/);
  assert.equal((capturedRequest?.html || "").includes(">Cliente<"), false);
});

test("sendConformityEmail returns resend_not_configured when secrets are missing", async () => {
  const result = await sendConformityEmail(
    {},
    {
      to: "cliente@example.com",
      installationId: 42,
      pdfBytes: new Uint8Array([1, 2, 3]),
      signedByName: "Juan Perez",
      clientName: "Acme",
      assetClientName: "Acme",
      assetLabel: "ATM-001",
      technicianName: "tech1",
      generatedAt: "2026-03-23T18:00:00.000Z",
      summaryNote: "Instalacion validada en sitio",
      incidentCount: 2,
      photoCount: 3,
    },
  );

  assert.deepEqual(result, {
    delivered: false,
    error: "resend_not_configured",
  });
});

test("loadStaticMapAssetForPdf resolves a png map when template is configured", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  let requestedUrl = "";
  const tinyPngBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a8n0AAAAASUVORK5CYII=";
  globalThis.fetch = async (url) => {
    requestedUrl = String(url);
    return new Response(Uint8Array.from(Buffer.from(tinyPngBase64, "base64")), {
      status: 200,
      headers: {
        "Content-Type": "image/png",
      },
    });
  };

  const asset = await loadStaticMapAssetForPdfFromService(
    {
      GPS_STATIC_MAP_URL_TEMPLATE: "https://maps.example/static?center={lat},{lng}&zoom={zoom}&size={width}x{height}",
      GPS_STATIC_MAP_WIDTH: "720",
      GPS_STATIC_MAP_HEIGHT: "320",
      GPS_STATIC_MAP_ZOOM: "17",
    },
    {
      gps_lat: -34.9011,
      gps_lng: -56.1645,
      gps_accuracy_m: 18,
      gps_captured_at: "2026-03-26T09:59:00.000Z",
      gps_capture_source: "browser",
      gps_capture_status: "captured",
      gps_capture_note: "",
    },
  );

  assert.match(requestedUrl, /center=-34\.9011,-56\.1645/);
  assert.match(requestedUrl, /zoom=17/);
  assert.match(requestedUrl, /size=720x320/);
  assert.equal(asset?.contentType, "image/png");
  assert.equal(asset?.width, 720);
  assert.equal(asset?.height, 320);
  assert.equal(asset?.zoom, 17);
  assert.ok(asset?.bytes?.byteLength > 0);
});

test("loadStaticMapAssetForPdf ignores unsupported content types", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  globalThis.fetch = async () => new Response("<html>not an image</html>", {
    status: 200,
    headers: {
      "Content-Type": "text/html",
    },
  });

  const asset = await loadStaticMapAssetForPdfFromService(
    {
      GPS_STATIC_MAP_URL_TEMPLATE: "https://maps.example/static?center={lat_lng}",
    },
    {
      gps_lat: -34.9011,
      gps_lng: -56.1645,
      gps_accuracy_m: 18,
      gps_captured_at: "2026-03-26T09:59:00.000Z",
      gps_capture_source: "browser",
      gps_capture_status: "captured",
      gps_capture_note: "",
    },
  );

  assert.equal(asset, null);
});

test("conformity route persists emailed status when delivery succeeds", async () => {
  let persistedInput = null;
  const auditPayloads = [];
  let emailPayload = null;
  let readJsonOptions = null;
  const publicTrackingRefreshes = [];

  const { handleInstallationConformityRoute } = createConformitiesRouteHandlers({
    buildGpsMapsUrl,
    buildGpsMetadataSnapshot,
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
    normalizeGpsPayload,
    normalizeRealtimeTenantId(value) {
      return String(value || "").trim().toLowerCase() || "default";
    },
    requireWebWriteRole() {},
    async readJsonOrThrowBadRequest(request, _message, options) {
      readJsonOptions = options;
      return request.json();
    },
    async logAuditEvent(_env, payload) {
      auditPayloads.push(payload);
    },
    getClientIpForRateLimit() {
      return "127.0.0.1";
    },
    nowIso() {
      return "2026-03-23T18:00:00.000Z";
    },
    async loadInstallationConformityContext() {
      return {
        installation: {
          id: 42,
          client_name: "Acme",
          status: "done",
          notes: "",
          driver_brand: "Intel",
          driver_version: "1.0.0",
        },
        asset: {
          id: 9,
          external_code: "ATM-001",
          serial_number: "SER-1",
          model: "X",
          client_name: "Acme",
        },
        incidents: [{ id: 77 }],
        photos: [{ id: 501 }],
      };
    },
    async loadLatestInstallationConformity() {
      return null;
    },
    async loadInstallationConformityPdfById() {
      return null;
    },
    async loadLatestApprovedInstallationBudget() {
      return {
        id: 71,
        installation_id: 42,
        tenant_id: "tenant-a",
        budget_number: "P-20260323-42-ABCD",
        approval_status: "approved",
        approved_by_name: "Cliente ACME",
        approved_by_channel: "email",
        approved_at: "2026-03-23T16:00:00.000Z",
      };
    },
    async loadInstallationBudgetById(_env, installationId, budgetId, tenantId) {
      if (Number(installationId) !== 42 || Number(budgetId) !== 71 || String(tenantId) !== "tenant-a") {
        return null;
      }
      return {
        id: 71,
        installation_id: 42,
        tenant_id: "tenant-a",
        budget_number: "P-20260323-42-ABCD",
        approval_status: "approved",
        approved_by_name: "Cliente ACME",
        approved_by_channel: "email",
        approved_at: "2026-03-23T16:00:00.000Z",
      };
    },
    async persistInstallationConformity(_env, input) {
      persistedInput = input;
      return {
        id: 15,
        installation_id: input.installationId,
        tenant_id: input.tenantId,
        status: input.status,
        signed_by_name: input.signedByName,
        signed_by_document: input.signedByDocument,
        email_to: input.emailTo,
        summary_note: input.summaryNote,
        technician_note: input.technicianNote,
        signature_r2_key: input.signatureR2Key,
        pdf_r2_key: input.pdfR2Key,
        signed_at: input.signedAt,
        generated_at: input.generatedAt,
        generated_by_user_id: input.generatedByUserId,
        generated_by_username: input.generatedByUsername,
        session_version: input.sessionVersion,
        request_ip: input.requestIp,
        platform: input.platform,
        photo_count: input.photoCount,
        metadata_json: input.metadataJson,
      };
    },
    async storeSignatureAsset() {
      return {
        r2Key: "tenants/default/installations/42/conformities/20260323/signature.png",
        bytes: new Uint8Array([137, 80, 78, 71]),
      };
    },
    async generateConformityPdf() {
      return new Uint8Array([1, 2, 3, 4]);
    },
    async storeConformityPdf() {
      return {
        r2Key: "tenants/default/installations/42/conformities/20260323/conformity.pdf",
      };
    },
    async sendConformityEmail(_env, payload) {
      emailPayload = payload;
      return {
        delivered: true,
        provider: "resend",
        message_id: "email_123",
      };
    },
    async syncPublicTrackingSnapshotForInstallation(_env, payload) {
      publicTrackingRefreshes.push(payload);
    },
  });

  const response = await handleInstallationConformityRoute(
    new Request("https://worker.example/web/installations/42/conformity", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        signed_by_name: "Juan Perez",
        signed_by_document: "CI 123",
        email_to: "cliente@example.com",
        signature_data_url: "data:image/png;base64,iVBORw0KGgo=",
        summary_note: "Todo correcto",
        technician_note: "Sin observaciones",
        include_all_incident_photos: true,
        send_email: true,
      }),
    }),
    {},
    {},
    ["installations", "42", "conformity"],
    true,
    {
      tenant_id: "Tenant-A",
      role: "admin",
      sub: "tech1",
      user_id: 7,
      session_version: 3,
    },
  );

  const body = await response.json();

  assert.equal(response.status, 201);
  assert.equal(body.success, true);
  assert.equal(body.conformity.status, "emailed");
  assert.equal(
    body.conformity.pdf_download_path,
    "/web/installations/42/conformity/pdf?conformity_id=15",
  );
  assert.equal(emailPayload?.to, "cliente@example.com");
  assert.equal(emailPayload?.installationId, 42);
  assert.equal(emailPayload?.clientName, "Acme");
  assert.equal(emailPayload?.assetClientName, "Acme");
  assert.equal(emailPayload?.assetLabel, "ATM-001");
  assert.equal(emailPayload?.technicianName, "tech1");
  assert.equal(persistedInput?.status, "emailed");
  assert.equal(persistedInput?.budgetId, 71);
  assert.equal(readJsonOptions?.maxBytes, 512 * 1024);
  assert.match(persistedInput?.metadataJson || "", /"email_requested":true/);
  assert.match(persistedInput?.metadataJson || "", /"message_id":"email_123"/);
  assert.match(persistedInput?.metadataJson || "", /"budget_id":71/);
  assert.equal(auditPayloads[0]?.details?.email_result?.message_id, "email_123");
  assert.equal(auditPayloads[0]?.details?.budget_id, 71);
  assert.equal(auditPayloads[0]?.details?.budget_number, "P-20260323-42-ABCD");
  assert.deepEqual(publicTrackingRefreshes, [
    {
      tenantId: "tenant-a",
      installationId: 42,
    },
  ]);
});

test("conformity route persists captured gps snapshot in metadata", async () => {
  let persistedInput = null;
  let pdfPayload = null;

  const { handleInstallationConformityRoute } = createConformitiesRouteHandlers({
    buildGpsMapsUrl,
    buildGpsMetadataSnapshot,
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
    normalizeGpsPayload,
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
      return "2026-03-26T10:00:00.000Z";
    },
    async loadInstallationConformityContext() {
      return {
        installation: { id: 42, client_name: "Acme", status: "done", notes: "", driver_brand: "Intel", driver_version: "1.0.0" },
        asset: { id: 9, external_code: "ATM-001", serial_number: "SER-1", model: "X", client_name: "Acme" },
        incidents: [],
        photos: [],
      };
    },
    async loadLatestInstallationConformity() {
      return null;
    },
    async loadInstallationConformityPdfById() {
      return null;
    },
    async loadLatestApprovedInstallationBudget() {
      return {
        id: 88,
        installation_id: 42,
        tenant_id: "default",
        budget_number: "P-20260326-42-GPS1",
        approval_status: "approved",
        approved_by_name: "Cliente",
        approved_by_channel: "email",
        approved_at: "2026-03-26T09:00:00.000Z",
      };
    },
    async loadInstallationBudgetById() {
      return null;
    },
    async persistInstallationConformity(_env, input) {
      persistedInput = input;
      return { id: 16, installation_id: 42, tenant_id: input.tenantId, status: input.status, metadata_json: input.metadataJson };
    },
    async storeSignatureAsset() {
      return { r2Key: "signature.png", bytes: new Uint8Array([137, 80, 78, 71]) };
    },
    async generateConformityPdf(payload) {
      pdfPayload = payload;
      return new Uint8Array([1, 2, 3]);
    },
    async storeConformityPdf() {
      return { r2Key: "conformity.pdf" };
    },
    async sendConformityEmail() {
      return { delivered: false, skipped: true, error: null };
    },
    async syncPublicTrackingSnapshotForInstallation() {},
  });

  const response = await handleInstallationConformityRoute(
    new Request("https://worker.example/web/installations/42/conformity", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        signed_by_name: "Juan Perez",
        email_to: "cliente@example.com",
        signature_data_url: "data:image/png;base64,iVBORw0KGgo=",
        include_all_incident_photos: true,
        send_email: false,
        gps: {
          lat: -34.9011,
          lng: -56.1645,
          accuracy_m: 18,
          captured_at: "2026-03-26T09:59:00.000Z",
          source: "browser",
          status: "captured",
          note: "",
        },
      }),
    }),
    {},
    {},
    ["installations", "42", "conformity"],
    true,
    {
      tenant_id: "default",
      role: "admin",
      sub: "tech1",
      user_id: 7,
      session_version: 3,
    },
  );

  assert.equal(response.status, 201);
  const metadata = JSON.parse(persistedInput?.metadataJson || "{}");
  assert.equal(metadata.budget?.budget_id, 88);
  assert.equal(metadata.budget?.budget_number, "P-20260326-42-GPS1");
  assert.deepEqual(metadata.gps, {
    lat: -34.9011,
    lng: -56.1645,
    accuracy_m: 18,
    captured_at: "2026-03-26T09:59:00.000Z",
    source: "browser",
    status: "captured",
    note: "",
    maps_url: "https://www.google.com/maps?q=-34.9011,-56.1645",
  });
  assert.equal(pdfPayload?.gps?.gps_capture_status, "captured");
  assert.equal(pdfPayload?.gps?.gps_capture_source, "browser");
});

test("conformity route logs gps override with mandatory reason", async () => {
  let persistedInput = null;
  const auditPayloads = [];

  const { handleInstallationConformityRoute } = createConformitiesRouteHandlers({
    buildGpsMapsUrl,
    buildGpsMetadataSnapshot,
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
    normalizeGpsPayload,
    normalizeRealtimeTenantId(value) {
      return String(value || "").trim().toLowerCase() || "default";
    },
    requireWebWriteRole() {},
    async readJsonOrThrowBadRequest(request) {
      return request.json();
    },
    async logAuditEvent(_env, payload) {
      auditPayloads.push(payload);
    },
    getClientIpForRateLimit() {
      return "127.0.0.1";
    },
    nowIso() {
      return "2026-03-26T10:00:00.000Z";
    },
    async loadInstallationConformityContext() {
      return {
        installation: { id: 42, client_name: "Acme", status: "done", notes: "", driver_brand: "Intel", driver_version: "1.0.0" },
        asset: null,
        incidents: [],
        photos: [],
      };
    },
    async loadLatestInstallationConformity() {
      return null;
    },
    async loadInstallationConformityPdfById() {
      return null;
    },
    async loadLatestApprovedInstallationBudget() {
      return {
        id: 90,
        installation_id: 42,
        tenant_id: "default",
        budget_number: "P-20260326-42-OVRD",
        approval_status: "approved",
        approved_by_name: "Cliente",
        approved_by_channel: "whatsapp",
        approved_at: "2026-03-26T09:00:00.000Z",
      };
    },
    async loadInstallationBudgetById() {
      return null;
    },
    async persistInstallationConformity(_env, input) {
      persistedInput = input;
      return { id: 17, installation_id: 42, tenant_id: input.tenantId, status: input.status, metadata_json: input.metadataJson };
    },
    async storeSignatureAsset() {
      return { r2Key: "signature.png", bytes: new Uint8Array([137, 80, 78, 71]) };
    },
    async generateConformityPdf() {
      return new Uint8Array([1, 2, 3]);
    },
    async storeConformityPdf() {
      return { r2Key: "conformity.pdf" };
    },
    async sendConformityEmail() {
      return { delivered: false, skipped: true, error: null };
    },
    async syncPublicTrackingSnapshotForInstallation() {},
  });

  const response = await handleInstallationConformityRoute(
    new Request("https://worker.example/web/installations/42/conformity", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        signed_by_name: "Juan Perez",
        email_to: "cliente@example.com",
        signature_data_url: "data:image/png;base64,iVBORw0KGgo=",
        send_email: false,
        gps: {
          status: "override",
          source: "override",
          note: "Sin senal en sala tecnica del subsuelo",
        },
      }),
    }),
    {},
    {},
    ["installations", "42", "conformity"],
    true,
    {
      tenant_id: "default",
      role: "admin",
      sub: "tech1",
      user_id: 7,
      session_version: 3,
    },
  );

  assert.equal(response.status, 201);
  const metadata = JSON.parse(persistedInput?.metadataJson || "{}");
  assert.equal(metadata.gps?.status, "override");
  assert.equal(metadata.gps?.source, "override");
  assert.equal(metadata.gps?.note, "Sin senal en sala tecnica del subsuelo");
  assert.equal(metadata.gps?.maps_url, "");
  assert.equal(auditPayloads.length, 2);
  assert.equal(auditPayloads[1]?.action, "override_installation_conformity_gps");
  assert.equal(auditPayloads[1]?.details?.reason, "Sin senal en sala tecnica del subsuelo");
});

test("conformity route ignores deprecated geofence policy inputs and persists GPS metadata only", async () => {
  let persistedInput = null;
  const auditPayloads = [];

  const { handleInstallationConformityRoute } = createConformitiesRouteHandlers({
    buildGpsMapsUrl,
    buildGpsMetadataSnapshot,
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
    normalizeGpsPayload,
    normalizeRealtimeTenantId(value) {
      return String(value || "").trim().toLowerCase() || "default";
    },
    requireWebWriteRole() {},
    async readJsonOrThrowBadRequest(request) {
      return request.json();
    },
    async logAuditEvent(_env, payload) {
      auditPayloads.push(payload);
    },
    getClientIpForRateLimit() {
      return "127.0.0.1";
    },
    nowIso() {
      return "2026-03-26T10:00:00.000Z";
    },
    async loadInstallationConformityContext() {
      return {
        installation: {
          id: 42,
          client_name: "Acme",
          status: "done",
          notes: "",
          driver_brand: "Intel",
          driver_version: "1.0.0",
          site_lat: -34.9011,
          site_lng: -56.1645,
          site_radius_m: 50,
        },
        asset: null,
        incidents: [],
        photos: [],
      };
    },
    async loadLatestInstallationConformity() {
      return null;
    },
    async loadInstallationConformityPdfById() {
      return null;
    },
    async loadLatestApprovedInstallationBudget() {
      return {
        id: 99,
        installation_id: 42,
        tenant_id: "default",
        budget_number: "P-20260326-42-DEPR",
        approval_status: "approved",
        approved_by_name: "Cliente",
        approved_by_channel: "email",
        approved_at: "2026-03-26T09:00:00.000Z",
      };
    },
    async loadInstallationBudgetById() {
      return null;
    },
    async persistInstallationConformity(_env, input) {
      persistedInput = input;
      return { id: 18, installation_id: 42, tenant_id: input.tenantId, status: input.status, metadata_json: input.metadataJson };
    },
    async storeSignatureAsset() {
      return { r2Key: "signature.png", bytes: new Uint8Array([137, 80, 78, 71]) };
    },
    async generateConformityPdf() {
      return new Uint8Array([1, 2, 3]);
    },
    async storeConformityPdf() {
      return { r2Key: "conformity.pdf" };
    },
    async sendConformityEmail() {
      return { delivered: false, skipped: true, error: null };
    },
    async syncPublicTrackingSnapshotForInstallation() {},
  });

  const response = await handleInstallationConformityRoute(
    new Request("https://worker.example/web/installations/42/conformity", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        signed_by_name: "Juan Perez",
        email_to: "cliente@example.com",
        signature_data_url: "data:image/png;base64,iVBORw0KGgo=",
        send_email: false,
        geofence_override_note: "Acceso limitado por seguridad, se firmo desde perimetro autorizado.",
        gps: {
          lat: -34.89,
          lng: -56.15,
          accuracy_m: 10,
          captured_at: "2026-03-26T09:59:00.000Z",
          source: "browser",
          status: "captured",
          note: "",
        },
      }),
    }),
    {
      GEOFENCE_HARD_ENABLED: "true",
      GEOFENCE_HARD_FLOWS: "conformity",
    },
    {},
    ["installations", "42", "conformity"],
    true,
    {
      tenant_id: "default",
      role: "admin",
      sub: "tech1",
      user_id: 7,
      session_version: 3,
    },
  );

  assert.equal(response.status, 201);
  const metadata = JSON.parse(persistedInput?.metadataJson || "{}");
  assert.equal(metadata.geofence, undefined);
  assert.equal(metadata.gps?.status, "captured");
  assert.equal(auditPayloads.some((payload) => payload.action === "override_installation_conformity_geofence"), false);
});

test("conformity route returns 409 when there is no approved budget", async () => {
  const { handleInstallationConformityRoute } = createConformitiesRouteHandlers({
    buildGpsMapsUrl,
    buildGpsMetadataSnapshot,
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
    normalizeGpsPayload,
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
      return "2026-03-26T10:00:00.000Z";
    },
    async loadInstallationConformityContext() {
      return {
        installation: { id: 42, client_name: "Acme", status: "done", notes: "", driver_brand: "Intel", driver_version: "1.0.0" },
        asset: null,
        incidents: [],
        photos: [],
      };
    },
    async loadLatestInstallationConformity() {
      return null;
    },
    async loadInstallationConformityPdfById() {
      return null;
    },
    async loadLatestApprovedInstallationBudget() {
      return null;
    },
    async loadInstallationBudgetById() {
      return null;
    },
    async persistInstallationConformity() {
      throw new Error("should_not_persist_without_budget");
    },
    async storeSignatureAsset() {
      return { r2Key: "signature.png", bytes: new Uint8Array([137, 80, 78, 71]) };
    },
    async generateConformityPdf() {
      return new Uint8Array([1, 2, 3]);
    },
    async storeConformityPdf() {
      return { r2Key: "conformity.pdf" };
    },
    async sendConformityEmail() {
      return { delivered: false, skipped: true, error: null };
    },
    async syncPublicTrackingSnapshotForInstallation() {},
  });

  await assert.rejects(
    () =>
      handleInstallationConformityRoute(
        new Request("https://worker.example/web/installations/42/conformity", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            signed_by_name: "Juan Perez",
            email_to: "cliente@example.com",
            signature_data_url: "data:image/png;base64,iVBORw0KGgo=",
            send_email: false,
          }),
        }),
        {},
        {},
        ["installations", "42", "conformity"],
        true,
        {
          tenant_id: "default",
          role: "admin",
          sub: "tech1",
          user_id: 7,
          session_version: 3,
        },
      ),
    (error) => {
      assert.equal(error?.status, 409);
      assert.match(String(error?.message || ""), /presupuesto aprobado/i);
      return true;
    },
  );
});

test("conformity route allows closure without approved budget when commercial coverage includes service", async () => {
  let persistedInput = null;
  const { handleInstallationConformityRoute } = createConformitiesRouteHandlers({
    buildGpsMapsUrl,
    buildGpsMetadataSnapshot,
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
    normalizeGpsPayload,
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
      return "2026-03-26T10:00:00.000Z";
    },
    async loadInstallationConformityContext() {
      return {
        installation: {
          id: 42,
          client_name: "Acme",
          status: "done",
          notes: "",
          driver_brand: "Intel",
          driver_version: "1.0.0",
          commercial_closure_mode: "warranty_included",
          commercial_closure_note: "Reparacion cubierta por garantia vigente.",
        },
        asset: null,
        incidents: [],
        photos: [],
      };
    },
    async loadLatestInstallationConformity() {
      return null;
    },
    async loadInstallationConformityPdfById() {
      return null;
    },
    async loadLatestApprovedInstallationBudget() {
      return null;
    },
    async loadInstallationBudgetById() {
      return null;
    },
    async persistInstallationConformity(_env, input) {
      persistedInput = input;
      return {
        id: 700,
        installation_id: 42,
        tenant_id: input.tenantId,
        status: input.status,
        budget_id: input.budgetId,
        metadata_json: input.metadataJson,
      };
    },
    async storeSignatureAsset() {
      return { r2Key: "signature.png", bytes: new Uint8Array([137, 80, 78, 71]) };
    },
    async generateConformityPdf() {
      return new Uint8Array([1, 2, 3]);
    },
    async storeConformityPdf() {
      return { r2Key: "conformity.pdf" };
    },
    async sendConformityEmail() {
      return { delivered: false, skipped: true, error: null };
    },
    async syncPublicTrackingSnapshotForInstallation() {},
  });

  const response = await handleInstallationConformityRoute(
    new Request("https://worker.example/web/installations/42/conformity", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        signed_by_name: "Juan Perez",
        email_to: "cliente@example.com",
        signature_data_url: "data:image/png;base64,iVBORw0KGgo=",
        send_email: false,
      }),
    }),
    {},
    {},
    ["installations", "42", "conformity"],
    true,
    {
      tenant_id: "default",
      role: "admin",
      sub: "tech1",
      user_id: 7,
      session_version: 3,
    },
  );

  assert.equal(response.status, 201);
  assert.equal(persistedInput?.budgetId, null);
  const metadata = JSON.parse(String(persistedInput?.metadataJson || "{}"));
  assert.equal(metadata?.commercial_closure?.mode, "warranty_included");
  assert.equal(metadata?.commercial_closure?.requires_budget, false);
});

test("conformity route returns 409 when commercial no-budget mode has no note", async () => {
  const { handleInstallationConformityRoute } = createConformitiesRouteHandlers({
    buildGpsMapsUrl,
    buildGpsMetadataSnapshot,
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
    normalizeGpsPayload,
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
      return "2026-03-26T10:00:00.000Z";
    },
    async loadInstallationConformityContext() {
      return {
        installation: {
          id: 42,
          client_name: "Acme",
          status: "done",
          notes: "",
          driver_brand: "Intel",
          driver_version: "1.0.0",
          commercial_closure_mode: "plan_included",
          commercial_closure_note: "",
        },
        asset: null,
        incidents: [],
        photos: [],
      };
    },
    async loadLatestInstallationConformity() {
      return null;
    },
    async loadInstallationConformityPdfById() {
      return null;
    },
    async loadLatestApprovedInstallationBudget() {
      return null;
    },
    async loadInstallationBudgetById() {
      return null;
    },
    async persistInstallationConformity() {
      throw new Error("should_not_persist_without_commercial_note");
    },
    async storeSignatureAsset() {
      return { r2Key: "signature.png", bytes: new Uint8Array([137, 80, 78, 71]) };
    },
    async generateConformityPdf() {
      return new Uint8Array([1, 2, 3]);
    },
    async storeConformityPdf() {
      return { r2Key: "conformity.pdf" };
    },
    async sendConformityEmail() {
      return { delivered: false, skipped: true, error: null };
    },
    async syncPublicTrackingSnapshotForInstallation() {},
  });

  await assert.rejects(
    () =>
      handleInstallationConformityRoute(
        new Request("https://worker.example/web/installations/42/conformity", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            signed_by_name: "Juan Perez",
            email_to: "cliente@example.com",
            signature_data_url: "data:image/png;base64,iVBORw0KGgo=",
            send_email: false,
          }),
        }),
        {},
        {},
        ["installations", "42", "conformity"],
        true,
        {
          tenant_id: "default",
          role: "admin",
          sub: "tech1",
          user_id: 7,
          session_version: 3,
        },
      ),
    (error) => {
      assert.equal(error?.status, 409);
      assert.match(String(error?.message || ""), /motivo comercial/i);
      return true;
    },
  );
});

test("conformity route accepts explicit budget_id when it matches latest approved budget", async () => {
  let persistedInput = null;
  const { handleInstallationConformityRoute } = createConformitiesRouteHandlers({
    buildGpsMapsUrl,
    buildGpsMetadataSnapshot,
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
    normalizeGpsPayload,
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
      return "2026-03-26T10:00:00.000Z";
    },
    async loadInstallationConformityContext() {
      return {
        installation: { id: 42, client_name: "Acme", status: "done", notes: "", driver_brand: "Intel", driver_version: "1.0.0" },
        asset: null,
        incidents: [],
        photos: [],
      };
    },
    async loadLatestInstallationConformity() {
      return null;
    },
    async loadInstallationConformityPdfById() {
      return null;
    },
    async loadLatestApprovedInstallationBudget() {
      return {
        id: 120,
        installation_id: 42,
        tenant_id: "default",
        budget_number: "P-20260326-42-OK01",
        approval_status: "approved",
        approved_by_name: "Cliente",
        approved_by_channel: "email",
        approved_at: "2026-03-26T09:00:00.000Z",
      };
    },
    async loadInstallationBudgetById(_env, installationId, budgetId, tenantId) {
      if (Number(installationId) !== 42 || Number(budgetId) !== 120 || String(tenantId) !== "default") {
        return null;
      }
      return {
        id: 120,
        installation_id: 42,
        tenant_id: "default",
        budget_number: "P-20260326-42-OK01",
        approval_status: "approved",
        approved_by_name: "Cliente",
        approved_by_channel: "email",
        approved_at: "2026-03-26T09:00:00.000Z",
      };
    },
    async persistInstallationConformity(_env, input) {
      persistedInput = input;
      return {
        id: 500,
        installation_id: 42,
        tenant_id: input.tenantId,
        status: input.status,
        metadata_json: input.metadataJson,
      };
    },
    async storeSignatureAsset() {
      return { r2Key: "signature.png", bytes: new Uint8Array([137, 80, 78, 71]) };
    },
    async generateConformityPdf() {
      return new Uint8Array([1, 2, 3]);
    },
    async storeConformityPdf() {
      return { r2Key: "conformity.pdf" };
    },
    async sendConformityEmail() {
      return { delivered: false, skipped: true, error: null };
    },
    async syncPublicTrackingSnapshotForInstallation() {},
  });

  const response = await handleInstallationConformityRoute(
    new Request("https://worker.example/web/installations/42/conformity", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        signed_by_name: "Juan Perez",
        email_to: "cliente@example.com",
        signature_data_url: "data:image/png;base64,iVBORw0KGgo=",
        budget_id: 120,
        send_email: false,
      }),
    }),
    {},
    {},
    ["installations", "42", "conformity"],
    true,
    {
      tenant_id: "default",
      role: "admin",
      sub: "tech1",
      user_id: 7,
      session_version: 3,
    },
  );

  assert.equal(response.status, 201);
  assert.equal(persistedInput?.budgetId, 120);
});
