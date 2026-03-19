import assert from "node:assert/strict";
import test from "node:test";

import { createAuditLogsRouteHandlers } from "../../worker/routes/audit-logs.js";
import { createDevicesRouteHandlers } from "../../worker/routes/devices.js";
import { createIncidentsRouteHandlers } from "../../worker/routes/incidents.js";
import { createInstallationsRouteHandlers } from "../../worker/routes/installations.js";
import { createLookupRouteHandlers } from "../../worker/routes/lookup.js";
import { createMaintenanceRouteHandlers } from "../../worker/routes/maintenance.js";
import { createRecordsRouteHandlers } from "../../worker/routes/records.js";
import { createStatisticsRouteHandlers } from "../../worker/routes/statistics.js";
import { createSystemRouteHandlers } from "../../worker/routes/system.js";

function jsonResponse(_request, _env, _corsPolicy, body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
    },
  });
}

function textResponse(_request, _env, _corsPolicy, text, status = 200) {
  return new Response(text, { status });
}

function createIncidentRouteDeps(overrides = {}) {
  return {
    jsonResponse,
    parsePositiveInt(value) {
      return Number(value);
    },
    requireWebWriteRole() {},
    requireAdminRole() {},
    async readJsonOrThrowBadRequest() {
      return {};
    },
    validateIncidentPayload() {
      throw new Error("validateIncidentPayload must be stubbed for this test");
    },
    parseOptionalPositiveInt() {
      return null;
    },
    nowIso() {
      return "2026-12-01T10:00:00.000Z";
    },
    isMissingIncidentAssetColumnError() {
      return false;
    },
    isMissingIncidentTimingColumnsError() {
      return false;
    },
    normalizeIncidentEvidencePayload() {
      return {
        hasChecklistItems: false,
        checklistItems: [],
        hasEvidenceNote: false,
        evidenceNote: null,
      };
    },
    normalizeIncidentStatusPayload() {
      return {
        incidentStatus: "open",
        resolutionNote: null,
      };
    },
    async loadIncidentForTenant() {
      return null;
    },
    async loadIncidentTimingFieldsForTenant() {
      return {};
    },
    parseIncidentChecklistItems(value) {
      return JSON.parse(value || "[]");
    },
    normalizeOptionalString(value, fallback = "") {
      if (value === null || value === undefined) {
        return fallback;
      }
      return String(value).trim();
    },
    async listDeviceTokensForWebRoles() {
      return [];
    },
    criticalIncidentPushRoles: ["admin"],
    async sendPushNotification() {},
    async logAuditEvent() {},
    getClientIpForRateLimit() {
      return "127.0.0.1";
    },
    mapIncidentRow(incident, photos = []) {
      return { ...incident, photos };
    },
    async publishRealtimeEvent() {},
    async publishRealtimeStatsUpdate() {},
    allowedPhotoTypes: new Set(["image/jpeg"]),
    normalizeContentType(value) {
      return String(value || "").trim().toLowerCase();
    },
    validateAndProcessPhoto(bodyBuffer, contentType) {
      return {
        sizeBytes: bodyBuffer.byteLength,
        contentType,
      };
    },
    requireIncidentsBucketOperation() {
      return {
        async put() {},
        async get() {
          return null;
        },
      };
    },
    async loadIncidentByIdForTenant() {
      return null;
    },
    extensionFromType() {
      return "jpg";
    },
    async resolveIncidentPhotoMetadata() {
      return {
        clientName: "",
        assetCode: "",
      };
    },
    buildIncidentPhotoDescriptor() {
      return "incident-photo";
    },
    buildIncidentPhotoFileName() {
      return "incident-photo.jpg";
    },
    buildIncidentR2Key() {
      return "incident-photo.jpg";
    },
    async sha256Hex() {
      return "a".repeat(64);
    },
    async loadIncidentPhotoByIdForTenant() {
      return null;
    },
    sanitizeFileName(value, fallback) {
      return value || fallback;
    },
    corsHeaders() {
      return {};
    },
    ...overrides,
  };
}

test("system routes expose metadata and health handlers", async () => {
  const { handleHealthCheckRoute, handleServiceMetadataRoute } = createSystemRouteHandlers({
    jsonResponse,
  });

  const metadataResponse = handleServiceMetadataRoute(
    new Request("https://worker.example/", { method: "GET" }),
    {},
    {},
    [],
  );
  const metadataBody = await metadataResponse.json();

  assert.equal(metadataResponse.status, 200);
  assert.equal(metadataBody.service, "driver-manager-api");

  const healthResponse = handleHealthCheckRoute(
    new Request("https://worker.example/health", { method: "GET" }),
    {},
    {},
    ["health"],
  );
  const healthBody = await healthResponse.json();

  assert.equal(healthResponse.status, 200);
  assert.equal(healthBody.ok, true);
  assert.equal(typeof healthBody.now, "string");
});

test("statistics trend handler zero-fills missing days", async () => {
  const { handleStatisticsTrendRoute } = createStatisticsRouteHandlers({
    jsonResponse,
    textResponse,
  });
  const db = {
    prepare(sql) {
      assert.match(sql, /FROM installations/);
      return {
        bind(...args) {
          assert.deepEqual(args, [
            "default",
            "2026-02-01T00:00:00.000Z",
            "2026-02-04T00:00:00.000Z",
          ]);
          return this;
        },
        async all() {
          return {
            results: [
              {
                day: "2026-02-01",
                total_installations: 2,
                successful_installations: 1,
                failed_installations: 1,
              },
              {
                day: "2026-02-03",
                total_installations: 1,
                successful_installations: 1,
                failed_installations: 0,
              },
            ],
          };
        },
      };
    },
  };

  const response = await handleStatisticsTrendRoute(
    new Request("https://worker.example/statistics/trend?start_date=2026-02-01&end_date=2026-02-04", {
      method: "GET",
    }),
    { DB: db },
    new URL("https://worker.example/statistics/trend?start_date=2026-02-01&end_date=2026-02-04"),
    {},
    ["statistics", "trend"],
    false,
    null,
    "default",
  );
  const body = await response.json();

  assert.equal(body.days, 3);
  assert.deepEqual(body.points, [
    {
      date: "2026-02-01",
      total_installations: 2,
      successful_installations: 1,
      failed_installations: 1,
    },
    {
      date: "2026-02-02",
      total_installations: 0,
      successful_installations: 0,
      failed_installations: 0,
    },
    {
      date: "2026-02-03",
      total_installations: 1,
      successful_installations: 1,
      failed_installations: 0,
    },
  ]);
});

test("devices handler delegates device registration for authenticated web sessions", async () => {
  let savedPayload = null;
  const { handleDevicesRoute } = createDevicesRouteHandlers({
    jsonResponse,
    normalizeFcmToken(value) {
      return String(value || "").trim();
    },
    async readJsonOrThrowBadRequest() {
      return {
        fcm_token: "token-123",
        device_model: "Pixel 8",
        app_version: "1.2.3",
        platform: "android",
      };
    },
    async upsertDeviceTokenForWebUser(_env, payload) {
      savedPayload = payload;
    },
  });

  const response = await handleDevicesRoute(
    new Request("https://worker.example/web/devices", { method: "POST" }),
    {},
    {},
    ["devices"],
    true,
    {
      user_id: 7,
      tenant_id: "tenant-alpha",
    },
  );
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(body, { success: true, registered: true });
  assert.deepEqual(savedPayload, {
    userId: 7,
    fcmToken: "token-123",
    tenantId: "tenant-alpha",
    deviceModel: "Pixel 8",
    appVersion: "1.2.3",
    platform: "android",
  });
});

test("lookup handler falls back to installation search when assets tables are unavailable", async () => {
  const { handleLookupRoute } = createLookupRouteHandlers({
    jsonResponse,
    isMissingAssetsTableError(error) {
      return String(error?.message || "").includes("no such table: assets");
    },
  });

  const db = {
    prepare(sql) {
      if (sql.includes("FROM assets a")) {
        return {
          bind() {
            return this;
          },
          async all() {
            throw new Error("no such table: assets");
          },
        };
      }

      if (sql.includes("FROM installations")) {
        return {
          bind(...args) {
            assert.deepEqual(args, [
              "tenant-x",
              "printer",
              "printer",
              "printer",
              "%Printer%",
              "%Printer%",
              "%Printer%",
            ]);
            return this;
          },
          async all() {
            return { results: [{ id: 77 }] };
          },
        };
      }

      throw new Error(`Unexpected SQL: ${sql}`);
    },
  };

  const response = await handleLookupRoute(
    new Request("https://worker.example/lookup?code=Printer", { method: "GET" }),
    { DB: db },
    new URL("https://worker.example/lookup?code=Printer"),
    {},
    ["lookup"],
    "tenant-x",
  );
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(body, {
    success: true,
    match: {
      type: "asset",
      asset_id: "Printer",
      external_code: "Printer",
      installation_id: 77,
    },
  });
});

test("maintenance handler delegates cleanup and logs the operation", async () => {
  let loggedPayload = null;
  const { handleMaintenanceCleanupRoute } = createMaintenanceRouteHandlers({
    jsonResponse,
    textResponse,
    async readJsonOrThrowBadRequest() {
      return {
        tenant_id: "Tenant-Alpha",
        dry_run: true,
      };
    },
    normalizeOptionalString(value, fallback = "") {
      if (value === null || value === undefined) return fallback;
      return String(value).trim();
    },
    parseBooleanOrNull(value) {
      if (value === null || value === undefined) return null;
      return Boolean(value);
    },
    normalizeRealtimeTenantId(value) {
      return String(value).trim().toLowerCase();
    },
    requireAdminRole() {},
    assertSameTenantOrSuperAdmin(session, tenantId) {
      assert.equal(session.role, "admin");
      assert.equal(tenantId, "tenant-alpha");
    },
    async cleanupOrphanInstallationArtifacts(_env, tenantId, options) {
      assert.equal(tenantId, "tenant-alpha");
      assert.deepEqual(options, { dryRun: true });
      return {
        scanned_orphan_photo_rows: 2,
        deleted_photo_rows: 0,
      };
    },
    async logAuditEvent(_env, payload) {
      loggedPayload = payload;
    },
    getClientIpForRateLimit() {
      return "10.0.0.1";
    },
  });

  const response = await handleMaintenanceCleanupRoute(
    new Request("https://worker.example/web/maintenance/cleanup-orphans", { method: "POST" }),
    {},
    {},
    ["maintenance", "cleanup-orphans"],
    true,
    { role: "admin", sub: "admin_root" },
    "default",
  );
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.dry_run, true);
  assert.equal(body.tenant_id, "tenant-alpha");
  assert.deepEqual(loggedPayload, {
    action: "maintenance_cleanup_orphans",
    username: "admin_root",
    success: true,
    tenantId: "tenant-alpha",
    details: {
      tenant_id: "tenant-alpha",
      dry_run: true,
      scanned_orphan_photo_rows: 2,
      deleted_photo_rows: 0,
    },
    ipAddress: "10.0.0.1",
    platform: "web",
  });
});

test("audit logs handler paginates GET responses", async () => {
  const { handleAuditLogsRoute } = createAuditLogsRouteHandlers({
    jsonResponse,
    async readJsonOrThrowBadRequest() {
      throw new Error("not used");
    },
    requireAdminRole() {},
    normalizeWebUsername(value) {
      return String(value || "").trim().toLowerCase();
    },
    async logAuditEvent() {},
    parsePageLimit() {
      return 1;
    },
    parseTimestampIdCursor() {
      return null;
    },
    buildTimestampIdCursor(timestamp, id) {
      return `${timestamp}|${id}`;
    },
    appendPaginationHeader(response, nextCursor) {
      response.headers.set("X-Next-Cursor", nextCursor);
    },
  });

  const db = {
    prepare(sql) {
      assert.match(sql, /FROM audit_logs/);
      return {
        bind(...args) {
          assert.deepEqual(args, ["tenant-beta", 2]);
          return this;
        },
        async all() {
          return {
            results: [
              { id: 9, timestamp: "2026-09-02T10:00:00.000Z", action: "b" },
              { id: 8, timestamp: "2026-09-01T10:00:00.000Z", action: "a" },
            ],
          };
        },
      };
    },
  };

  const response = await handleAuditLogsRoute(
    new Request("https://worker.example/audit-logs?limit=1", { method: "GET" }),
    { DB: db },
    new URL("https://worker.example/audit-logs?limit=1"),
    {},
    ["audit-logs"],
    false,
    null,
    "tenant-beta",
  );
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(body, [{ id: 9, timestamp: "2026-09-02T10:00:00.000Z", action: "b" }]);
  assert.equal(response.headers.get("X-Next-Cursor"), "2026-09-02T10:00:00.000Z|9");
});

test("records handler applies manual defaults and publishes updates", async () => {
  const publishedEvents = [];
  const statsUpdates = [];
  const { handleRecordsRoute } = createRecordsRouteHandlers({
    jsonResponse,
    async readJsonOrThrowBadRequest() {
      return {
        timestamp: "2026-10-01T10:00:00.000Z",
        notes: "manual note",
      };
    },
    requireWebWriteRole() {},
    normalizeRealtimeTenantId(value) {
      return String(value || "").trim().toLowerCase() || "default";
    },
    normalizeInstallationPayload(data, defaultStatus) {
      return {
        timestamp: data.timestamp,
        driver_brand: "",
        driver_version: "",
        status: defaultStatus,
        client_name: "",
        driver_description: "",
        installation_time_seconds: 0,
        os_info: "",
        notes: data.notes,
      };
    },
    buildDefaultInstallationOperationalSummary() {
      return {
        active_incident_count: 0,
      };
    },
    async publishRealtimeEvent(_env, payload, tenantId) {
      publishedEvents.push({ payload, tenantId });
    },
    async publishRealtimeStatsUpdate(_env, tenantId) {
      statsUpdates.push(tenantId);
    },
  });

  const db = {
    prepare(sql) {
      assert.match(sql, /INSERT INTO installations/);
      return {
        bind(...args) {
          assert.deepEqual(args, [
            "2026-10-01T10:00:00.000Z",
            "N/A",
            "N/A",
            "manual",
            "Sin cliente",
            "Registro manual",
            0,
            "manual",
            "manual note",
            "tenant-z",
          ]);
          return this;
        },
        async run() {
          return {
            meta: {
              last_row_id: 123,
            },
          };
        },
      };
    },
  };

  const response = await handleRecordsRoute(
    new Request("https://worker.example/records", { method: "POST" }),
    { DB: db },
    {},
    ["records"],
    false,
    null,
    "tenant-z",
  );
  const body = await response.json();

  assert.equal(response.status, 201);
  assert.equal(body.record.id, 123);
  assert.equal(body.record.driver_brand, "N/A");
  assert.equal(body.record.os_info, "manual");
  assert.deepEqual(publishedEvents, [
    {
      payload: {
        type: "installation_created",
        installation: body.record,
      },
      tenantId: "tenant-z",
    },
  ]);
  assert.deepEqual(statsUpdates, ["tenant-z"]);
});

test("installations list handler enriches rows and exposes next cursor", async () => {
  const { handleInstallationsRoute } = createInstallationsRouteHandlers({
    jsonResponse,
    textResponse,
    normalizeOptionalString(value, fallback = "") {
      if (value === null || value === undefined) return fallback;
      return String(value).trim();
    },
    normalizeRealtimeTenantId(value) {
      return String(value || "").trim().toLowerCase() || "default";
    },
    parseDateOrNull() {
      return null;
    },
    parsePageLimit() {
      return 1;
    },
    parseTimestampIdCursor() {
      return null;
    },
    buildTimestampIdCursor(timestamp, id) {
      return `${timestamp}|${id}`;
    },
    appendPaginationHeader(response, nextCursor) {
      response.headers.set("X-Next-Cursor", nextCursor);
    },
    async loadInstallationOperationalSummaries() {
      return new Map([[10, { active_incident_count: 2 }]]);
    },
    mapInstallationWithOperationalState(item, summaries) {
      return {
        ...item,
        ...(summaries.get(item.id) || {}),
      };
    },
    requireWebWriteRole() {},
    async readJsonOrThrowBadRequest() {
      throw new Error("not used");
    },
    normalizeInstallationPayload() {
      throw new Error("not used");
    },
    buildDefaultInstallationOperationalSummary() {
      return {};
    },
    async logAuditEvent() {},
    getClientIpForRateLimit() {
      return "";
    },
    async publishRealtimeEvent() {},
    async publishRealtimeStatsUpdate() {},
    parsePositiveInt() {
      throw new Error("not used");
    },
    normalizeInstallationUpdatePayload() {
      throw new Error("not used");
    },
    async ensureInstallationExistsForDelete() {
      return false;
    },
    async listIncidentPhotoR2KeysForInstallation() {
      return [];
    },
    async deleteIncidentPhotoObjectsFromR2() {},
    async deleteInstallationCascade() {},
  });

  const db = {
    prepare(sql) {
      assert.match(sql, /SELECT \* FROM installations/);
      return {
        bind(...args) {
          assert.deepEqual(args, ["tenant-a", 2]);
          return this;
        },
        async all() {
          return {
            results: [
              { id: 10, timestamp: "2026-11-02T10:00:00.000Z", client_name: "Acme" },
              { id: 9, timestamp: "2026-11-01T10:00:00.000Z", client_name: "Beta" },
            ],
          };
        },
      };
    },
  };

  const response = await handleInstallationsRoute(
    new Request("https://worker.example/installations?limit=1", { method: "GET" }),
    { DB: db },
    new URL("https://worker.example/installations?limit=1"),
    {},
    ["installations"],
    false,
    null,
    "tenant-a",
  );
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(body, [
    {
      id: 10,
      timestamp: "2026-11-02T10:00:00.000Z",
      client_name: "Acme",
      active_incident_count: 2,
    },
  ]);
  assert.equal(response.headers.get("X-Next-Cursor"), "2026-11-02T10:00:00.000Z|10");
});

test("installation by id handler updates notes and emits realtime event", async () => {
  const publishedEvents = [];
  const statsUpdates = [];
  const { handleInstallationByIdRoute } = createInstallationsRouteHandlers({
    jsonResponse,
    textResponse,
    normalizeOptionalString(value, fallback = "") {
      if (value === null || value === undefined) return fallback;
      return String(value).trim();
    },
    normalizeRealtimeTenantId(value) {
      return String(value || "").trim().toLowerCase() || "default";
    },
    parseDateOrNull() {
      return null;
    },
    parsePageLimit() {
      return 100;
    },
    parseTimestampIdCursor() {
      return null;
    },
    buildTimestampIdCursor() {
      return "";
    },
    appendPaginationHeader() {},
    async loadInstallationOperationalSummaries() {
      return new Map();
    },
    mapInstallationWithOperationalState(item) {
      return item;
    },
    requireWebWriteRole() {},
    async readJsonOrThrowBadRequest() {
      return {
        notes: "updated",
        installation_time_seconds: 180,
      };
    },
    normalizeInstallationPayload() {
      return {};
    },
    buildDefaultInstallationOperationalSummary() {
      return {};
    },
    async logAuditEvent() {},
    getClientIpForRateLimit() {
      return "";
    },
    async publishRealtimeEvent(_env, payload, tenantId) {
      publishedEvents.push({ payload, tenantId });
    },
    async publishRealtimeStatsUpdate(_env, tenantId) {
      statsUpdates.push(tenantId);
    },
    parsePositiveInt(value) {
      return Number(value);
    },
    normalizeInstallationUpdatePayload(data) {
      return data;
    },
    async ensureInstallationExistsForDelete() {
      return true;
    },
    async listIncidentPhotoR2KeysForInstallation() {
      return [];
    },
    async deleteIncidentPhotoObjectsFromR2() {},
    async deleteInstallationCascade() {},
  });

  const db = {
    prepare(sql) {
      assert.match(sql, /UPDATE installations/);
      return {
        bind(...args) {
          assert.deepEqual(args, ["updated", 180, 55, "tenant-b"]);
          return this;
        },
        async run() {
          return {
            meta: {
              changes: 1,
            },
          };
        },
      };
    },
  };

  const response = await handleInstallationByIdRoute(
    new Request("https://worker.example/installations/55", { method: "PUT" }),
    { DB: db },
    {},
    ["installations", "55"],
    false,
    null,
    "tenant-b",
  );
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(body, { success: true, updated: "55" });
  assert.deepEqual(publishedEvents, [
    {
      payload: {
        type: "installation_updated",
        installation: {
          id: 55,
          notes: "updated",
          installation_time_seconds: 180,
        },
      },
      tenantId: "tenant-b",
    },
  ]);
  assert.deepEqual(statsUpdates, ["tenant-b"]);
});

test("installation incidents handler creates incident and updates installation state", async () => {
  const realtimeEvents = [];
  const statsUpdates = [];
  const auditEvents = [];
  const { handleInstallationIncidentsRoute } = createIncidentsRouteHandlers({
    jsonResponse,
    parsePositiveInt(value) {
      return Number(value);
    },
    requireWebWriteRole() {},
    async readJsonOrThrowBadRequest() {
      return {
        note: "failure in final step",
        time_adjustment_seconds: 30,
        severity: "high",
        source: "mobile",
        apply_to_installation: true,
        reporter_username: "admin",
      };
    },
    validateIncidentPayload(data) {
      return {
        note: data.note,
        timeAdjustment: data.time_adjustment_seconds,
        estimatedDurationSeconds: 0,
        severity: data.severity,
        source: data.source,
        incidentStatus: "open",
        applyToInstallation: Boolean(data.apply_to_installation),
        reporterUsername: data.reporter_username,
      };
    },
    parseOptionalPositiveInt() {
      return null;
    },
    nowIso() {
      return "2026-12-01T10:00:00.000Z";
    },
    isMissingIncidentAssetColumnError() {
      return false;
    },
    isMissingIncidentTimingColumnsError() {
      return false;
    },
    async listDeviceTokensForWebRoles() {
      return [];
    },
    criticalIncidentPushRoles: ["admin"],
    async sendPushNotification() {},
    async logAuditEvent(_env, payload) {
      auditEvents.push(payload);
    },
    getClientIpForRateLimit() {
      return "127.0.0.1";
    },
    mapIncidentRow(incident, photos = []) {
      return { ...incident, photos };
    },
    async publishRealtimeEvent(_env, payload, tenantId) {
      realtimeEvents.push({ payload, tenantId });
    },
    async publishRealtimeStatsUpdate(_env, tenantId) {
      statsUpdates.push(tenantId);
    },
  });

  const db = {
    prepare(sql) {
      if (sql.includes("SELECT id, notes, installation_time_seconds")) {
        return {
          bind(...args) {
            assert.deepEqual(args, [45, "tenant-q"]);
            return this;
          },
          async all() {
            return {
              results: [{ id: 45, notes: "initial", installation_time_seconds: 120 }],
            };
          },
        };
      }

      if (sql.includes("INSERT INTO incidents")) {
        return {
          bind(...args) {
            assert.equal(args[0], 45);
            assert.equal(args[2], "tenant-q");
            assert.equal(args[4], "failure in final step");
            return this;
          },
          async run() {
            return {
              meta: {
                last_row_id: 501,
              },
            };
          },
        };
      }

      if (sql.includes("UPDATE installations")) {
        return {
          bind(...args) {
            assert.deepEqual(args, ["initial\n[INCIDENT] failure in final step", 150, 45, "tenant-q"]);
            return this;
          },
          async run() {
            return { meta: { changes: 1 } };
          },
        };
      }

      throw new Error(`Unexpected SQL: ${sql}`);
    },
  };

  const response = await handleInstallationIncidentsRoute(
    new Request("https://worker.example/installations/45/incidents", { method: "POST" }),
    { DB: db },
    {},
    ["installations", "45", "incidents"],
    false,
    null,
    "tenant-q",
    "tenant-q",
  );
  const body = await response.json();

  assert.equal(response.status, 201);
  assert.equal(body.success, true);
  assert.equal(body.incident.id, 501);
  assert.equal(auditEvents.length, 1);
  assert.equal(realtimeEvents.length, 2);
  assert.deepEqual(statsUpdates, ["tenant-q"]);
});

test("incident evidence handler updates checklist and evidence note", async () => {
  const auditEvents = [];
  const realtimeEvents = [];
  const { handleIncidentEvidenceRoute } = createIncidentsRouteHandlers(createIncidentRouteDeps({
    async readJsonOrThrowBadRequest() {
      return {
        reporter_username: "tech1",
      };
    },
    normalizeIncidentEvidencePayload() {
      return {
        hasChecklistItems: true,
        checklistItems: [{ code: "seal", checked: true }],
        hasEvidenceNote: true,
        evidenceNote: "verified on site",
      };
    },
    async loadIncidentForTenant(_env, payload) {
      assert.deepEqual(payload, {
        incidentId: 99,
        incidentsTenantId: "tenant-z",
      });
      return {
        id: 99,
        installation_id: 45,
        checklist_json: null,
        evidence_note: null,
        incident_status: "open",
      };
    },
    async logAuditEvent(_env, payload) {
      auditEvents.push(payload);
    },
    async publishRealtimeEvent(_env, payload, tenantId) {
      realtimeEvents.push({ payload, tenantId });
    },
  }));

  const db = {
    prepare(sql) {
      assert.match(sql, /UPDATE incidents/);
      return {
        bind(...args) {
          assert.deepEqual(args, [
            JSON.stringify([{ code: "seal", checked: true }]),
            "verified on site",
            99,
            "tenant-z",
          ]);
          return this;
        },
        async run() {
          return { meta: { changes: 1 } };
        },
      };
    },
  };

  const response = await handleIncidentEvidenceRoute(
    new Request("https://worker.example/incidents/99/evidence", { method: "PATCH" }),
    { DB: db },
    {},
    ["incidents", "99", "evidence"],
    false,
    null,
    "tenant-z",
    "tenant-z",
  );
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.success, true);
  assert.equal(body.incident.evidence_note, "verified on site");
  assert.deepEqual(auditEvents[0].details, {
    incident_id: 99,
    installation_id: 45,
    checklist_items_count: 1,
    has_evidence_note: true,
  });
  assert.deepEqual(realtimeEvents, [
    {
      payload: {
        type: "incident_evidence_updated",
        incident: {
          id: 99,
          installation_id: 45,
          checklist_json: JSON.stringify([{ code: "seal", checked: true }]),
          evidence_note: "verified on site",
          incident_status: "open",
          photos: [],
        },
      },
      tenantId: "tenant-z",
    },
  ]);
});

test("incident status handler resolves incidents through the nested installation route", async () => {
  const auditEvents = [];
  const realtimeEvents = [];
  let adminRole = null;
  const { handleIncidentStatusRoute } = createIncidentsRouteHandlers(createIncidentRouteDeps({
    requireAdminRole(role) {
      adminRole = role;
    },
    async readJsonOrThrowBadRequest() {
      return {};
    },
    normalizeIncidentStatusPayload() {
      return {
        incidentStatus: "resolved",
        resolutionNote: "Issue fixed",
      };
    },
    nowIso() {
      return "2026-12-01T10:05:30.000Z";
    },
    async loadIncidentForTenant(_env, payload) {
      assert.deepEqual(payload, {
        incidentId: 99,
        incidentsTenantId: "tenant-z",
        installationId: 45,
      });
      return {
        id: 99,
        installation_id: 45,
        incident_status: "in_progress",
        status_updated_at: "2026-12-01T10:00:00.000Z",
        created_at: "2026-12-01T09:58:00.000Z",
      };
    },
    async loadIncidentTimingFieldsForTenant(_env, incidentId, incidentsTenantId) {
      assert.equal(incidentId, 99);
      assert.equal(incidentsTenantId, "tenant-z");
      return {
        work_started_at: "2026-12-01T10:00:00.000Z",
        work_ended_at: null,
        actual_duration_seconds: null,
      };
    },
    async logAuditEvent(_env, payload) {
      auditEvents.push(payload);
    },
    async publishRealtimeEvent(_env, payload, tenantId) {
      realtimeEvents.push({ payload, tenantId });
    },
  }));

  const db = {
    prepare(sql) {
      assert.match(sql, /UPDATE incidents/);
      return {
        bind(...args) {
          assert.deepEqual(args, [
            "resolved",
            "2026-12-01T10:05:30.000Z",
            "manager1",
            "2026-12-01T10:05:30.000Z",
            "manager1",
            "Issue fixed",
            "2026-12-01T10:00:00.000Z",
            "2026-12-01T10:05:30.000Z",
            330,
            99,
            "tenant-z",
          ]);
          return this;
        },
        async run() {
          return { meta: { changes: 1 } };
        },
      };
    },
  };

  const response = await handleIncidentStatusRoute(
    new Request("https://worker.example/installations/45/incidents/99/status", { method: "PATCH" }),
    { DB: db },
    {},
    ["installations", "45", "incidents", "99", "status"],
    true,
    { role: "admin", sub: "manager1" },
    "tenant-z",
    "tenant-z",
  );
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(adminRole, "admin");
  assert.equal(body.incident.incident_status, "resolved");
  assert.equal(body.incident.actual_duration_seconds, 330);
  assert.deepEqual(auditEvents[0].details, {
    incident_id: 99,
    installation_id: 45,
    previous_status: "in_progress",
    new_status: "resolved",
    has_resolution_note: true,
    actual_duration_seconds: 330,
  });
  assert.deepEqual(realtimeEvents, [
    {
      payload: {
        type: "incident_status_updated",
        incident: {
          id: 99,
          installation_id: 45,
          incident_status: "resolved",
          status_updated_at: "2026-12-01T10:05:30.000Z",
          created_at: "2026-12-01T09:58:00.000Z",
          status_updated_by: "manager1",
          resolved_at: "2026-12-01T10:05:30.000Z",
          resolved_by: "manager1",
          resolution_note: "Issue fixed",
          work_started_at: "2026-12-01T10:00:00.000Z",
          work_ended_at: "2026-12-01T10:05:30.000Z",
          actual_duration_seconds: 330,
          photos: [],
        },
      },
      tenantId: "tenant-z",
    },
  ]);
});

test("incident photos handler uploads validated images to storage", async () => {
  let storedObject = null;
  const { handleIncidentPhotosRoute } = createIncidentsRouteHandlers(createIncidentRouteDeps({
    validateIncidentPayload() {
      return {};
    },
    validateAndProcessPhoto(bodyBuffer, contentType) {
      assert.equal(bodyBuffer.byteLength, 4);
      assert.equal(contentType, "image/jpeg");
      return {
        sizeBytes: 4,
        contentType,
      };
    },
    requireIncidentsBucketOperation(_env, operation) {
      assert.equal(operation, "put");
      return {
        async put(key, body, options) {
          storedObject = {
            key,
            size: body.byteLength,
            options,
          };
        },
      };
    },
    async loadIncidentByIdForTenant(_env, incidentId, incidentsTenantId) {
      assert.equal(incidentId, 99);
      assert.equal(incidentsTenantId, "tenant-z");
      return {
        id: 99,
        installation_id: 45,
      };
    },
    extensionFromType() {
      return "jpg";
    },
    async resolveIncidentPhotoMetadata() {
      return {
        clientName: "Acme",
        assetCode: "DEV-1",
      };
    },
    buildIncidentPhotoDescriptor() {
      return "acme-dev-1";
    },
    buildIncidentPhotoFileName() {
      return "acme-dev-1.jpg";
    },
    buildIncidentR2Key() {
      return "incidents/45/99/acme-dev-1.jpg";
    },
    async sha256Hex() {
      return "b".repeat(64);
    },
  }));

  const db = {
    prepare(sql) {
      assert.match(sql, /INSERT INTO incident_photos/);
      return {
        bind(...args) {
          assert.deepEqual(args, [
            99,
            "tenant-z",
            "incidents/45/99/acme-dev-1.jpg",
            "acme-dev-1.jpg",
            "image/jpeg",
            4,
            "b".repeat(64),
            "2026-12-01T10:00:00.000Z",
          ]);
          return this;
        },
        async run() {
          return { meta: { last_row_id: 73 } };
        },
      };
    },
  };

  const response = await handleIncidentPhotosRoute(
    new Request("https://worker.example/incidents/99/photos", {
      method: "POST",
      headers: {
        "content-type": "image/jpeg",
      },
      body: new Uint8Array([1, 2, 3, 4]),
    }),
    { DB: db },
    {},
    ["incidents", "99", "photos"],
    false,
    null,
    "tenant-z",
  );
  const body = await response.json();

  assert.equal(response.status, 201);
  assert.deepEqual(storedObject, {
    key: "incidents/45/99/acme-dev-1.jpg",
    size: 4,
    options: {
      httpMetadata: {
        contentType: "image/jpeg",
      },
    },
  });
  assert.deepEqual(body.photo, {
    id: 73,
    incident_id: 99,
    r2_key: "incidents/45/99/acme-dev-1.jpg",
    file_name: "acme-dev-1.jpg",
    content_type: "image/jpeg",
    size_bytes: 4,
    sha256: "b".repeat(64),
    created_at: "2026-12-01T10:00:00.000Z",
  });
});

test("incident photos handler streams stored images back to the client", async () => {
  const { handleIncidentPhotosRoute } = createIncidentsRouteHandlers(createIncidentRouteDeps({
    requireIncidentsBucketOperation(_env, operation) {
      assert.equal(operation, "get");
      return {
        async get(key) {
          assert.equal(key, "incidents/45/99/acme-dev-1.jpg");
          return {
            body: new Uint8Array([9, 8, 7]),
            httpMetadata: {
              contentType: "image/jpeg",
            },
          };
        },
      };
    },
    async loadIncidentPhotoByIdForTenant(_env, photoId, incidentsTenantId) {
      assert.equal(photoId, 73);
      assert.equal(incidentsTenantId, "tenant-z");
      return {
        id: 73,
        r2_key: "incidents/45/99/acme-dev-1.jpg",
        file_name: "field photo.jpg",
        content_type: "image/jpeg",
      };
    },
    sanitizeFileName(value, fallback) {
      assert.equal(fallback, "photo_73");
      return value.replace(/\s+/g, "_");
    },
    corsHeaders() {
      return {
        "Access-Control-Allow-Origin": "*",
      };
    },
  }));

  const response = await handleIncidentPhotosRoute(
    new Request("https://worker.example/photos/73", { method: "GET" }),
    {},
    {},
    ["photos", "73"],
    false,
    null,
    "tenant-z",
  );
  const body = Array.from(new Uint8Array(await response.arrayBuffer()));

  assert.equal(response.status, 200);
  assert.deepEqual(body, [9, 8, 7]);
  assert.equal(response.headers.get("Content-Type"), "image/jpeg");
  assert.equal(
    response.headers.get("Content-Disposition"),
    "inline; filename=\"field_photo.jpg\"",
  );
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), "*");
});
