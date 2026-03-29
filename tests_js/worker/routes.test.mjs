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
import { createTenantsRouteHandlers } from "../../worker/routes/tenants.js";
import { createTechniciansRouteHandlers } from "../../worker/routes/technicians.js";
import { buildPublicTrackingSnapshot } from "../../worker/lib/public-tracking.js";

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

function createTechniciansRouteDeps(overrides = {}) {
  return {
    jsonResponse,
    normalizeOptionalString(value, fallback = "") {
      if (value === null || value === undefined) return fallback;
      return String(value).trim();
    },
    normalizeRealtimeTenantId(value) {
      return String(value || "").trim().toLowerCase() || "default";
    },
    parsePositiveInt(value) {
      return Number(value);
    },
    async readJsonOrThrowBadRequest() {
      return {};
    },
    requireAdminRole() {},
    assertSameTenantOrSuperAdmin() {},
    async logAuditEvent() {},
    getClientIpForRateLimit() {
      return "127.0.0.1";
    },
    nowIso() {
      return "2026-03-28T18:00:00.000Z";
    },
    ...overrides,
  };
}

function createTenantsRouteDeps(overrides = {}) {
  return {
    jsonResponse,
    normalizeOptionalString(value, fallback = "") {
      if (value === null || value === undefined) return fallback;
      return String(value).trim();
    },
    normalizeRealtimeTenantId(value) {
      return String(value || "").trim().toLowerCase() || "default";
    },
    async readJsonOrThrowBadRequest() {
      return {};
    },
    canManageAllTenants(session) {
      const role = String(session?.role || "").trim().toLowerCase();
      const tenantId = String(session?.tenant_id || "default").trim().toLowerCase() || "default";
      return (role === "platform_owner" || role === "super_admin") && tenantId === "default";
    },
    async logAuditEvent() {},
    getClientIpForRateLimit() {
      return "127.0.0.1";
    },
    nowIso() {
      return "2026-03-28T18:00:00.000Z";
    },
    ...overrides,
  };
}

test("public tracking snapshot prioritizes reopened incidents over a previous conformity close", async () => {
  const installations = [
    {
      id: 45,
      tenant_id: "tenant-a",
      timestamp: "2026-03-26T09:00:00.000Z",
    },
  ];
  const incidents = [
    {
      id: 18,
      installation_id: 45,
      tenant_id: "tenant-a",
      incident_status: "in_progress",
      created_at: "2026-03-26T10:00:00.000Z",
      status_updated_at: "2026-03-26T12:30:00.000Z",
      resolved_at: null,
      deleted_at: null,
    },
  ];
  const installationConformities = [
    {
      id: 7,
      installation_id: 45,
      tenant_id: "tenant-a",
      generated_at: "2026-03-26T11:00:00.000Z",
      status: "generated",
      generated_by_username: "ops-admin",
      photo_count: 0,
    },
  ];
  const env = {
    DB: {
      prepare(sql) {
        const normalized = String(sql || "").replace(/\s+/g, " ").trim();
        return {
          bind(...args) {
            this.args = args;
            return this;
          },
          async all() {
            if (normalized.startsWith("SELECT id, timestamp FROM installations WHERE id = ?")) {
              const [installationId, tenantId] = this.args;
              const rows = installations.filter(
                (row) => Number(row.id) === Number(installationId) && String(row.tenant_id) === String(tenantId),
              );
              return { results: rows.slice(0, 1) };
            }
            if (normalized.startsWith("SELECT SUM(CASE WHEN LOWER(COALESCE(incident_status, 'open')) = 'open' THEN 1 ELSE 0 END) AS incident_open_count")) {
              const [installationId, tenantId] = this.args;
              const scoped = incidents.filter(
                (row) =>
                  Number(row.installation_id) === Number(installationId) &&
                  String(row.tenant_id) === String(tenantId) &&
                  !row.deleted_at,
              );
              const countByStatus = (status) =>
                scoped.filter((row) => String(row.incident_status || "open").toLowerCase() === status).length;
              return {
                results: [{
                  incident_open_count: countByStatus("open"),
                  incident_in_progress_count: countByStatus("in_progress"),
                  incident_paused_count: countByStatus("paused"),
                  incident_resolved_count: countByStatus("resolved"),
                }],
              };
            }
            if (normalized.startsWith("SELECT id, incident_status, created_at, status_updated_at, resolved_at FROM incidents WHERE installation_id = ?")) {
              const [installationId, tenantId] = this.args;
              const rows = incidents
                .filter(
                  (row) =>
                    Number(row.installation_id) === Number(installationId) &&
                    String(row.tenant_id) === String(tenantId) &&
                    !row.deleted_at,
                )
                .sort((left, right) => {
                  const leftTs = String(left.status_updated_at || left.created_at || "");
                  const rightTs = String(right.status_updated_at || right.created_at || "");
                  const byTs = rightTs.localeCompare(leftTs);
                  if (byTs !== 0) return byTs;
                  return Number(right.id) - Number(left.id);
                });
              return { results: rows.slice(0, 1) };
            }
            if (normalized.startsWith("SELECT * FROM installation_conformities WHERE installation_id = ?")) {
              const [installationId, tenantId] = this.args;
              const rows = installationConformities
                .filter(
                  (row) =>
                    Number(row.installation_id) === Number(installationId) &&
                    String(row.tenant_id) === String(tenantId),
                )
                .sort((left, right) => {
                  const byTs = String(right.generated_at || "").localeCompare(String(left.generated_at || ""));
                  if (byTs !== 0) return byTs;
                  return Number(right.id) - Number(left.id);
                });
              return { results: rows.slice(0, 1) };
            }
            throw new Error(`Unhandled SQL in test: ${normalized}`);
          },
        };
      },
    },
  };

  const snapshot = await buildPublicTrackingSnapshot(env, {
    tenantId: "tenant-a",
    installationId: 45,
  });

  assert.equal(snapshot.public_status, "en_progreso");
  assert.equal(snapshot.closed, false);
  assert.equal(snapshot.reopened, true);
  assert.equal(snapshot.public_previous_status, "cerrado");
  assert.equal(snapshot.public_transition_label, "Cerrado -> Caso reabierto, en trabajo");
  assert.match(snapshot.public_message, /reabierto/i);
  assert.ok(snapshot.milestones.some((item) => item.type === "case_reopened"));
  assert.ok(snapshot.milestones.some((item) => item.type === "work_resumed" && /retomado/i.test(item.label)));
});

test("tenants route lists tenant summaries for super admin", async () => {
  const env = {
    DB: {
      prepare(sql) {
        const normalized = String(sql || "").replace(/\s+/g, " ").trim();
        return {
          bind(...args) {
            this.args = args;
            return this;
          },
          async all() {
            if (normalized.startsWith("SELECT name FROM sqlite_master")) {
              return {
                results: [{ name: this.args?.[0] || "" }],
              };
            }
            if (normalized.startsWith("PRAGMA table_info(tenants)")) {
              return {
                results: [
                  { name: "id" },
                  { name: "name" },
                  { name: "slug" },
                  { name: "status" },
                  { name: "plan_code" },
                  { name: "created_at" },
                  { name: "updated_at" },
                ],
              };
            }
            if (normalized.startsWith("PRAGMA table_info(web_users)")) {
              return {
                results: [
                  { name: "id" },
                  { name: "username" },
                  { name: "role" },
                  { name: "is_active" },
                  { name: "last_login_at" },
                  { name: "tenant_id" },
                ],
              };
            }
            if (normalized.startsWith("PRAGMA table_info(tenant_usage_snapshots)")) {
              return {
                results: [
                  { name: "id" },
                  { name: "tenant_id" },
                  { name: "usage_month" },
                  { name: "users_count" },
                  { name: "storage_bytes" },
                  { name: "incidents_count" },
                  { name: "recorded_at" },
                ],
              };
            }
            if (normalized.startsWith("PRAGMA table_info(web_users)")) {
              return {
                results: [
                  { name: "id" },
                  { name: "username" },
                  { name: "role" },
                  { name: "is_active" },
                  { name: "last_login_at" },
                  { name: "tenant_id" },
                ],
              };
            }
            if (normalized.startsWith("PRAGMA table_info(tenant_usage_snapshots)")) {
              return {
                results: [
                  { name: "id" },
                  { name: "tenant_id" },
                  { name: "usage_month" },
                  { name: "users_count" },
                  { name: "storage_bytes" },
                  { name: "incidents_count" },
                  { name: "recorded_at" },
                ],
              };
            }
            if (normalized.startsWith("PRAGMA table_info(incidents)")) {
              return {
                results: [{ name: "deleted_at" }, { name: "incident_status" }],
              };
            }
            if (normalized.startsWith("SELECT COUNT(*) AS total FROM web_users")) {
              return { results: [{ total: 4 }] };
            }
            if (normalized.startsWith("SELECT COUNT(*) AS total FROM technicians")) {
              return { results: [{ total: 2 }] };
            }
            if (normalized.startsWith("SELECT COUNT(*) AS total FROM installations")) {
              return { results: [{ total: 11 }] };
            }
            if (normalized.startsWith("SELECT COUNT(*) AS total FROM incidents")) {
              return { results: [{ total: 3 }] };
            }
            if (normalized.startsWith("SELECT username FROM web_users")) {
              return {
                results: [{ username: "ana" }, { username: "bruno" }],
              };
            }
            if (normalized.includes("FROM tenants t ORDER BY")) {
              return {
                results: [
                  {
                    id: "tenant-a",
                    name: "Acme Uruguay",
                    slug: "acme-uy",
                    status: "active",
                    plan_code: "growth",
                    created_at: "2026-03-01T10:00:00.000Z",
                    updated_at: "2026-03-28T10:00:00.000Z",
                    users_count: 4,
                    technicians_count: 2,
                    installations_count: 11,
                    active_incidents_count: 3,
                    admin_usernames: "ana|bruno",
                  },
                ],
              };
            }
            throw new Error(`Unhandled SQL in tenant list test: ${normalized}`);
          },
        };
      },
    },
  };

  const handlers = createTenantsRouteHandlers(createTenantsRouteDeps());
  const response = await handlers.handleTenantsRoute(
    new Request("https://example.com/web/tenants"),
    env,
    new URL("https://example.com/web/tenants"),
    {},
    ["tenants"],
    true,
    { sub: "root", role: "super_admin", tenant_id: "default" },
  );

  assert.ok(response instanceof Response);
  const body = await response.json();
  assert.equal(body.success, true);
  assert.equal(body.tenants.length, 1);
  assert.equal(body.tenants[0].metrics.active_incidents_count, 3);
  assert.deepEqual(body.tenants[0].admin_usernames, ["ana", "bruno"]);
});

test("tenants route returns tenant detail with admins and latest usage", async () => {
  const env = {
    DB: {
      prepare(sql) {
        const normalized = String(sql || "").replace(/\s+/g, " ").trim();
        return {
          bind(...args) {
            this.args = args;
            return this;
          },
          async all() {
            if (normalized.startsWith("SELECT name FROM sqlite_master")) {
              return {
                results: [{ name: this.args?.[0] || "" }],
              };
            }
            if (normalized.startsWith("PRAGMA table_info(tenants)")) {
              return {
                results: [
                  { name: "id" },
                  { name: "name" },
                  { name: "slug" },
                  { name: "status" },
                  { name: "plan_code" },
                  { name: "created_at" },
                  { name: "updated_at" },
                ],
              };
            }
            if (normalized.startsWith("PRAGMA table_info(web_users)")) {
              return {
                results: [
                  { name: "id" },
                  { name: "username" },
                  { name: "role" },
                  { name: "is_active" },
                  { name: "last_login_at" },
                  { name: "tenant_id" },
                ],
              };
            }
            if (normalized.startsWith("PRAGMA table_info(tenant_usage_snapshots)")) {
              return {
                results: [
                  { name: "id" },
                  { name: "tenant_id" },
                  { name: "usage_month" },
                  { name: "users_count" },
                  { name: "storage_bytes" },
                  { name: "incidents_count" },
                  { name: "recorded_at" },
                ],
              };
            }
            if (normalized.startsWith("PRAGMA table_info(incidents)")) {
              return {
                results: [{ name: "deleted_at" }, { name: "incident_status" }],
              };
            }
            if (normalized.startsWith("SELECT COUNT(*) AS total FROM web_users")) {
              return { results: [{ total: 4 }] };
            }
            if (normalized.startsWith("SELECT COUNT(*) AS total FROM technicians")) {
              return { results: [{ total: 2 }] };
            }
            if (normalized.startsWith("SELECT COUNT(*) AS total FROM installations")) {
              return { results: [{ total: 11 }] };
            }
            if (normalized.startsWith("SELECT COUNT(*) AS total FROM incidents")) {
              return { results: [{ total: 3 }] };
            }
            if (normalized.includes("FROM tenants t WHERE t.id = ?")) {
              return {
                results: [
                  {
                    id: "tenant-a",
                    name: "Acme Uruguay",
                    slug: "acme-uy",
                    status: "active",
                    plan_code: "growth",
                    created_at: "2026-03-01T10:00:00.000Z",
                    updated_at: "2026-03-28T10:00:00.000Z",
                    users_count: 4,
                    technicians_count: 2,
                    installations_count: 11,
                    active_incidents_count: 3,
                    admin_usernames: "ana|bruno",
                  },
                ],
              };
            }
            if (normalized.includes("FROM web_users")) {
              return {
                results: [
                  {
                    id: 7,
                    username: "ana",
                    role: "admin",
                    is_active: 1,
                    last_login_at: "2026-03-28T17:00:00.000Z",
                    tenant_id: "tenant-a",
                  },
                ],
              };
            }
            if (normalized.startsWith("SELECT username FROM web_users")) {
              return {
                results: [{ username: "ana" }, { username: "bruno" }],
              };
            }
            if (normalized.includes("FROM tenant_usage_snapshots")) {
              return {
                results: [
                  {
                    usage_month: "2026-03",
                    users_count: 4,
                    storage_bytes: 2048,
                    incidents_count: 27,
                    recorded_at: "2026-03-28T18:00:00.000Z",
                  },
                ],
              };
            }
            throw new Error(`Unhandled SQL in tenant detail test: ${normalized}`);
          },
        };
      },
    },
  };

  const handlers = createTenantsRouteHandlers(createTenantsRouteDeps());
  const response = await handlers.handleTenantsRoute(
    new Request("https://example.com/web/tenants/tenant-a"),
    env,
    new URL("https://example.com/web/tenants/tenant-a"),
    {},
    ["tenants", "tenant-a"],
    true,
    { sub: "root", role: "super_admin", tenant_id: "default" },
  );

  assert.ok(response instanceof Response);
  const body = await response.json();
  assert.equal(body.success, true);
  assert.equal(body.tenant.id, "tenant-a");
  assert.equal(body.admins[0].username, "ana");
  assert.equal(body.latest_usage.incidents_count, 27);
});

test("tenants route previews delete impact before removing a tenant", async () => {
  const handlers = createTenantsRouteHandlers(createTenantsRouteDeps());
  const env = {
    DB: {
      prepare(sql) {
        const normalized = String(sql || "").replace(/\s+/g, " ").trim();
        return {
          bind(...args) {
            this.args = args;
            return this;
          },
          async all() {
            if (normalized.startsWith("PRAGMA table_info(tenants)")) {
              return {
                results: [
                  { name: "id" },
                  { name: "name" },
                  { name: "slug" },
                  { name: "status" },
                  { name: "plan_code" },
                ],
              };
            }
            if (normalized.startsWith("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")) {
              return { results: [{ name: this.args?.[0] || "" }] };
            }
            if (normalized.startsWith("SELECT name FROM sqlite_master WHERE type = 'table'")) {
              return {
                results: [
                  { name: "tenants" },
                  { name: "web_users" },
                  { name: "technicians" },
                  { name: "installations" },
                  { name: "incidents" },
                  { name: "audit_logs" },
                ],
              };
            }
            if (normalized.startsWith("PRAGMA table_info(web_users)")) {
              return { results: [{ name: "tenant_id" }] };
            }
            if (normalized.startsWith("PRAGMA table_info(technicians)")) {
              return { results: [{ name: "tenant_id" }] };
            }
            if (normalized.startsWith("PRAGMA table_info(installations)")) {
              return { results: [{ name: "tenant_id" }] };
            }
            if (normalized.startsWith("PRAGMA table_info(incidents)")) {
              return { results: [{ name: "tenant_id" }, { name: "deleted_at" }, { name: "incident_status" }] };
            }
            if (normalized.startsWith("PRAGMA table_info(audit_logs)")) {
              return { results: [{ name: "tenant_id" }] };
            }
            if (normalized.startsWith("PRAGMA foreign_key_list(")) {
              return { results: [] };
            }
            if (normalized.includes("FROM tenants t WHERE t.id = ?")) {
              return {
                results: [{
                  id: "tenant-z",
                  name: "Tenant Z",
                  slug: "tenant-z",
                  status: "active",
                  plan_code: "starter",
                }],
              };
            }
            if (normalized.startsWith("SELECT COUNT(*) AS total FROM web_users")) {
              return { results: [{ total: 2 }] };
            }
            if (normalized.startsWith("SELECT COUNT(*) AS total FROM technicians")) {
              return { results: [{ total: 1 }] };
            }
            if (normalized.startsWith("SELECT COUNT(*) AS total FROM installations")) {
              return { results: [{ total: 3 }] };
            }
            if (normalized.startsWith("SELECT COUNT(*) AS total FROM incidents")) {
              return { results: [{ total: 4 }] };
            }
            if (normalized.startsWith("SELECT COUNT(*) AS total FROM audit_logs")) {
              return { results: [{ total: 5 }] };
            }
            if (normalized.startsWith("SELECT username FROM web_users")) {
              return { results: [] };
            }
            throw new Error(`Unhandled SQL in tenant delete impact test: ${normalized}`);
          },
        };
      },
    },
  };

  const response = await handlers.handleTenantsRoute(
    new Request("https://example.com/web/tenants/tenant-z/delete-impact"),
    env,
    new URL("https://example.com/web/tenants/tenant-z/delete-impact"),
    {},
    ["tenants", "tenant-z", "delete-impact"],
    true,
    { sub: "root", role: "platform_owner", tenant_id: "default" },
  );

  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.tenant.id, "tenant-z");
  assert.equal(body.impact.deleted_tables.web_users, 2);
  assert.equal(body.impact.deleted_tables.incidents, 4);
  assert.equal(body.impact.total_rows, 15);
});

test("tenants route creates tenant even when optional tenant tables are not migrated yet", async () => {
  const auditEvents = [];
  const handlers = createTenantsRouteHandlers(createTenantsRouteDeps({
    async readJsonOrThrowBadRequest() {
      return {
        name: "Aramid",
        slug: "aramid-uy",
        plan_code: "starter",
        status: "active",
      };
    },
    async logAuditEvent(_env, payload) {
      auditEvents.push(payload);
    },
  }));

  const env = {
    DB: {
      prepare(sql) {
        const normalized = String(sql || "").replace(/\s+/g, " ").trim();
        return {
          bind(...args) {
            this.args = args;
            return this;
          },
          async all() {
            if (normalized.startsWith("SELECT name FROM sqlite_master")) {
              const tableName = this.args?.[0];
              if (tableName === "web_users" || tableName === "installations" || tableName === "incidents") {
                return { results: [{ name: tableName }] };
              }
              return { results: [] };
            }
            if (normalized.startsWith("PRAGMA table_info(tenants)")) {
              return {
                results: [{ name: "id" }, { name: "name" }, { name: "status" }],
              };
            }
            if (normalized.startsWith("PRAGMA table_info(incidents)")) {
              return {
                results: [],
              };
            }
            if (normalized.startsWith("SELECT COUNT(*) AS total FROM web_users")) {
              return { results: [{ total: 0 }] };
            }
            if (normalized.startsWith("SELECT COUNT(*) AS total FROM installations")) {
              return { results: [{ total: 0 }] };
            }
            if (normalized.startsWith("SELECT COUNT(*) AS total FROM incidents")) {
              return { results: [{ total: 0 }] };
            }
            if (normalized.startsWith("SELECT username FROM web_users")) {
              return { results: [] };
            }
            if (normalized.includes("FROM tenants t WHERE t.id = ?")) {
              return {
                results: [
                  {
                    id: "aramid-uy",
                    name: "Aramid",
                    slug: "aramid-uy",
                    status: "active",
                    plan_code: "starter",
                    created_at: "2026-03-28T23:00:00.000Z",
                    updated_at: "2026-03-28T23:00:00.000Z",
                  },
                ],
              };
            }
            throw new Error(`Unhandled SQL in tenant create fallback test: ${normalized}`);
          },
          async run() {
            if (normalized.startsWith("INSERT INTO tenants")) {
              return { meta: { changes: 1 } };
            }
            throw new Error(`Unhandled run SQL in tenant create fallback test: ${normalized}`);
          },
        };
      },
    },
  };

  const response = await handlers.handleTenantsRoute(
    new Request("https://example.com/web/tenants", { method: "POST" }),
    env,
    new URL("https://example.com/web/tenants"),
    {},
    ["tenants"],
    true,
    { sub: "root", role: "super_admin", tenant_id: "default" },
  );

  const body = await response.json();
  assert.equal(response.status, 201);
  assert.equal(body.success, true);
  assert.equal(body.tenant.id, "aramid-uy");
  assert.equal(body.tenant.metrics.technicians_count, 0);
  assert.equal(auditEvents[0].action, "tenant_created");
});

test("tenants route lists legacy tenants table without slug column", async () => {
  const env = {
    DB: {
      prepare(sql) {
        const normalized = String(sql || "").replace(/\s+/g, " ").trim();
        return {
          bind(...args) {
            this.args = args;
            return this;
          },
          async all() {
            if (normalized.startsWith("PRAGMA table_info(tenants)")) {
              return {
                results: [{ name: "id" }, { name: "name" }, { name: "status" }],
              };
            }
            if (normalized.startsWith("SELECT name FROM sqlite_master")) {
              return {
                results: [{ name: this.args?.[0] || "" }],
              };
            }
            if (normalized.startsWith("PRAGMA table_info(incidents)")) {
              return {
                results: [],
              };
            }
            if (normalized.startsWith("SELECT COUNT(*) AS total FROM web_users")) {
              return { results: [{ total: 1 }] };
            }
            if (normalized.startsWith("SELECT COUNT(*) AS total FROM technicians")) {
              return { results: [{ total: 0 }] };
            }
            if (normalized.startsWith("SELECT COUNT(*) AS total FROM installations")) {
              return { results: [{ total: 0 }] };
            }
            if (normalized.startsWith("SELECT COUNT(*) AS total FROM incidents")) {
              return { results: [{ total: 0 }] };
            }
            if (normalized.startsWith("SELECT username FROM web_users")) {
              return { results: [{ username: "root" }] };
            }
            if (normalized.includes("t.id AS slug") && normalized.includes("FROM tenants t")) {
              return {
                results: [
                  {
                    id: "legacy-tenant",
                    name: "Legacy Tenant",
                    slug: "legacy-tenant",
                    status: "active",
                    plan_code: "starter",
                    created_at: "",
                    updated_at: "",
                  },
                ],
              };
            }
            throw new Error(`Unhandled SQL in legacy tenant list test: ${normalized}`);
          },
        };
      },
    },
  };

  const handlers = createTenantsRouteHandlers(createTenantsRouteDeps());
  const response = await handlers.handleTenantsRoute(
    new Request("https://example.com/web/tenants"),
    env,
    new URL("https://example.com/web/tenants"),
    {},
    ["tenants"],
    true,
    { sub: "root", role: "super_admin", tenant_id: "default" },
  );

  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.tenants.length, 1);
  assert.equal(body.tenants[0].slug, "legacy-tenant");
  assert.equal(body.tenants[0].plan_code, "starter");
});

test("tenants route rejects super admin outside default tenant", async () => {
  const handlers = createTenantsRouteHandlers(createTenantsRouteDeps());
  await assert.rejects(
    () => handlers.handleTenantsRoute(
      new Request("https://example.com/web/tenants"),
      { DB: { prepare() { throw new Error("DB should not be queried"); } } },
      new URL("https://example.com/web/tenants"),
      {},
      ["tenants"],
      true,
      { sub: "tenant-root", role: "super_admin", tenant_id: "tenant-a" },
    ),
    (error) => error instanceof Error && /plataforma/i.test(error.message),
  );
});

test("tenants route deletes tenant and tenant-scoped rows except default", async () => {
  const auditEvents = [];
  const executedDeletes = [];
  const handlers = createTenantsRouteHandlers(createTenantsRouteDeps({
    async logAuditEvent(_env, payload) {
      auditEvents.push(payload);
    },
  }));

  const env = {
    DB: {
      prepare(sql) {
        const normalized = String(sql || "").replace(/\s+/g, " ").trim();
        return {
          bind(...args) {
            this.args = args;
            return this;
          },
          async all() {
            if (normalized.startsWith("PRAGMA table_info(tenants)")) {
              return {
                results: [
                  { name: "id" },
                  { name: "name" },
                  { name: "slug" },
                  { name: "status" },
                  { name: "plan_code" },
                ],
              };
            }
            if (normalized.startsWith("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")) {
              return { results: [{ name: this.args?.[0] || "" }] };
            }
            if (normalized.startsWith("SELECT name FROM sqlite_master WHERE type = 'table'")) {
              return {
                results: [
                  { name: "tenants" },
                  { name: "web_users" },
                  { name: "technicians" },
                  { name: "installations" },
                  { name: "audit_logs" },
                ],
              };
            }
            if (normalized.startsWith("PRAGMA table_info(web_users)")) {
              return { results: [{ name: "tenant_id" }] };
            }
            if (normalized.startsWith("PRAGMA table_info(technicians)")) {
              return { results: [{ name: "tenant_id" }] };
            }
            if (normalized.startsWith("PRAGMA table_info(installations)")) {
              return { results: [{ name: "tenant_id" }] };
            }
            if (normalized.startsWith("PRAGMA table_info(audit_logs)")) {
              return { results: [{ name: "tenant_id" }] };
            }
            if (normalized.startsWith("PRAGMA table_info(incidents)")) {
              return { results: [{ name: "tenant_id" }, { name: "deleted_at" }, { name: "incident_status" }] };
            }
            if (normalized.startsWith("PRAGMA foreign_key_list(")) {
              return { results: [] };
            }
            if (normalized.includes("FROM tenants t WHERE t.id = ?")) {
              return {
                results: [{
                  id: "tenant-z",
                  name: "Tenant Z",
                  slug: "tenant-z",
                  status: "active",
                  plan_code: "starter",
                }],
              };
            }
            if (normalized.startsWith("SELECT COUNT(*) AS total FROM web_users")) {
              return { results: [{ total: 2 }] };
            }
            if (normalized.startsWith("SELECT COUNT(*) AS total FROM technicians")) {
              return { results: [{ total: 1 }] };
            }
            if (normalized.startsWith("SELECT COUNT(*) AS total FROM installations")) {
              return { results: [{ total: 3 }] };
            }
            if (normalized.startsWith("SELECT COUNT(*) AS total FROM audit_logs")) {
              return { results: [{ total: 4 }] };
            }
            if (normalized.startsWith("SELECT COUNT(*) AS total FROM incidents")) {
              return { results: [{ total: 0 }] };
            }
            if (normalized.startsWith("SELECT username FROM web_users")) {
              return { results: [] };
            }
            throw new Error(`Unhandled SQL in tenant delete test: ${normalized}`);
          },
          async run() {
            executedDeletes.push(normalized);
            return { meta: { changes: 1 } };
          },
        };
      },
    },
  };

  const response = await handlers.handleTenantsRoute(
    new Request("https://example.com/web/tenants/tenant-z", { method: "DELETE" }),
    env,
    new URL("https://example.com/web/tenants/tenant-z"),
    {},
    ["tenants", "tenant-z"],
    true,
    { sub: "root", role: "platform_owner", tenant_id: "default" },
  );

  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.deleted, true);
  assert.equal(body.tenant_id, "tenant-z");
  assert.equal(body.deleted_tables.web_users, 2);
  assert.equal(body.deleted_tables.installations, 3);
  assert.ok(executedDeletes.some((sql) => sql.startsWith("DELETE FROM web_users")));
  assert.ok(executedDeletes.some((sql) => sql.startsWith("DELETE FROM tenants")));
  assert.equal(auditEvents[0].action, "tenant_deleted");
});

test("public tracking snapshot distinguishes delayed-again and closed-again milestones", async () => {
  const installations = [
    {
      id: 52,
      tenant_id: "tenant-a",
      timestamp: "2026-03-26T08:00:00.000Z",
    },
  ];
  const incidents = [
    {
      id: 24,
      installation_id: 52,
      tenant_id: "tenant-a",
      incident_status: "paused",
      created_at: "2026-03-26T09:00:00.000Z",
      status_updated_at: "2026-03-26T12:10:00.000Z",
      resolved_at: null,
      deleted_at: null,
    },
  ];
  const installationConformities = [
    {
      id: 11,
      installation_id: 52,
      tenant_id: "tenant-a",
      generated_at: "2026-03-26T10:30:00.000Z",
      status: "generated",
      generated_by_username: "ops-admin",
      photo_count: 0,
    },
  ];
  const env = {
    DB: {
      prepare(sql) {
        const normalized = String(sql || "").replace(/\s+/g, " ").trim();
        return {
          bind(...args) {
            this.args = args;
            return this;
          },
          async all() {
            if (normalized.startsWith("SELECT id, timestamp FROM installations WHERE id = ?")) {
              const [installationId, tenantId] = this.args;
              return {
                results: installations.filter(
                  (row) => Number(row.id) === Number(installationId) && String(row.tenant_id) === String(tenantId),
                ).slice(0, 1),
              };
            }
            if (normalized.startsWith("SELECT SUM(CASE WHEN LOWER(COALESCE(incident_status, 'open')) = 'open' THEN 1 ELSE 0 END) AS incident_open_count")) {
              const [installationId, tenantId] = this.args;
              const scoped = incidents.filter(
                (row) =>
                  Number(row.installation_id) === Number(installationId) &&
                  String(row.tenant_id) === String(tenantId) &&
                  !row.deleted_at,
              );
              const countByStatus = (status) =>
                scoped.filter((row) => String(row.incident_status || "open").toLowerCase() === status).length;
              return {
                results: [{
                  incident_open_count: countByStatus("open"),
                  incident_in_progress_count: countByStatus("in_progress"),
                  incident_paused_count: countByStatus("paused"),
                  incident_resolved_count: countByStatus("resolved"),
                }],
              };
            }
            if (normalized.startsWith("SELECT id, incident_status, created_at, status_updated_at, resolved_at FROM incidents WHERE installation_id = ?")) {
              const [installationId, tenantId] = this.args;
              return {
                results: incidents.filter(
                  (row) =>
                    Number(row.installation_id) === Number(installationId) &&
                    String(row.tenant_id) === String(tenantId) &&
                    !row.deleted_at,
                ).slice(0, 1),
              };
            }
            if (normalized.startsWith("SELECT * FROM installation_conformities WHERE installation_id = ?")) {
              const [installationId, tenantId] = this.args;
              return {
                results: installationConformities.filter(
                  (row) =>
                    Number(row.installation_id) === Number(installationId) &&
                    String(row.tenant_id) === String(tenantId),
                ).slice(0, 1),
              };
            }
            throw new Error(`Unhandled SQL in test: ${normalized}`);
          },
        };
      },
    },
  };

  const snapshot = await buildPublicTrackingSnapshot(env, {
    tenantId: "tenant-a",
    installationId: 52,
  });

  assert.equal(snapshot.public_status, "demorado");
  assert.equal(snapshot.reopened, true);
  assert.ok(snapshot.milestones.some((item) => item.type === "case_delayed_again" && /demorado nuevamente/i.test(item.label)));
  incidents[0].incident_status = "resolved";
  incidents[0].resolved_at = "2026-03-26T12:20:00.000Z";
  incidents[0].status_updated_at = "2026-03-26T12:20:00.000Z";
  installationConformities[0].generated_at = "2026-03-26T13:00:00.000Z";

  const closedAgainSnapshot = await buildPublicTrackingSnapshot(env, {
    tenantId: "tenant-a",
    installationId: 52,
  });

  assert.equal(closedAgainSnapshot.public_status, "cerrado");
  assert.equal(closedAgainSnapshot.reopened, false);
  assert.equal(closedAgainSnapshot.public_previous_status, "resuelto");
  assert.equal(closedAgainSnapshot.public_transition_label, "Resuelto -> Cerrado");
  assert.ok(
    closedAgainSnapshot.milestones.some(
      (item) => item.type === "conformity_generated" && item.label === "Servicio cerrado nuevamente",
    ),
  );
});

function createIncidentRouteDeps(overrides = {}) {
  return {
    jsonResponse,
    parsePositiveInt(value) {
      return Number(value);
    },
    requireWebWriteRole() {},
    requireAdminRole() {},
    requireSuperAdminRole() {},
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
    evaluateGeofence() {
      return {
        geofence_distance_m: null,
        geofence_radius_m: null,
        geofence_result: "not_applicable",
        geofence_checked_at: null,
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
    async recoverIncidentPhotosFromStorageForTenant() {
      return 0;
    },
    sanitizeFileName(value, fallback) {
      return value || fallback;
    },
    corsHeaders() {
      return {};
    },
    async syncPublicTrackingSnapshotForInstallation() {},
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

test("technicians route lists tenant technicians for authenticated web sessions", async () => {
  const { handleTechniciansRoute } = createTechniciansRouteHandlers(createTechniciansRouteDeps());

  const db = {
    prepare(sql) {
      assert.match(sql, /FROM technicians t/);
      return {
        bind(...args) {
          assert.deepEqual(args, ["tenant-a", 0]);
          return this;
        },
        async all() {
          return {
            results: [
              {
                id: 4,
                tenant_id: "tenant-a",
                web_user_id: 7,
                display_name: "Ana Campo",
                email: "ana@example.com",
                phone: "099000111",
                employee_code: "TEC-01",
                notes: "Turno manana",
                is_active: 1,
                created_at: "2026-03-28T10:00:00.000Z",
                updated_at: "2026-03-28T10:00:00.000Z",
                active_assignment_count: 2,
              },
            ],
          };
        },
      };
    },
  };

  const response = await handleTechniciansRoute(
    new Request("https://worker.example/web/technicians", { method: "GET" }),
    { DB: db },
    new URL("https://worker.example/web/technicians"),
    {},
    ["technicians"],
    true,
    {
      sub: "ops-admin",
      tenant_id: "tenant-a",
      role: "admin",
    },
  );
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.technicians.length, 1);
  assert.equal(body.technicians[0].display_name, "Ana Campo");
  assert.equal(body.technicians[0].active_assignment_count, 2);
});

test("technicians route creates a technician linked to a tenant web user", async () => {
  const auditEvents = [];
  const { handleTechniciansRoute } = createTechniciansRouteHandlers(createTechniciansRouteDeps({
    async readJsonOrThrowBadRequest() {
      return {
        display_name: "Luis Rivera",
        web_user_id: 9,
        employee_code: "TEC-09",
      };
    },
    async logAuditEvent(_env, payload) {
      auditEvents.push(payload);
    },
  }));

  let selectCount = 0;
  const db = {
    prepare(sql) {
      if (sql.includes("FROM web_users")) {
        return {
          bind(...args) {
            assert.deepEqual(args, [9, "tenant-a"]);
            return this;
          },
          async all() {
            return { results: [{ id: 9, username: "tech-user", tenant_id: "tenant-a", is_active: 1 }] };
          },
        };
      }
      if (sql.includes("INSERT INTO technicians")) {
        return {
          bind(...args) {
            assert.deepEqual(args, [
              "tenant-a",
              9,
              "Luis Rivera",
              null,
              null,
              "TEC-09",
              null,
              "2026-03-28T18:00:00.000Z",
              "2026-03-28T18:00:00.000Z",
            ]);
            return this;
          },
          async run() {
            return { meta: { last_row_id: 12 } };
          },
        };
      }
      if (sql.includes("FROM technicians")) {
        selectCount += 1;
        return {
          bind(...args) {
            assert.deepEqual(args, [12, "tenant-a"]);
            return this;
          },
          async all() {
            return {
              results: [{
                id: 12,
                tenant_id: "tenant-a",
                web_user_id: 9,
                display_name: "Luis Rivera",
                email: null,
                phone: null,
                employee_code: "TEC-09",
                notes: null,
                is_active: 1,
                created_at: "2026-03-28T18:00:00.000Z",
                updated_at: "2026-03-28T18:00:00.000Z",
              }],
            };
          },
        };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  };

  const response = await handleTechniciansRoute(
    new Request("https://worker.example/web/technicians", { method: "POST" }),
    { DB: db },
    new URL("https://worker.example/web/technicians"),
    {},
    ["technicians"],
    true,
    {
      sub: "ops-admin",
      tenant_id: "tenant-a",
      role: "admin",
    },
  );
  const body = await response.json();

  assert.equal(response.status, 201);
  assert.equal(selectCount, 1);
  assert.equal(body.technician.id, 12);
  assert.equal(body.technician.web_user_id, 9);
  assert.equal(auditEvents[0].action, "technician_created");
});

test("technicians route creates assignments for existing tenant entities", async () => {
  const auditEvents = [];
  const { handleTechniciansRoute } = createTechniciansRouteHandlers(createTechniciansRouteDeps({
    async readJsonOrThrowBadRequest() {
      return {
        entity_type: "installation",
        entity_id: 45,
        assignment_role: "owner",
      };
    },
    async logAuditEvent(_env, payload) {
      auditEvents.push(payload);
    },
  }));

  const db = {
    prepare(sql) {
      if (sql.includes("FROM technicians")) {
        return {
          bind(...args) {
            assert.deepEqual(args, [12, "tenant-a"]);
            return this;
          },
          async all() {
            return {
              results: [{
                id: 12,
                tenant_id: "tenant-a",
                display_name: "Luis Rivera",
                is_active: 1,
              }],
            };
          },
        };
      }
      if (sql.includes("FROM installations")) {
        return {
          bind(...args) {
            assert.deepEqual(args, [45, "tenant-a"]);
            return this;
          },
          async all() {
            return { results: [{ id: 45 }] };
          },
        };
      }
      if (sql.includes("INSERT INTO technician_assignments")) {
        return {
          bind(...args) {
            assert.deepEqual(args, [
              "tenant-a",
              12,
              "installation",
              "45",
              "owner",
              7,
              "ops-supervisor",
              "2026-03-28T18:00:00.000Z",
              null,
            ]);
            return this;
          },
          async run() {
            return { meta: { last_row_id: 31 } };
          },
        };
      }
      if (sql.includes("FROM technician_assignments")) {
        return {
          bind(...args) {
            assert.deepEqual(args, [31, "tenant-a"]);
            return this;
          },
          async all() {
            return {
              results: [{
                id: 31,
                tenant_id: "tenant-a",
                technician_id: 12,
                entity_type: "installation",
                entity_id: "45",
                assignment_role: "owner",
                assigned_by_user_id: 7,
                assigned_by_username: "ops-supervisor",
                assigned_at: "2026-03-28T18:00:00.000Z",
                unassigned_at: null,
                metadata_json: null,
              }],
            };
          },
        };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  };

  const response = await handleTechniciansRoute(
    new Request("https://worker.example/web/technicians/12/assignments", { method: "POST" }),
    { DB: db },
    new URL("https://worker.example/web/technicians/12/assignments"),
    {},
    ["technicians", "12", "assignments"],
    true,
    {
      sub: "ops-supervisor",
      tenant_id: "tenant-a",
      role: "supervisor",
      user_id: 7,
    },
  );
  const body = await response.json();

  assert.equal(response.status, 201);
  assert.equal(body.assignment.id, 31);
  assert.equal(body.assignment.entity_type, "installation");
  assert.equal(auditEvents[0].action, "technician_assignment_created");
});

test("technician assignments route soft-unassigns active assignments", async () => {
  const auditEvents = [];
  const { handleTechnicianAssignmentsRoute } = createTechniciansRouteHandlers(createTechniciansRouteDeps({
    async logAuditEvent(_env, payload) {
      auditEvents.push(payload);
    },
  }));

  let updateCalled = false;
  const db = {
    prepare(sql) {
      if (sql.includes("FROM technician_assignments")) {
        return {
          bind(...args) {
            assert.deepEqual(args, [31, "tenant-a"]);
            return this;
          },
          async all() {
            return {
              results: [{
                id: 31,
                tenant_id: "tenant-a",
                technician_id: 12,
                entity_type: "installation",
                entity_id: "45",
                assignment_role: "owner",
                assigned_by_user_id: 7,
                assigned_by_username: "ops-supervisor",
                assigned_at: "2026-03-28T18:00:00.000Z",
                unassigned_at: null,
                metadata_json: null,
              }],
            };
          },
        };
      }
      if (sql.includes("UPDATE technician_assignments")) {
        return {
          bind(...args) {
            assert.deepEqual(args, ["2026-03-28T18:00:00.000Z", 31, "tenant-a"]);
            return this;
          },
          async run() {
            updateCalled = true;
            return { meta: { changes: 1 } };
          },
        };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  };

  const response = await handleTechnicianAssignmentsRoute(
    new Request("https://worker.example/web/technician-assignments/31", { method: "DELETE" }),
    { DB: db },
    new URL("https://worker.example/web/technician-assignments/31"),
    {},
    ["technician-assignments", "31"],
    true,
    {
      sub: "ops-admin",
      tenant_id: "tenant-a",
      role: "admin",
    },
  );
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(updateCalled, true);
  assert.equal(body.assignment.unassigned_at, "2026-03-28T18:00:00.000Z");
  assert.equal(auditEvents[0].action, "technician_assignment_removed");
});

test("technician assignments route lists active assignments for an entity", async () => {
  const { handleTechnicianAssignmentsRoute } = createTechniciansRouteHandlers(createTechniciansRouteDeps());

  const db = {
    prepare(sql) {
      assert.match(sql, /FROM technician_assignments ta/);
      return {
        bind(...args) {
          assert.deepEqual(args, ["tenant-a", "installation", "45", 1, 1]);
          return this;
        },
        async all() {
          return {
            results: [{
              id: 51,
              tenant_id: "tenant-a",
              technician_id: 12,
              entity_type: "installation",
              entity_id: "45",
              assignment_role: "owner",
              assigned_by_user_id: 7,
              assigned_by_username: "ops-admin",
              assigned_at: "2026-03-28T18:00:00.000Z",
              unassigned_at: null,
              metadata_json: null,
              technician_display_name: "Luis Rivera",
              technician_employee_code: "TEC-09",
              technician_is_active: 1,
            }],
          };
        },
      };
    },
  };

  const response = await handleTechnicianAssignmentsRoute(
    new Request("https://worker.example/web/technician-assignments?entity_type=installation&entity_id=45", {
      method: "GET",
    }),
    { DB: db },
    new URL("https://worker.example/web/technician-assignments?entity_type=installation&entity_id=45"),
    {},
    ["technician-assignments"],
    true,
    {
      sub: "ops-admin",
      tenant_id: "tenant-a",
      role: "admin",
    },
  );
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.assignments.length, 1);
  assert.equal(body.assignments[0].technician_display_name, "Luis Rivera");
  assert.equal(body.assignments[0].technician_is_active, true);
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
  const publicTrackingRefreshes = [];
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
        has_site_config: false,
        site_lat: null,
        site_lng: null,
        site_radius_m: null,
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
    async syncPublicTrackingSnapshotForInstallation(_env, payload) {
      publicTrackingRefreshes.push(payload);
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
          null,
          null,
          null,
          null,
          "none",
          "pending",
          "",
          null,
          null,
          null,
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
  assert.deepEqual(publicTrackingRefreshes, [
    {
      tenantId: "tenant-z",
      installationId: 123,
    },
  ]);
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
      if (sql.includes("UPDATE installations")) {
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
      }
      assert.match(sql, /SELECT \*/);
      return {
        bind(...args) {
          assert.deepEqual(args, [55, "tenant-b"]);
          return this;
        },
        async all() {
          return {
            results: [{
              id: 55,
              notes: "updated",
              installation_time_seconds: 180,
              site_lat: null,
              site_lng: null,
              site_radius_m: null,
            }],
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
  assert.deepEqual(body, {
    success: true,
    updated: "55",
    installation: {
      id: 55,
      notes: "updated",
      installation_time_seconds: 180,
      site_lat: null,
      site_lng: null,
      site_radius_m: null,
    },
  });
  assert.deepEqual(publishedEvents, [
    {
      payload: {
        type: "installation_updated",
        installation: {
          id: 55,
          notes: "updated",
          installation_time_seconds: 180,
          site_lat: null,
          site_lng: null,
          site_radius_m: null,
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
  const publicTrackingRefreshes = [];
  const { handleInstallationIncidentsRoute } = createIncidentsRouteHandlers({
    ...createIncidentRouteDeps(),
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
    async syncPublicTrackingSnapshotForInstallation(_env, payload) {
      publicTrackingRefreshes.push(payload);
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
  assert.deepEqual(publicTrackingRefreshes, [
    {
      tenantId: "tenant-q",
      installationId: 45,
    },
  ]);
});

test("installation incidents handler returns runtime timing fields on GET", async () => {
  const { handleInstallationIncidentsRoute } = createIncidentsRouteHandlers(createIncidentRouteDeps({
    jsonResponse,
    parsePositiveInt(value) {
      return Number(value);
    },
  }));

  const db = {
    prepare(sql) {
      if (sql.includes("FROM incidents") && sql.includes("WHERE installation_id = ?")) {
        return {
          bind(...args) {
            assert.deepEqual(args, [45, "tenant-q"]);
            return this;
          },
          async all() {
            return {
              results: [
                {
                  id: 901,
                  installation_id: 45,
                  asset_id: 77,
                  reporter_username: "ops-admin",
                  note: "Incidencia en curso",
                  time_adjustment_seconds: 300,
                  estimated_duration_seconds: 300,
                  severity: "high",
                  source: "web",
                  created_at: "2026-12-01T09:50:00.000Z",
                  incident_status: "paused",
                  status_updated_at: "2026-12-01T10:05:00.000Z",
                  status_updated_by: "ops-admin",
                  resolved_at: null,
                  resolved_by: null,
                  resolution_note: null,
                  checklist_json: "[]",
                  evidence_note: null,
                  work_started_at: null,
                  work_ended_at: "2026-12-01T10:05:00.000Z",
                  actual_duration_seconds: 915,
                },
              ],
            };
          },
        };
      }

      if (sql.includes("FROM incident_photos")) {
        return {
          bind(...args) {
            assert.deepEqual(args, [45, "tenant-q"]);
            return this;
          },
          async all() {
            return { results: [] };
          },
        };
      }

      throw new Error(`Unexpected SQL: ${sql}`);
    },
  };

  const response = await handleInstallationIncidentsRoute(
    new Request("https://worker.example/installations/45/incidents", { method: "GET" }),
    { DB: db },
    {},
    ["installations", "45", "incidents"],
    false,
    null,
    "tenant-q",
    "tenant-q",
  );
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.success, true);
  assert.equal(body.incidents.length, 1);
  assert.equal(body.incidents[0].estimated_duration_seconds, 300);
  assert.equal(body.incidents[0].work_started_at, null);
  assert.equal(body.incidents[0].work_ended_at, "2026-12-01T10:05:00.000Z");
  assert.equal(body.incidents[0].actual_duration_seconds, 915);
});

test("installation incidents handler reindexes orphaned R2 photos when D1 metadata is missing", async () => {
  let photoQueryCount = 0;
  const recoveredPhotos = [
    {
      id: 321,
      incident_id: 19,
      r2_key: "incidents/34/19/20260317200350107_inst-34-inc-19-cliente-equipo-arsl1-003.jpg",
      file_name: "20260317200350107_inst-34-inc-19-cliente-equipo-arsl1-003.jpg",
      content_type: "image/jpeg",
      size_bytes: 92880,
      sha256: null,
      created_at: "2026-03-17T20:03:51.000Z",
    },
  ];
  const { handleInstallationIncidentsRoute } = createIncidentsRouteHandlers(createIncidentRouteDeps({
    parsePositiveInt(value) {
      return Number(value);
    },
    async recoverIncidentPhotosFromStorageForTenant(_env, incidents, tenantId) {
      assert.equal(tenantId, "tenant-q");
      assert.equal(incidents.length, 1);
      assert.equal(incidents[0].id, 19);
      return 1;
    },
  }));

  const db = {
    prepare(sql) {
      if (sql.includes("FROM incidents") && sql.includes("WHERE installation_id = ?")) {
        return {
          bind(...args) {
            assert.deepEqual(args, [34, "tenant-q"]);
            return this;
          },
          async all() {
            return {
              results: [
                {
                  id: 19,
                  installation_id: 34,
                  asset_id: null,
                  reporter_username: "ops-admin",
                  note: "Incidencia con fotos huerfanas",
                  time_adjustment_seconds: 0,
                  estimated_duration_seconds: null,
                  severity: "medium",
                  source: "web",
                  created_at: "2026-03-17T20:02:02.419Z",
                  incident_status: "resolved",
                  status_updated_at: "2026-03-17T20:10:00.000Z",
                  status_updated_by: "ops-admin",
                  resolved_at: "2026-03-17T20:10:00.000Z",
                  resolved_by: "ops-admin",
                  resolution_note: "ok",
                  checklist_json: "[]",
                  evidence_note: null,
                  work_started_at: null,
                  work_ended_at: null,
                  actual_duration_seconds: 0,
                },
              ],
            };
          },
        };
      }

      if (sql.includes("FROM incident_photos")) {
        return {
          bind(...args) {
            assert.deepEqual(args, [34, "tenant-q"]);
            return this;
          },
          async all() {
            photoQueryCount += 1;
            return {
              results: photoQueryCount === 1 ? [] : recoveredPhotos,
            };
          },
        };
      }

      throw new Error(`Unexpected SQL: ${sql}`);
    },
  };

  const response = await handleInstallationIncidentsRoute(
    new Request("https://worker.example/installations/34/incidents", { method: "GET" }),
    { DB: db },
    {},
    ["installations", "34", "incidents"],
    false,
    null,
    "tenant-q",
    "tenant-q",
  );
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(photoQueryCount, 2);
  assert.equal(body.incidents[0].photos.length, 1);
  assert.equal(body.incidents[0].photos[0].id, 321);
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
  const publicTrackingRefreshes = [];
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
    async syncPublicTrackingSnapshotForInstallation(_env, payload) {
      publicTrackingRefreshes.push(payload);
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
  assert.deepEqual(publicTrackingRefreshes, [
    {
      tenantId: "tenant-z",
      installationId: 45,
    },
  ]);
});

test("incident status handler pauses incidents and preserves accumulated runtime", async () => {
  const realtimeEvents = [];
  const { handleIncidentStatusRoute } = createIncidentsRouteHandlers(createIncidentRouteDeps({
    async readJsonOrThrowBadRequest() {
      return {};
    },
    normalizeIncidentStatusPayload() {
      return {
        incidentStatus: "paused",
        resolutionNote: null,
      };
    },
    nowIso() {
      return "2026-12-01T10:05:30.000Z";
    },
    async loadIncidentForTenant() {
      return {
        id: 99,
        installation_id: 45,
        incident_status: "in_progress",
        status_updated_at: "2026-12-01T10:03:00.000Z",
        created_at: "2026-12-01T09:58:00.000Z",
      };
    },
    async loadIncidentTimingFieldsForTenant() {
      return {
        work_started_at: "2026-12-01T10:03:00.000Z",
        work_ended_at: null,
        actual_duration_seconds: 120,
      };
    },
    async logAuditEvent() {},
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
            "paused",
            "2026-12-01T10:05:30.000Z",
            "manager1",
            null,
            null,
            null,
            null,
            "2026-12-01T10:05:30.000Z",
            270,
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
  assert.equal(body.incident.incident_status, "paused");
  assert.equal(body.incident.actual_duration_seconds, 270);
  assert.equal(body.incident.work_started_at, null);
  assert.equal(body.incident.work_ended_at, "2026-12-01T10:05:30.000Z");
  assert.deepEqual(realtimeEvents, [
    {
      payload: {
        type: "incident_status_updated",
        incident: {
          id: 99,
          installation_id: 45,
          incident_status: "paused",
          status_updated_at: "2026-12-01T10:05:30.000Z",
          created_at: "2026-12-01T09:58:00.000Z",
          status_updated_by: "manager1",
          resolved_at: null,
          resolved_by: null,
          resolution_note: null,
          work_started_at: null,
          work_ended_at: "2026-12-01T10:05:30.000Z",
          actual_duration_seconds: 270,
          photos: [],
        },
      },
      tenantId: "tenant-z",
    },
  ]);
});

test("incident status handler returns actionable error when DB schema still rejects paused", async () => {
  const { handleIncidentStatusRoute } = createIncidentsRouteHandlers(createIncidentRouteDeps({
    async readJsonOrThrowBadRequest() {
      return {};
    },
    normalizeIncidentStatusPayload() {
      return {
        incidentStatus: "paused",
        resolutionNote: null,
      };
    },
    async loadIncidentForTenant() {
      return {
        id: 99,
        installation_id: 45,
        incident_status: "in_progress",
        status_updated_at: "2026-12-01T10:03:00.000Z",
        created_at: "2026-12-01T09:58:00.000Z",
      };
    },
    async loadIncidentTimingFieldsForTenant() {
      return {
        work_started_at: "2026-12-01T10:03:00.000Z",
        actual_duration_seconds: 120,
      };
    },
  }));

  const db = {
    prepare() {
      return {
        bind() {
          return this;
        },
        async run() {
          throw new Error("D1_ERROR: CHECK constraint failed: incident_status");
        },
      };
    },
  };

  await assert.rejects(
    () => handleIncidentStatusRoute(
      new Request("https://worker.example/installations/45/incidents/99/status", { method: "PATCH" }),
      { DB: db },
      {},
      ["installations", "45", "incidents", "99", "status"],
      true,
      { role: "admin", sub: "manager1" },
      "tenant-z",
      "tenant-z",
    ),
    (error) => {
      assert.equal(error?.status, 409);
      assert.match(error?.message || "", /migraciones pendientes|base no soporta/i);
      return true;
    },
  );
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
