import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { JSDOM } from "jsdom";

import {
  cleanupDashboardApps,
  createFetchRouter,
  createJsonResponse,
  flushDashboardTasks,
  readPublicTextAsset,
  setupDashboardApp,
} from "./helpers/dashboard.test-helpers.mjs";

test.afterEach(() => {
  cleanupDashboardApps();
});

test("public tracking page polls automatically while visible and pauses when hidden when SSE is unavailable", async () => {
  const dom = new JSDOM(
    `<!doctype html>
    <html>
      <body data-tracking-token="token-publico">
        <h1 id="publicTrackingTitle"></h1>
        <div id="publicTrackingSummary" hidden>
          <span id="publicTrackingStatusBadge"></span>
          <span id="publicTrackingTransition"></span>
          <p id="publicTrackingSummaryText"></p>
        </div>
        <p id="publicTrackingMessage"></p>
        <div id="publicTrackingMeta"></div>
        <section id="publicTrackingTimeline"></section>
        <button id="publicTrackingRefreshBtn" type="button">Actualizar</button>
      </body>
    </html>`,
    {
      url: "http://localhost:8787/track/token-publico",
      runScripts: "outside-only",
    },
  );
  const { window } = dom;
  const fetchCalls = [];
  const scheduledTimers = new Map();
  let nextTimerId = 1;

  Object.defineProperty(window.document, "hidden", {
    configurable: true,
    value: false,
  });

  window.fetch = async (input, init = {}) => {
    fetchCalls.push({
      input: String(input),
      method: String(init.method || "GET").toUpperCase(),
    });
    return {
      ok: true,
      async json() {
        return {
          success: true,
          tracking: {
            installation_id: 45,
            public_reference: "Servicio QA",
            public_status: "pendiente",
            public_status_label: "Pendiente de atencion",
            public_previous_status: "cerrado",
            public_previous_status_label: "Cerrado",
            public_transition_label: "Cerrado -> Pendiente de atencion",
            public_message: "Recibimos tu solicitud y esta pendiente de atencion.",
            last_updated_at: "2026-03-26T12:00:00.000Z",
            milestones: [],
          },
        };
      },
    };
  };
  Object.defineProperty(window, "EventSource", {
    configurable: true,
    writable: true,
    value: undefined,
  });
  window.setTimeout = (callback, delay) => {
    const timerId = nextTimerId++;
    scheduledTimers.set(timerId, { callback, delay });
    return timerId;
  };
  window.clearTimeout = (timerId) => {
    scheduledTimers.delete(timerId);
  };

  const script = new vm.Script(readPublicTextAsset("public-tracking.js"), {
    filename: "public/public-tracking.js",
  });
  script.runInContext(dom.getInternalVMContext());

  window.dispatchEvent(new window.Event("DOMContentLoaded"));
  await flushDashboardTasks();
  await flushDashboardTasks();

  const initialFetchCount = fetchCalls.length;
  assert.ok(initialFetchCount >= 1);
  assert.equal(fetchCalls[0].input, "/track/token-publico/state");
  assert.equal(window.document.getElementById("publicTrackingStatusBadge").textContent, "Pendiente de atencion");
  assert.equal(window.document.getElementById("publicTrackingTransition").textContent, "Cerrado -> Pendiente de atencion");
  assert.match(window.document.getElementById("publicTrackingMeta").textContent, /Estado actual: Pendiente de atencion/i);
  assert.match(window.document.getElementById("publicTrackingMeta").textContent, /Cambio reciente: Cerrado -> Pendiente de atencion/i);
  assert.equal(scheduledTimers.size, 1);
  assert.equal(Array.from(scheduledTimers.values())[0].delay, 15000);

  const firstTimer = Array.from(scheduledTimers.entries())[0];
  scheduledTimers.delete(firstTimer[0]);
  await firstTimer[1].callback();
  await flushDashboardTasks();
  await flushDashboardTasks();

  assert.equal(fetchCalls.length, initialFetchCount + 1);
  assert.equal(scheduledTimers.size, 1);

  Object.defineProperty(window.document, "hidden", {
    configurable: true,
    value: true,
  });
  window.document.dispatchEvent(new window.Event("visibilitychange"));
  await flushDashboardTasks();

  assert.equal(scheduledTimers.size, 0);

  Object.defineProperty(window.document, "hidden", {
    configurable: true,
    value: false,
  });
  window.document.dispatchEvent(new window.Event("visibilitychange"));
  await flushDashboardTasks();
  await flushDashboardTasks();

  assert.equal(fetchCalls.length, initialFetchCount + 2);
  assert.equal(scheduledTimers.size, 1);
  assert.equal(Array.from(scheduledTimers.values())[0].delay, 15000);

  dom.window.close();
});

test("dashboard html defers heavy chart and jsqr libraries until needed", () => {
  const html = readPublicTextAsset("dashboard.html");
  assert.equal(html.includes('/chart.umd.js'), false);
  assert.equal(html.includes('/jsqr.js'), false);
});

test("excel export builds a styled xlsx workbook with extra sheets and date-aware filename", async () => {
  const { dom } = await setupDashboardApp();
  const { window } = dom;
  const appendedSheets = [];
  const workbook = { sheets: appendedSheets };
  const writtenFiles = [];

  const encodeCol = (index) => {
    let current = index;
    let output = "";
    while (current >= 0) {
      output = String.fromCharCode((current % 26) + 65) + output;
      current = Math.floor(current / 26) - 1;
    }
    return output;
  };
  const aoaToSheet = (rows) => {
    const sheet = {};
    rows.forEach((row, rowIndex) => {
      row.forEach((value, columnIndex) => {
        sheet[`${encodeCol(columnIndex)}${rowIndex + 1}`] = { v: value };
      });
    });
    return sheet;
  };

  window.XLSX = {
    utils: {
      book_new: () => workbook,
      aoa_to_sheet: aoaToSheet,
      encode_col: encodeCol,
      book_append_sheet: (_workbook, sheet, name) => {
        appendedSheets.push({ name, sheet });
      },
    },
    writeFile: (_workbook, filename, options) => {
      writtenFiles.push({ filename, options });
    },
  };

  window.document.getElementById("startDate").value = "2026-03-01";
  window.document.getElementById("endDate").value = "2026-03-27";

  await window.exportToExcel([
    {
      id: 15,
      client_name: "Cliente QA",
      driver_brand: "Zebra",
      driver_version: "7.4.1",
      client_pc_name: "PC-01",
      technician_name: "Diego",
      gps_capture_status: "captured",
      gps_accuracy_m: 8,
      site_lat: -34.9,
      site_lng: -56.2,
      site_radius_m: 50,
      installation_time_seconds: 180,
      notes: "Instalacion completada sin novedades",
      timestamp: "2026-03-27T12:00:00.000Z",
    },
  ]);

  assert.equal(appendedSheets.length, 3);
  assert.deepEqual(appendedSheets.map((item) => item.name), ["Resumen", "Registros", "Por cliente"]);
  assert.equal(writtenFiles.length, 1);
  assert.equal(writtenFiles[0].filename, "registros_2026-03-01_a_2026-03-27.xlsx");
  assert.equal(writtenFiles[0].options.bookType, "xlsx");
  assert.equal(writtenFiles[0].options.cellStyles, true);
});

function buildWebSessionPayload({ username = "superadmin", role = "admin", tenantId = "default" } = {}) {
  return {
    success: true,
    authenticated: true,
    access_token: "token-dashboard-test",
    token_type: "Bearer",
    expires_in: 3600,
    expires_at: "2026-03-18T12:00:00.000Z",
    user: {
      id: 1,
      username,
      role,
      tenant_id: tenantId,
      is_active: true,
    },
  };
}

async function loginThroughForm(dom, credentials = { username: "superadmin", password: "StrongPass#2026" }) {
  const { document, Event } = dom.window;
  document.getElementById("loginUsername").value = credentials.username;
  document.getElementById("loginPassword").value = credentials.password;
  document.getElementById("loginForm").dispatchEvent(
    new Event("submit", { bubbles: true, cancelable: true }),
  );
  await flushDashboardTasks();
  await flushDashboardTasks();
}

function installGeolocationMock(window, implementation) {
  Object.defineProperty(window.navigator, "geolocation", {
    configurable: true,
    value: {
      getCurrentPosition: implementation,
    },
  });
}

test("dashboard bootstrap shows login and masks protected panels without session", async () => {
  const { dom } = await setupDashboardApp();
  const { window } = dom;
  const { document } = window;

  assert.ok(document.getElementById("loginModal").classList.contains("active"));
  assert.match(document.getElementById("recentInstallations").textContent, /Inicia sesi/i);
});

test("dashboard login flow authenticates and renders user context from live public assets", async () => {
  const router = createFetchRouter([
    {
      method: "POST",
      match: "/web/auth/login",
      resolver: async ({ request }) => {
        const body = JSON.parse(await request.text());
        assert.equal(body.username, "ops-admin");
        assert.equal(body.password, "StrongPass#2026");
        return createJsonResponse(
          buildWebSessionPayload({
            username: "ops-admin",
            role: "admin",
          }),
        );
      },
    },
  ]);

  const { dom } = await setupDashboardApp({ fetchImpl: router.fetch });
  const { window } = dom;
  const { document } = dom.window;

  await loginThroughForm(dom, {
    username: "ops-admin",
    password: "StrongPass#2026",
  });

  assert.equal(document.getElementById("username").textContent, "ops-admin");
  assert.equal(document.getElementById("userRole").textContent, "admin");
  assert.ok(!document.getElementById("loginModal").classList.contains("active"));
  assert.ok(router.calls.some((call) => call.pathname === "/web/statistics"));
  assert.ok(router.calls.some((call) => call.pathname === "/web/statistics/trend"));
  assert.ok(router.calls.some((call) => call.pathname === "/web/installations"));
  assert.doesNotMatch(document.getElementById("recentInstallations").textContent, /Inicia sesi/i);
});

test("dashboard overview renders gps observability metrics from statistics", async () => {
  const router = createFetchRouter([
    {
      method: "POST",
      match: "/web/auth/login",
      resolver: async () => createJsonResponse(buildWebSessionPayload({ username: "ops-admin", role: "admin" })),
    },
    {
      method: "GET",
      match: "/web/statistics",
      resolver: async () => createJsonResponse({
        total_installations: 5,
        successful_installations: 4,
        failed_installations: 1,
        unique_clients: 3,
        by_brand: { Zebra: 3, Magicard: 2 },
        gps_observability: {
          installations: {
            attempted_count: 4,
            captured_count: 3,
            failure_count: 1,
            denied_count: 1,
            timeout_count: 0,
            capture_success_rate: 75,
            average_accuracy_m: 11,
            p95_accuracy_m: 18,
          },
          incidents: {
            attempted_count: 2,
            captured_count: 1,
            failure_count: 1,
            denied_count: 0,
            timeout_count: 1,
            capture_success_rate: 50,
            average_accuracy_m: 14,
            p95_accuracy_m: 14,
          },
          warnings: {
            total_outside_count: 3,
            incident_outside_count: 2,
            conformity_outside_count: 1,
          },
          overrides: {
            total_override_count: 2,
            incident_geofence_count: 1,
            conformity_geofence_count: 0,
            conformity_gps_count: 1,
          },
        },
      }),
    },
  ]);

  const { dom } = await setupDashboardApp({ fetchImpl: router.fetch });
  const { window } = dom;
  const { document } = dom.window;

  await loginThroughForm(dom, {
    username: "ops-admin",
    password: "StrongPass#2026",
  });

  assert.equal(document.getElementById("gpsOpsCapturedValue").textContent, "4");
  assert.match(document.getElementById("gpsOpsCapturedMeta").textContent, /4\/6 capturas/i);
  assert.equal(document.getElementById("gpsOpsFailuresValue").textContent, "2");
  assert.equal(document.getElementById("gpsOpsOutsideMeta"), null);
  assert.match(document.getElementById("gpsOpsOverridesMeta").textContent, /Conformidades 1/);
  assert.match(document.getElementById("gpsOpsInstallationsMeta").textContent, /Registros: 4 intentos, 75% util, prom. 11 m, p95 18 m\./);
});

test("dashboard overview surfaces asset loan alerts in attention panel", async () => {
  const router = createFetchRouter([
    {
      method: "POST",
      match: "/web/auth/login",
      resolver: async () => createJsonResponse(buildWebSessionPayload({ username: "ops-admin", role: "admin" })),
    },
    {
      method: "GET",
      match: "/web/statistics",
      resolver: async () => createJsonResponse({
        total_installations: 5,
        successful_installations: 4,
        failed_installations: 1,
        unique_clients: 3,
        by_brand: { Zebra: 3, Magicard: 2 },
        incident_critical_active_count: 1,
        incident_in_progress_count: 2,
        incident_outside_sla_count: 1,
        loan_due_soon_count: 2,
        loan_overdue_count: 1,
        gps_observability: {
          installations: {},
          incidents: {},
          warnings: {},
          overrides: {},
        },
      }),
    },
  ]);

  const { dom } = await setupDashboardApp({ fetchImpl: router.fetch });
  const { window } = dom;
  const { document } = dom.window;

  await loginThroughForm(dom, {
    username: "ops-admin",
    password: "StrongPass#2026",
  });

  assert.match(document.getElementById("attentionList").textContent, /Prestamos vencidos/i);
  assert.match(document.getElementById("attentionList").textContent, /1 equipo sigue sin devolverse/i);
  assert.match(document.getElementById("attentionList").textContent, /Prestamos proximos a vencer/i);
  assert.equal(document.getElementById("notifBadge").textContent, "5");
});

test("dashboard overview surfaces technician load in the attention panel", async () => {
  const router = createFetchRouter([
    {
      method: "POST",
      match: "/web/auth/login",
      resolver: async () => createJsonResponse(buildWebSessionPayload({ username: "ops-admin", role: "admin" })),
    },
    {
      method: "GET",
      match: "/web/technicians",
      resolver: async () =>
        createJsonResponse({
          success: true,
          technicians: [
            {
              id: 7,
              display_name: "Luis Rivera",
              employee_code: "TEC-09",
              web_user_id: 7,
              is_active: true,
              active_assignment_count: 3,
            },
            {
              id: 8,
              display_name: "Maria Campo",
              employee_code: "TEC-10",
              web_user_id: null,
              is_active: true,
              active_assignment_count: 1,
            },
          ],
        }),
    },
  ]);

  const { dom } = await setupDashboardApp({ fetchImpl: router.fetch });
  const { document } = dom.window;

  await loginThroughForm(dom, {
    username: "ops-admin",
    password: "StrongPass#2026",
  });
  await flushDashboardTasks();
  await flushDashboardTasks();

  const attentionText = document.getElementById("attentionList").textContent || "";
  assert.match(attentionText, /Luis Rivera/i);
  assert.match(attentionText, /3 asignaciones activas/i);
});

test("super admin can open the tenants section and review tenant detail", async () => {
  const router = createFetchRouter([
    {
      method: "POST",
      match: "/web/auth/login",
      resolver: async () =>
        createJsonResponse(buildWebSessionPayload({ username: "root", role: "super_admin" })),
    },
    {
      method: "GET",
      match: "/web/tenants",
      resolver: async () =>
        createJsonResponse({
          success: true,
          tenants: [
            {
              id: "tenant-a",
              name: "Acme Uruguay",
              slug: "acme-uy",
              status: "active",
              plan_code: "growth",
              metrics: {
                users_count: 4,
                technicians_count: 2,
                installations_count: 11,
                active_incidents_count: 3,
              },
              admin_usernames: ["ana", "bruno"],
            },
          ],
        }),
    },
    {
      method: "GET",
      match: "/web/tenants/tenant-a",
      resolver: async () =>
        createJsonResponse({
          success: true,
          tenant: {
            id: "tenant-a",
            name: "Acme Uruguay",
            slug: "acme-uy",
            status: "active",
            plan_code: "growth",
            metrics: {
              users_count: 4,
              technicians_count: 2,
              installations_count: 11,
              active_incidents_count: 3,
            },
            admin_usernames: ["ana", "bruno"],
          },
          admins: [
            {
              id: 7,
              username: "ana",
              role: "admin",
              is_active: true,
              last_login_at: "2026-03-28T17:00:00.000Z",
              tenant_id: "tenant-a",
            },
          ],
          latest_usage: {
            usage_month: "2026-03",
            users_count: 4,
            storage_bytes: 2048,
            incidents_count: 27,
            recorded_at: "2026-03-28T18:00:00.000Z",
          },
        }),
    },
  ]);

  const { dom } = await setupDashboardApp({ fetchImpl: router.fetch });
  const { window } = dom;
  const { document } = dom.window;

  await loginThroughForm(dom, {
    username: "root",
    password: "StrongPass#2026",
  });

  await window.loadTenantsSection({ silent: false });
  await window.selectTenantDetail("tenant-a");
  await flushDashboardTasks();
  await flushDashboardTasks();

  const tenantsText = document.getElementById("tenantsList").textContent || "";
  const detailText = document.getElementById("tenantDetail").textContent || "";
  assert.match(tenantsText, /Acme Uruguay/i);
  assert.match(tenantsText, /ana, bruno/i);
  assert.match(detailText, /growth/i);
  assert.match(detailText, /27 incidencias/i);
});

test("super admin can create and update tenant web users from tenant detail", async () => {
  const tenantUsers = [
    {
      id: 7,
      username: "ana",
      role: "admin",
      is_active: true,
      created_at: "2026-03-28T12:00:00.000Z",
      updated_at: "2026-03-28T12:00:00.000Z",
      last_login_at: "2026-03-28T17:00:00.000Z",
      tenant_id: "tenant-a",
    },
  ];

  const buildTenantPayload = () => ({
    success: true,
    tenant: {
      id: "tenant-a",
      name: "Acme Uruguay",
      slug: "acme-uy",
      status: "active",
      plan_code: "growth",
      metrics: {
        users_count: tenantUsers.length,
        technicians_count: 2,
        installations_count: 11,
        active_incidents_count: 3,
      },
      admin_usernames: tenantUsers.filter((user) => user.role === "admin").map((user) => user.username),
    },
    admins: tenantUsers.filter((user) => user.role === "admin"),
    latest_usage: {
      usage_month: "2026-03",
      users_count: tenantUsers.length,
      storage_bytes: 2048,
      incidents_count: 27,
      recorded_at: "2026-03-28T18:00:00.000Z",
    },
  });

  const router = createFetchRouter([
    {
      method: "POST",
      match: "/web/auth/login",
      resolver: async () =>
        createJsonResponse(buildWebSessionPayload({ username: "root", role: "super_admin" })),
    },
    {
      method: "GET",
      match: "/web/tenants",
      resolver: async () =>
        createJsonResponse({
          success: true,
          tenants: [
            {
              id: "tenant-a",
              name: "Acme Uruguay",
              slug: "acme-uy",
              status: "active",
              plan_code: "growth",
              metrics: {
                users_count: tenantUsers.length,
                technicians_count: 2,
                installations_count: 11,
                active_incidents_count: 3,
              },
              admin_usernames: tenantUsers.filter((user) => user.role === "admin").map((user) => user.username),
            },
          ],
        }),
    },
    {
      method: "GET",
      match: "/web/tenants/tenant-a",
      resolver: async () => createJsonResponse(buildTenantPayload()),
    },
    {
      method: "GET",
      match: "/web/auth/users",
      resolver: async ({ request }) => {
        const url = new URL(request.url);
        assert.equal(url.searchParams.get("tenant_id"), "tenant-a");
        return createJsonResponse({
          success: true,
          users: tenantUsers.map((user) => ({ ...user })),
          pagination: {
            limit: 500,
            has_more: false,
            next_cursor: null,
          },
        });
      },
    },
    {
      method: "POST",
      match: "/web/auth/users",
      resolver: async ({ request }) => {
        const body = await request.clone().json();
        assert.equal(body.tenant_id, "tenant-a");
        assert.equal(body.username, "bruno");
        assert.equal(body.role, "admin");
        tenantUsers.push({
          id: 9,
          username: body.username,
          role: body.role,
          is_active: body.is_active !== false,
          created_at: "2026-03-28T19:00:00.000Z",
          updated_at: "2026-03-28T19:00:00.000Z",
          last_login_at: null,
          tenant_id: body.tenant_id,
        });
        return createJsonResponse({
          success: true,
          user: {
            id: 9,
            username: body.username,
            role: body.role,
            tenant_id: body.tenant_id,
          },
        }, { status: 201 });
      },
    },
    {
      method: "PATCH",
      match: "/web/auth/users/9",
      resolver: async ({ request }) => {
        const body = await request.clone().json();
        assert.equal(body.role, "viewer");
        assert.equal(body.is_active, false);
        tenantUsers[1] = {
          ...tenantUsers[1],
          role: body.role,
          is_active: body.is_active,
          updated_at: "2026-03-28T20:00:00.000Z",
        };
        return createJsonResponse({
          success: true,
          user: {
            id: 9,
            username: tenantUsers[1].username,
            role: tenantUsers[1].role,
            is_active: tenantUsers[1].is_active,
            tenant_id: tenantUsers[1].tenant_id,
          },
        });
      },
    },
  ]);

  const { dom } = await setupDashboardApp({ fetchImpl: router.fetch });
  const { window } = dom;
  const { document, Event } = window;

  await loginThroughForm(dom, {
    username: "root",
    password: "StrongPass#2026",
  });

  await window.loadTenantsSection({ silent: false });
  await window.selectTenantDetail("tenant-a");
  await flushDashboardTasks();
  await flushDashboardTasks();

  assert.match(document.getElementById("tenantDetail").textContent || "", /Usuarios web/i);
  assert.match(document.getElementById("tenantDetail").textContent || "", /ana/i);

  const createBtn = Array.from(document.querySelectorAll("#tenantDetail button"))
    .find((button) => /Crear usuario/i.test(button.textContent || ""));
  assert.ok(createBtn);
  createBtn.click();
  await flushDashboardTasks();

  document.getElementById("actionTenantUserUsername").value = "bruno";
  document.getElementById("actionTenantUserPassword").value = "StrongPass#2026";
  document.getElementById("actionTenantUserRole").value = "admin";
  document.getElementById("actionModalForm").dispatchEvent(
    new Event("submit", { bubbles: true, cancelable: true }),
  );
  await flushDashboardTasks();
  await flushDashboardTasks();
  await flushDashboardTasks();

  assert.match(document.getElementById("tenantDetail").textContent || "", /bruno/i);

  const userCards = Array.from(document.querySelectorAll("#tenantDetail .settings-assignment-card"));
  const brunoCard = userCards.find((card) =>
    /bruno/i.test(card.textContent || "") && card.querySelector("button"));
  assert.ok(brunoCard);

  const editBtn = Array.from(brunoCard.querySelectorAll("button"))
    .find((button) => /Editar acceso/i.test(button.textContent || ""));
  assert.ok(editBtn);
  editBtn.click();
  await flushDashboardTasks();

  document.getElementById("actionTenantUserRole").value = "viewer";
  document.getElementById("actionTenantUserIsActive").value = "0";
  document.getElementById("actionModalForm").dispatchEvent(
    new Event("submit", { bubbles: true, cancelable: true }),
  );
  await flushDashboardTasks();
  await flushDashboardTasks();
  await flushDashboardTasks();

  const detailText = document.getElementById("tenantDetail").textContent || "";
  assert.match(detailText, /bruno/i);
  assert.match(detailText, /viewer/i);
  assert.match(detailText, /inactivo/i);
});

test("super admin outside default tenant cannot access tenant admin center", async () => {
  const router = createFetchRouter([
    {
      method: "POST",
      match: "/web/auth/login",
      resolver: async () =>
        createJsonResponse(buildWebSessionPayload({
          username: "tenant-root",
          role: "super_admin",
          tenantId: "tenant-a",
        })),
    },
  ]);

  const { dom } = await setupDashboardApp({ fetchImpl: router.fetch });
  const { document } = dom.window;

  await loginThroughForm(dom, {
    username: "tenant-root",
    password: "StrongPass#2026",
  });
  await flushDashboardTasks();
  await flushDashboardTasks();
  await dom.window.loadTenantsSection({ silent: true });
  await flushDashboardTasks();

  assert.equal(document.getElementById("tenantsSection").hidden, true);
  assert.equal(document.getElementById("navTenantsLink").closest("li").hidden, true);
});

test("super admin can delete tenant users and tenants with confirmation", async () => {
  const tenantUsers = [
    {
      id: 7,
      username: "ana",
      role: "admin",
      is_active: true,
      created_at: "2026-03-28T12:00:00.000Z",
      updated_at: "2026-03-28T12:00:00.000Z",
      last_login_at: "2026-03-28T17:00:00.000Z",
      tenant_id: "tenant-a",
    },
  ];
  let tenantDeleted = false;

  const router = createFetchRouter([
    {
      method: "POST",
      match: "/web/auth/login",
      resolver: async () =>
        createJsonResponse(buildWebSessionPayload({ username: "root", role: "platform_owner" })),
    },
    {
      method: "GET",
      match: "/web/tenants",
      resolver: async () =>
        createJsonResponse({
          success: true,
          tenants: tenantDeleted
            ? []
            : [{
                id: "tenant-a",
                name: "Acme Uruguay",
                slug: "acme-uy",
                status: "active",
                plan_code: "growth",
                metrics: {
                  users_count: tenantUsers.length,
                  technicians_count: 0,
                  installations_count: 0,
                  active_incidents_count: 0,
                },
                admin_usernames: tenantUsers.map((user) => user.username),
              }],
        }),
    },
    {
      method: "GET",
      match: "/web/tenants/tenant-a",
      resolver: async () =>
        createJsonResponse({
          success: true,
          tenant: {
            id: "tenant-a",
            name: "Acme Uruguay",
            slug: "acme-uy",
            status: "active",
            plan_code: "growth",
            metrics: {
              users_count: tenantUsers.length,
              technicians_count: 0,
              installations_count: 0,
              active_incidents_count: 0,
            },
            admin_usernames: tenantUsers.map((user) => user.username),
          },
          admins: tenantUsers,
          latest_usage: null,
        }),
    },
    {
      method: "GET",
      match: "/web/auth/users",
      resolver: async () =>
        createJsonResponse({
          success: true,
          users: tenantUsers.map((user) => ({ ...user })),
          pagination: {
            limit: 500,
            has_more: false,
            next_cursor: null,
          },
        }),
    },
    {
      method: "GET",
      match: "/web/auth/users/7/delete-impact",
      resolver: async () =>
        createJsonResponse({
          success: true,
          user: { ...tenantUsers[0] },
          impact: {
            sessions_invalidated: 1,
            technician_links_to_clear: 0,
            device_tokens_to_revoke: 2,
          },
        }),
    },
    {
      method: "DELETE",
      match: "/web/auth/users/7",
      resolver: async () => {
        tenantUsers.splice(0, tenantUsers.length);
        return createJsonResponse({ success: true, deleted: true, user_id: 7 });
      },
    },
    {
      method: "GET",
      match: "/web/tenants/tenant-a/delete-impact",
      resolver: async () =>
        createJsonResponse({
          success: true,
          tenant: {
            id: "tenant-a",
            name: "Acme Uruguay",
          },
          impact: {
            deleted_tables: {
              web_users: 0,
              technicians: 0,
              installations: 0,
              incidents: 0,
              audit_logs: 2,
            },
            total_rows: 2,
          },
        }),
    },
    {
      method: "DELETE",
      match: "/web/tenants/tenant-a",
      resolver: async () => {
        tenantDeleted = true;
        return createJsonResponse({ success: true, deleted: true, tenant_id: "tenant-a" });
      },
    },
    {
      method: "GET",
      match: "/web/technicians",
      resolver: async () => createJsonResponse({ success: true, technicians: [] }),
    },
  ]);

  const { dom } = await setupDashboardApp({ fetchImpl: router.fetch });
  const { window } = dom;
  const { document, Event } = window;

  await loginThroughForm(dom, {
    username: "root",
    password: "StrongPass#2026",
  });
  await window.loadTenantsSection({ silent: false });
  await window.selectTenantDetail("tenant-a");
  await flushDashboardTasks();
  await flushDashboardTasks();

  const userDeleteBtn = Array.from(document.querySelectorAll("#tenantDetail button"))
    .find((button) => /Eliminar/i.test(button.textContent || ""));
  assert.ok(userDeleteBtn);
  userDeleteBtn.click();
  await flushDashboardTasks();
  assert.match(document.getElementById("actionModalFields").textContent || "", /Tokens de dispositivo a revocar/i);
  assert.match(document.getElementById("actionModalFields").textContent || "", /2/);
  document.getElementById("actionModalConfirmCheckbox").checked = true;
  document.getElementById("actionModalForm").dispatchEvent(
    new Event("submit", { bubbles: true, cancelable: true }),
  );
  await flushDashboardTasks();
  await flushDashboardTasks();

  assert.doesNotMatch(document.getElementById("tenantDetail").textContent || "", /ana/i);

  document.getElementById("tenantsDeleteBtn").click();
  await flushDashboardTasks();
  assert.match(document.getElementById("actionModalFields").textContent || "", /Total estimado de filas/i);
  assert.match(document.getElementById("actionModalFields").textContent || "", /2/);
  document.getElementById("actionModalConfirmCheckbox").checked = true;
  document.getElementById("actionModalForm").dispatchEvent(
    new Event("submit", { bubbles: true, cancelable: true }),
  );
  await flushDashboardTasks();
  await flushDashboardTasks();

  assert.match(document.getElementById("tenantsList").textContent || "", /no hay tenants/i);
});

test("technician editor links web users by selector instead of manual id entry", async () => {
  const router = createFetchRouter([
    {
      method: "POST",
      match: "/web/auth/login",
      resolver: async () => createJsonResponse(buildWebSessionPayload({ username: "ops-admin", role: "admin" })),
    },
    {
      method: "GET",
      match: "/web/technicians",
      resolver: async () =>
        createJsonResponse({
          success: true,
          technicians: [
            {
              id: 7,
              display_name: "Luis Rivera",
              employee_code: "TEC-09",
              web_user_id: 7,
              is_active: true,
              active_assignment_count: 1,
            },
            {
              id: 8,
              display_name: "Maria Campo",
              employee_code: "TEC-10",
              web_user_id: null,
              is_active: true,
              active_assignment_count: 0,
            },
          ],
        }),
    },
    {
      method: "GET",
      match: "/web/auth/users",
      resolver: async () =>
        createJsonResponse({
          success: true,
          users: [
            { id: 7, username: "lrivera", role: "tecnico", tenant_id: "default", is_active: true },
            { id: 9, username: "mcampo", role: "tecnico", tenant_id: "default", is_active: true },
            { id: 10, username: "supervisor-1", role: "supervisor", tenant_id: "default", is_active: false },
          ],
          pagination: {
            limit: 500,
            has_more: false,
            next_cursor: null,
          },
        }),
    },
    {
      method: "PATCH",
      match: "/web/technicians/8",
      resolver: async ({ request }) => {
        const body = await request.clone().json();
        assert.equal(body.web_user_id, 9);
        return createJsonResponse({
          success: true,
          technician: {
            id: 8,
            display_name: "Maria Campo",
            employee_code: "TEC-10",
            web_user_id: 9,
            is_active: true,
            active_assignment_count: 0,
          },
        });
      },
    },
  ]);

  const { dom } = await setupDashboardApp({ fetchImpl: router.fetch });
  const { document } = dom.window;

  await loginThroughForm(dom, {
    username: "ops-admin",
    password: "StrongPass#2026",
  });
  await flushDashboardTasks();
  await flushDashboardTasks();

  const settingsText = document.getElementById("settingsTechniciansList").textContent || "";
  assert.match(settingsText, /lrivera/i);
  assert.match(settingsText, /tecnico/i);

  const cards = Array.from(document.querySelectorAll(".settings-technician-card"));
  const mariaCard = cards.find((card) => /Maria Campo/i.test(card.textContent || ""));
  assert.ok(mariaCard);

  const editBtn = Array.from(mariaCard.querySelectorAll("button")).find((button) => /Editar/i.test(button.textContent || ""));
  assert.ok(editBtn);
  editBtn.click();
  await flushDashboardTasks();

  const webUserSelect = document.getElementById("actionTechnicianWebUserId");
  assert.ok(webUserSelect);
  const optionLabels = Array.from(webUserSelect.options).map((option) => option.textContent || "");
  assert.match(optionLabels.join(" | "), /mcampo/i);
  assert.doesNotMatch(optionLabels.join(" | "), /lrivera/i);

  webUserSelect.value = "9";
  document.getElementById("actionTechnicianDisplayName").value = "Maria Campo";
  document.getElementById("actionModalSubmitBtn").click();
  await flushDashboardTasks();
  await flushDashboardTasks();

  const patchCalls = router.calls.filter((call) => call.pathname === "/web/technicians/8" && call.method === "PATCH");
  assert.equal(patchCalls.length, 1);
});

test("dashboard logout returns UI to protected-empty state and reopens login", async () => {
  const router = createFetchRouter([
    {
      method: "POST",
      match: "/web/auth/login",
      resolver: async () =>
        createJsonResponse(
          buildWebSessionPayload({
            username: "viewer-ops",
            role: "viewer",
          }),
        ),
    },
  ]);

  const { dom } = await setupDashboardApp({ fetchImpl: router.fetch });
  const { document } = dom.window;

  await loginThroughForm(dom, {
    username: "viewer-ops",
    password: "StrongPass#2026",
  });

  const logoutCallsBefore = router.calls.filter((call) => call.pathname === "/web/auth/logout").length;
  document.getElementById("logoutBtn").click();
  await flushDashboardTasks();

  const logoutCallsAfter = router.calls.filter((call) => call.pathname === "/web/auth/logout").length;
  assert.equal(logoutCallsAfter, logoutCallsBefore + 1);
  assert.ok(document.getElementById("loginModal").classList.contains("active"));
  assert.match(document.getElementById("recentInstallations").textContent, /Inicia sesi/i);
});

test("navigating to drivers loads data and updates the active section using served assets", async () => {
  const router = createFetchRouter([
    {
      method: "POST",
      match: "/web/auth/login",
      resolver: async () =>
        createJsonResponse(
          buildWebSessionPayload({
            username: "driver-admin",
            role: "admin",
          }),
        ),
    },
    {
      method: "GET",
      match: "/web/drivers",
      resolver: async () =>
        createJsonResponse({
          success: true,
          total: 1,
          items: [
            {
              tenant_id: "default",
              brand: "Zebra",
              version: "7.4.1",
              description: "Driver QA",
              key: "drivers/default/zebra/7.4.1/zebra.exe",
              filename: "zebra.exe",
              uploaded: "2026-03-18T10:00:00.000Z",
              last_modified: "2026-03-18 10:00:00",
              size_bytes: 1024,
              size_mb: 0,
              download_url: "/web/drivers/download?key=drivers%2Fdefault%2Fzebra%2F7.4.1%2Fzebra.exe",
            },
          ],
        }),
    },
  ]);

  const { dom } = await setupDashboardApp({ fetchImpl: router.fetch });
  const { document, MouseEvent } = dom.window;

  await loginThroughForm(dom, {
    username: "driver-admin",
    password: "StrongPass#2026",
  });

  document
    .querySelector(".nav-links a[data-section=\"drivers\"]")
    .dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  await flushDashboardTasks(220);
  await flushDashboardTasks();

  assert.ok(document.getElementById("driversSection").classList.contains("active"));
  assert.match(document.getElementById("pageTitle").textContent, /Drivers/);
  assert.match(document.getElementById("driversResultsCount").textContent, /1/);
  assert.match(document.getElementById("driversTable").textContent, /Zebra/);
  assert.ok(router.calls.some((call) => call.pathname === "/web/drivers"));
});

test("reopening a resolved incident into in-progress requires confirmation and refreshes asset detail", async () => {
  const statusPayloads = [];
  const router = createFetchRouter([
    {
      method: "POST",
      match: "/web/auth/login",
      resolver: async () =>
        createJsonResponse(
          buildWebSessionPayload({
            username: "ops-admin",
            role: "admin",
          }),
        ),
    },
    {
      method: "PATCH",
      match: "/web/incidents/19/status",
      resolver: async ({ request }) => {
        statusPayloads.push(JSON.parse(await request.text()));
        return createJsonResponse({
          success: true,
          incident: {
            id: 19,
            incident_status: "open",
          },
        });
      },
    },
    {
      method: "GET",
      match: ({ url }) => url.pathname === "/web/assets/77/incidents",
      resolver: async () =>
        createJsonResponse({
          asset: {
            id: 77,
            external_code: "ARSL1-003",
            brand: "Entrust",
            model: "Sigma SL1",
            serial_number: "SN-77",
            client_name: "Cliente QA",
            status: "active",
            updated_at: "2026-03-18T10:10:00.000Z",
          },
          active_link: null,
          links: [],
          incidents: [],
        }),
    },
  ]);

  const { dom } = await setupDashboardApp({ fetchImpl: router.fetch });
  const { window } = dom;
  const { document } = window;

  await loginThroughForm(dom, {
    username: "ops-admin",
    password: "StrongPass#2026",
  });

  await window.updateIncidentStatusFromWeb(
    {
      id: 19,
      incident_status: "resolved",
      installation_id: 34,
      created_at: "2026-03-18T10:00:00.000Z",
      note: "Rodillo cambiado",
    },
    "in_progress",
    { installationId: 34, assetId: 77 },
  );
  await flushDashboardTasks();

  assert.equal(statusPayloads.length, 0);
  assert.ok(document.getElementById("actionModal").classList.contains("active"));
  assert.ok(document.getElementById("actionModalConfirmCheckbox"));

  document.getElementById("actionModalSubmitBtn").click();
  await flushDashboardTasks();

  assert.equal(statusPayloads.length, 0);
  assert.match(document.getElementById("actionModalError").textContent, /reapertura/i);

  document.getElementById("actionModalConfirmCheckbox").checked = true;
  document.getElementById("actionModalSubmitBtn").click();
  await flushDashboardTasks();
  await flushDashboardTasks();

  assert.equal(statusPayloads.length, 1);
  assert.equal(statusPayloads[0].incident_status, "in_progress");
  assert.ok(router.calls.some((call) => call.pathname === "/web/assets/77/incidents"));
  assert.equal(router.calls.some((call) => call.pathname === "/web/installations/34/incidents"), false);
  assert.equal(document.getElementById("actionModal").classList.contains("active"), false);
});

test("asset detail can register and return a loan from the shared action modal", async () => {
  const createdLoanPayloads = [];
  const returnedLoanPayloads = [];
  let activeLoan = null;
  const assetDetailPayload = {
    asset: {
      id: 77,
      external_code: "EQ-77",
      brand: "Entrust",
      model: "Sigma",
      serial_number: "SN-77",
      client_name: "Cliente Base",
      status: "active",
      updated_at: "2026-03-18T10:10:00.000Z",
    },
    active_link: null,
    links: [],
    incidents: [],
  };

  const router = createFetchRouter([
    {
      method: "POST",
      match: "/web/auth/login",
      resolver: async () =>
        createJsonResponse(
          buildWebSessionPayload({
            username: "ops-admin",
            role: "admin",
          }),
        ),
    },
    {
      method: "GET",
      match: "/web/assets",
      resolver: async () =>
        createJsonResponse({
          success: true,
          items: [assetDetailPayload.asset],
        }),
    },
    {
      method: "GET",
      match: "/web/assets/77/incidents",
      resolver: async () => createJsonResponse(assetDetailPayload),
    },
    {
      method: "GET",
      match: "/web/assets/77/loans",
      resolver: async () =>
        createJsonResponse({
          success: true,
          items: activeLoan ? [activeLoan] : [],
          active_count: activeLoan ? 1 : 0,
          overdue_count: activeLoan?.status === "overdue" ? 1 : 0,
        }),
    },
    {
      method: "POST",
      match: "/web/assets/77/loans",
      resolver: async ({ request }) => {
        const body = JSON.parse(await request.text());
        createdLoanPayloads.push(body);
        activeLoan = {
          id: 501,
          asset_id: 77,
          asset_external_code: "EQ-77",
          original_client: "Cliente Base",
          borrowing_client: body.borrowing_client,
          loaned_at: "2026-03-18T11:00:00.000Z",
          expected_return_at: body.expected_return_at,
          returned_at: null,
          loaned_by_username: "ops-admin",
          returned_by_username: null,
          notes: body.notes || "",
          return_notes: "",
          status: "active",
        };
        return createJsonResponse({
          success: true,
          loan: activeLoan,
        }, { status: 201 });
      },
    },
    {
      method: "PATCH",
      match: "/web/loans/501/return",
      resolver: async ({ request }) => {
        const body = JSON.parse(await request.text());
        returnedLoanPayloads.push(body);
        activeLoan = null;
        return createJsonResponse({
          success: true,
          loan: {
            id: 501,
            asset_id: 77,
            returned_at: "2026-03-18T12:00:00.000Z",
            return_notes: body.return_notes,
            status: "returned",
          },
        });
      },
    },
  ]);

  const { dom } = await setupDashboardApp({ fetchImpl: router.fetch });
  const { window } = dom;
  const { document } = window;

  await loginThroughForm(dom, {
    username: "ops-admin",
    password: "StrongPass#2026",
  });

  await window.loadAssetDetail(77);
  await flushDashboardTasks();
  await flushDashboardTasks();

  assert.match(document.getElementById("assetDetail").textContent, /Sin prestamos activos/i);
  const createLoanButton = Array.from(document.querySelectorAll("#assetDetail button")).find(
    (button) => /Prestar equipo/i.test(button.textContent || ""),
  );
  createLoanButton.click();
  await flushDashboardTasks();

  assert.ok(document.getElementById("actionModal").classList.contains("active"));
  assert.equal(document.getElementById("actionModalTitle").textContent, "Prestar equipo");

  document.getElementById("assetLoanBorrowingClientInput").value = "Cliente Prestado";
  document.getElementById("assetLoanExpectedReturnInput").value = "2099-03-20T09:30";
  document.getElementById("assetLoanNotesInput").value = "Prestamo QA";
  document.getElementById("actionModalSubmitBtn").click();
  await flushDashboardTasks();
  await flushDashboardTasks();
  await flushDashboardTasks();

  assert.equal(createdLoanPayloads.length, 1);
  assert.equal(createdLoanPayloads[0].borrowing_client, "Cliente Prestado");
  assert.equal(createdLoanPayloads[0].notes, "Prestamo QA");
  assert.equal(Number.isNaN(Date.parse(createdLoanPayloads[0].expected_return_at)), false);
  assert.match(createdLoanPayloads[0].expected_return_at, /^2099-03-20T/);
  assert.equal(document.getElementById("actionModal").classList.contains("active"), false);
  assert.match(document.getElementById("assetDetail").textContent, /Prestamo activo/i);
  assert.match(document.getElementById("assetDetail").textContent, /Cliente Prestado/i);
  assert.match(document.getElementById("assetDetail").textContent, /Registrar devolucion/i);

  const returnButton = Array.from(document.querySelectorAll("#assetDetail button")).find(
    (button) => /Registrar devolucion/i.test(button.textContent || ""),
  );
  returnButton.click();
  await flushDashboardTasks();

  document.getElementById("assetLoanReturnNotesInput").value = "Sin novedades";
  document.getElementById("actionModalSubmitBtn").click();
  await flushDashboardTasks();
  await flushDashboardTasks();
  await flushDashboardTasks();

  assert.equal(returnedLoanPayloads.length, 1);
  assert.equal(returnedLoanPayloads[0].return_notes, "Sin novedades");
  assert.match(document.getElementById("assetDetail").textContent, /Prestar equipo/i);
  assert.doesNotMatch(document.getElementById("assetDetail").textContent, /Prestamo activo \| Cliente Prestado/i);
});

test("asset detail surfaces assigned technicians for direct operational management", async () => {
  const router = createFetchRouter([
    {
      method: "POST",
      match: "/web/auth/login",
      resolver: async () =>
        createJsonResponse(
          buildWebSessionPayload({
            username: "ops-admin",
            role: "admin",
          }),
        ),
    },
    {
      method: "GET",
      match: "/web/assets",
      resolver: async () =>
        createJsonResponse({
          success: true,
          items: [
            {
              id: 77,
              external_code: "EQ-77",
              brand: "Entrust",
              model: "Sigma",
              serial_number: "SN-77",
              client_name: "QA",
              status: "active",
            },
          ],
        }),
    },
    {
      method: "GET",
      match: "/web/assets/77/incidents",
      resolver: async () =>
        createJsonResponse({
          success: true,
          asset: {
            id: 77,
            external_code: "EQ-77",
            brand: "Entrust",
            model: "Sigma",
            serial_number: "SN-77",
            client_name: "QA",
            status: "active",
          },
          active_link: { installation_id: 12 },
          links: [],
          incidents: [],
        }),
    },
    {
      method: "GET",
      match: "/web/assets/77/loans",
      resolver: async () =>
        createJsonResponse({
          success: true,
          items: [],
          active_count: 0,
          overdue_count: 0,
        }),
    },
    {
      method: "GET",
      match: "/web/technicians",
      resolver: async () =>
        createJsonResponse({
          success: true,
          technicians: [
            {
              id: 7,
              display_name: "Luis Rivera",
              employee_code: "TEC-09",
              web_user_id: 7,
              is_active: true,
              active_assignment_count: 1,
            },
          ],
        }),
    },
    {
      method: "GET",
      match: ({ url }) =>
        url.pathname === "/web/technician-assignments" &&
        url.searchParams.get("entity_type") === "asset" &&
        url.searchParams.get("entity_id") === "77",
      resolver: async () =>
        createJsonResponse({
          success: true,
          assignments: [
            {
              id: 51,
              technician_id: 7,
              technician_display_name: "Luis Rivera",
              technician_employee_code: "TEC-09",
              assignment_role: "owner",
              assigned_by_username: "ops-admin",
            },
          ],
        }),
    },
  ]);

  const { dom } = await setupDashboardApp({ fetchImpl: router.fetch });
  const { window } = dom;
  const { document } = window;

  await loginThroughForm(dom, {
    username: "ops-admin",
    password: "StrongPass#2026",
  });

  await window.loadAssetDetail(77);
  await flushDashboardTasks();
  await flushDashboardTasks();

  const detailText = document.getElementById("assetDetail").textContent || "";
  assert.match(detailText, /Técnicos del equipo/i);
  assert.match(detailText, /Luis Rivera/i);
  assert.match(detailText, /Asignar técnico/i);
});

test("reopening a resolved incident removes the resolution panel immediately", async () => {
  const router = createFetchRouter([
    {
      method: "POST",
      match: "/web/auth/login",
      resolver: async () =>
        createJsonResponse(
          buildWebSessionPayload({
            username: "ops-admin",
            role: "admin",
          }),
        ),
    },
    {
      method: "PATCH",
      match: "/web/incidents/26/status",
      resolver: async () =>
        createJsonResponse({
          success: true,
          incident: {
            id: 26,
            installation_id: 34,
            note: "Equipo rehabilitado",
            severity: "medium",
            incident_status: "in_progress",
            created_at: "2026-03-18T10:00:00.000Z",
            status_updated_at: "2026-03-18T10:08:00.000Z",
            work_started_at: "2026-03-18T10:08:00.000Z",
            resolution_note: "",
            reporter_username: "ops-admin",
            photos: [],
          },
        }),
    },
    {
      method: "GET",
      match: "/web/installations/34/incidents",
      resolver: async () =>
        createJsonResponse({
          incidents: [
            {
              id: 26,
              installation_id: 34,
              note: "Equipo rehabilitado",
              severity: "medium",
              incident_status: "in_progress",
              created_at: "2026-03-18T10:00:00.000Z",
              status_updated_at: "2026-03-18T10:08:00.000Z",
              work_started_at: "2026-03-18T10:08:00.000Z",
              resolution_note: "",
              reporter_username: "ops-admin",
              photos: [],
            },
          ],
        }),
    },
  ]);

  const { dom } = await setupDashboardApp({ fetchImpl: router.fetch });
  const { window } = dom;
  const { document } = window;

  await loginThroughForm(dom, {
    username: "ops-admin",
    password: "StrongPass#2026",
  });

  await window.renderIncidents(
    [
      {
        id: 26,
        installation_id: 34,
        note: "Equipo rehabilitado",
        severity: "medium",
        incident_status: "resolved",
        created_at: "2026-03-18T10:00:00.000Z",
        status_updated_at: "2026-03-18T10:05:00.000Z",
        resolved_at: "2026-03-18T10:05:00.000Z",
        resolution_note: "Se reemplazo el modulo.",
        reporter_username: "ops-admin",
        photos: [],
      },
    ],
    34,
  );

  document.querySelector('.incident-action-btn[data-action="in_progress"]').click();
  await flushDashboardTasks();

  document.getElementById("actionModalConfirmCheckbox").checked = true;
  document.getElementById("actionModalSubmitBtn").click();
  await flushDashboardTasks();
  await flushDashboardTasks();

  const card = document.querySelector("#incidentsList .incident-card");
  assert.ok(card);
  assert.equal(card.dataset.status, "in_progress");
  assert.equal(
    card.querySelector('.incident-resolution-panel[data-panel-role="resolution"]'),
    null,
  );
  window.stopIncidentRuntimeTicker();
  window.closeSSE();
});

test("stale SSE errors do not close the latest realtime connection", async () => {
  const router = createFetchRouter([
    {
      method: "POST",
      match: "/web/auth/login",
      resolver: async () =>
        createJsonResponse(
          buildWebSessionPayload({
            username: "ops-admin",
            role: "admin",
          }),
        ),
    },
  ]);

  const { dom } = await setupDashboardApp({ fetchImpl: router.fetch });
  const { window } = dom;
  const eventSources = [];

  Object.defineProperty(window.document, "visibilityState", {
    configurable: true,
    value: "visible",
  });
  window.Math.random = () => 0;
  window.EventSource = class EventSourceMock {
    constructor(url, options) {
      this.url = url;
      this.options = options;
      this.closed = false;
      this.onopen = null;
      this.onmessage = null;
      this.onerror = null;
      eventSources.push(this);
    }

    close() {
      this.closed = true;
    }
  };

  await loginThroughForm(dom, {
    username: "ops-admin",
    password: "StrongPass#2026",
  });

  assert.equal(eventSources.length, 1);
  await flushDashboardTasks(1400);
  window.syncSSEForCurrentContext(true);
  await flushDashboardTasks();

  assert.equal(eventSources.length, 2);
  assert.equal(eventSources[0].closed, true);
  eventSources[0].onerror?.({ type: "error" });
  await flushDashboardTasks(2600);

  assert.equal(eventSources.length, 2);
  assert.equal(eventSources[1].closed, false);
  window.closeSSE();
});

test("force reconnect within the min gap does not downgrade an active SSE connection", async () => {
  const router = createFetchRouter([
    {
      method: "POST",
      match: "/web/auth/login",
      resolver: async () =>
        createJsonResponse(
          buildWebSessionPayload({
            username: "ops-admin",
            role: "admin",
          }),
        ),
    },
  ]);

  const { dom } = await setupDashboardApp({ fetchImpl: router.fetch });
  const { window } = dom;
  const eventSources = [];

  Object.defineProperty(window.document, "visibilityState", {
    configurable: true,
    value: "visible",
  });
  window.EventSource = class EventSourceMock {
    constructor(url, options) {
      this.url = url;
      this.options = options;
      this.closed = false;
      this.onopen = null;
      this.onmessage = null;
      this.onerror = null;
      eventSources.push(this);
    }

    close() {
      this.closed = true;
    }
  };

  await loginThroughForm(dom, {
    username: "ops-admin",
    password: "StrongPass#2026",
  });

  assert.equal(eventSources.length, 1);
  eventSources[0].onopen?.();
  await flushDashboardTasks();

  assert.equal(window.getConnectionStatus(), "connected");
  await flushDashboardTasks(1100);
  window.syncSSEForCurrentContext(true);
  await flushDashboardTasks();

  assert.equal(eventSources.length, 1);
  assert.equal(window.getConnectionStatus(), "connected");
  window.closeSSE();
});

test("scan qr modal opens from header overflow and keeps manual fallback visible", async () => {
  const router = createFetchRouter([
    {
      method: "POST",
      match: "/web/auth/login",
      resolver: async () => createJsonResponse(buildWebSessionPayload()),
    },
  ]);

  const { dom } = await setupDashboardApp({ fetchImpl: router.fetch });
  const { document } = dom.window;

  await loginThroughForm(dom);
  document.getElementById("overflowScanQrBtn").click();
  await flushDashboardTasks();

  assert.ok(document.getElementById("scanQrModal").classList.contains("active"));
  assert.match(document.getElementById("scanQrStatus").textContent, /fallback|camara|navegador/i);
  assert.ok(document.getElementById("scanQrManualInput"));
});

test("manual qr resolution opens incident context for installations", async () => {
  const router = createFetchRouter([
    {
      method: "POST",
      match: "/web/auth/login",
      resolver: async () => createJsonResponse(buildWebSessionPayload()),
    },
    {
      method: "GET",
      match: "/web/installations/42/incidents",
      resolver: async () =>
        createJsonResponse({
          success: true,
          installation_id: 42,
          incidents: [],
        }),
    },
  ]);

  const { dom } = await setupDashboardApp({ fetchImpl: router.fetch });
  const { document, Event } = dom.window;

  await loginThroughForm(dom);
  document.getElementById("overflowScanQrBtn").click();
  await flushDashboardTasks();

  document.getElementById("scanQrManualInput").value = "dm://installation/42";
  document.getElementById("scanQrManualForm").dispatchEvent(
    new Event("submit", { bubbles: true, cancelable: true }),
  );
  await flushDashboardTasks();
  await flushDashboardTasks(220);

  assert.ok(document.getElementById("incidentsSection").classList.contains("active"));
  assert.ok(router.calls.some((call) => call.pathname === "/web/installations/42/incidents"));
});

test("clicking a record row opens its incidents view", async () => {
  const router = createFetchRouter([
    {
      method: "POST",
      match: "/web/auth/login",
      resolver: async () => createJsonResponse(buildWebSessionPayload()),
    },
    {
      method: "GET",
      match: ({ url }) => url.pathname === "/web/installations" && url.searchParams.get("limit") === "50",
      resolver: async () =>
        createJsonResponse([
          {
            id: 36,
            client_name: "Prueba pausa tiempo",
            driver_brand: "Caso manual",
            attention_state: "in_progress",
            incident_active_count: 1,
            installation_time_seconds: 0,
            notes: "Probando",
            timestamp: "2026-03-23T21:19:58.000Z",
          },
        ]),
    },
    {
      method: "GET",
      match: "/web/installations/36/incidents",
      resolver: async () =>
        createJsonResponse({
          success: true,
          installation_id: 36,
          incidents: [],
        }),
    },
  ]);

  const { dom } = await setupDashboardApp({ fetchImpl: router.fetch });
  const { document } = dom.window;

  await loginThroughForm(dom);
  await dom.window.loadInstallations();
  await flushDashboardTasks();

  document.querySelector('#installationsTable tr[data-id="36"]').click();
  await flushDashboardTasks();
  await flushDashboardTasks(220);

  assert.ok(document.getElementById("incidentsSection").classList.contains("active"));
  assert.ok(router.calls.some((call) => call.pathname === "/web/installations/36/incidents"));
});

test("installations filters can narrow records by gps health", async () => {
  const router = createFetchRouter([
    {
      method: "POST",
      match: "/web/auth/login",
      resolver: async () => createJsonResponse(buildWebSessionPayload()),
    },
    {
      method: "GET",
      match: ({ url }) => url.pathname === "/web/installations" && url.searchParams.get("limit") === "50",
      resolver: async () =>
        createJsonResponse([
          {
            id: 36,
            client_name: "Con gps util",
            driver_brand: "Marca A",
            attention_state: "normal",
            installation_time_seconds: 0,
            notes: "",
            timestamp: "2026-03-23T21:19:58.000Z",
            site_lat: -34.9,
            site_lng: -56.16,
            site_radius_m: 60,
            gps_capture_status: "captured",
            gps_accuracy_m: 12,
          },
          {
            id: 37,
            client_name: "Con gps fallido",
            driver_brand: "Marca B",
            attention_state: "clear",
            installation_time_seconds: 0,
            notes: "",
            timestamp: "2026-03-23T21:19:58.000Z",
            site_lat: null,
            site_lng: null,
            site_radius_m: null,
            gps_capture_status: "denied",
            gps_accuracy_m: null,
          },
        ]),
    },
  ]);

  const { dom } = await setupDashboardApp({ fetchImpl: router.fetch });
  const { document } = dom.window;

  await loginThroughForm(dom);
  await dom.window.loadInstallations();
  await flushDashboardTasks();

  document.getElementById("gpsFilter").value = "failed";
  document.getElementById("applyFilters").click();
  await flushDashboardTasks(420);
  assert.match(document.getElementById("installationsTable").textContent, /Con gps fallido/);
  assert.doesNotMatch(document.getElementById("installationsTable").textContent, /Con gps util/);
});

test("opening incidents without a selected record shows a contextual landing state", async () => {
  const router = createFetchRouter([
    {
      method: "POST",
      match: "/web/auth/login",
      resolver: async () => createJsonResponse(buildWebSessionPayload()),
    },
  ]);

  const { dom } = await setupDashboardApp({ fetchImpl: router.fetch });
  const { document } = dom.window;

  await loginThroughForm(dom);
  document.querySelector('.nav-links a[data-section="incidents"]').click();
  await flushDashboardTasks();
  await flushDashboardTasks(220);

  assert.ok(document.getElementById("incidentsSection").classList.contains("active"));
  assert.match(document.getElementById("incidentsList").textContent, /Sin registro seleccionado/i);
  assert.match(document.getElementById("incidentsList").textContent, /Ir a Equipos/i);
});

test("manual qr resolution opens asset detail when lookup resolves an asset", async () => {
  const router = createFetchRouter([
    {
      method: "POST",
      match: "/web/auth/login",
      resolver: async () => createJsonResponse(buildWebSessionPayload()),
    },
    {
      method: "GET",
      match: ({ url }) =>
        url.pathname === "/web/lookup" &&
        url.searchParams.get("code") === "EQ-77" &&
        url.searchParams.get("type") === "asset",
      resolver: async () =>
        createJsonResponse({
          success: true,
          match: {
            type: "asset",
            asset_record_id: 77,
            installation_id: 12,
            external_code: "EQ-77",
          },
        }),
    },
    {
      method: "GET",
      match: "/web/assets/77/incidents",
      resolver: async () =>
        createJsonResponse({
          success: true,
          asset: {
            id: 77,
            external_code: "EQ-77",
            brand: "Entrust",
            model: "Sigma",
            serial_number: "SN-77",
            client_name: "QA",
            status: "active",
          },
          active_link: {
            installation_id: 12,
          },
          links: [],
          incidents: [],
        }),
    },
  ]);

  const { dom } = await setupDashboardApp({ fetchImpl: router.fetch });
  const { document, Event } = dom.window;

  await loginThroughForm(dom);
  document.getElementById("overflowScanQrBtn").click();
  await flushDashboardTasks();

  document.getElementById("scanQrManualInput").value = "dm://asset/EQ-77";
  document.getElementById("scanQrManualForm").dispatchEvent(
    new Event("submit", { bubbles: true, cancelable: true }),
  );
  await flushDashboardTasks();
  await flushDashboardTasks(220);

  assert.ok(document.getElementById("assetsSection").classList.contains("active"));
  assert.ok(router.calls.some((call) => call.pathname === "/web/lookup"));
  assert.ok(router.calls.some((call) => call.pathname === "/web/assets/77/incidents"));
});

test("photo modal navigates between multiple evidence photos without closing", async () => {
  const router = createFetchRouter([
    {
      method: "GET",
      match: "/web/photos/11",
      resolver: async () =>
        new Response("photo-11", {
          status: 200,
          headers: { "Content-Type": "image/jpeg" },
        }),
    },
    {
      method: "GET",
      match: "/web/photos/12",
      resolver: async () =>
        new Response("photo-12", {
          status: 200,
          headers: { "Content-Type": "image/jpeg" },
        }),
    },
    {
      method: "GET",
      match: "/web/photos/13",
      resolver: async () =>
        new Response("photo-13", {
          status: 200,
          headers: { "Content-Type": "image/jpeg" },
        }),
    },
  ]);

  const { dom } = await setupDashboardApp({ fetchImpl: router.fetch });
  const { window } = dom;
  const { document } = window;

  window.webAccessToken = "token-test";
  await window.viewPhoto(11, [11, 12, 13]);
  await flushDashboardTasks();

  assert.ok(document.getElementById("photoModal").classList.contains("active"));
  assert.equal(document.getElementById("photoViewerCounter").textContent, "1 / 3");
  assert.equal(document.getElementById("photoPrevBtn").disabled, true);
  assert.equal(document.getElementById("photoNextBtn").disabled, false);

  document.getElementById("photoNextBtn").click();
  await flushDashboardTasks();

  assert.equal(document.getElementById("photoViewerCounter").textContent, "2 / 3");
  assert.equal(document.getElementById("photoPrevBtn").disabled, false);
  assert.ok(router.calls.some((call) => call.pathname === "/web/photos/12"));
});

test("camera scan falls back to jsQR when BarcodeDetector is unavailable", async () => {
  let openedInstallationId = null;
  const { dom } = await setupDashboardApp();
  const { window } = dom;
  const { document } = window;

  const video = document.getElementById("scanQrVideo");
  Object.defineProperty(video, "play", {
    configurable: true,
    value: async () => {},
  });
  Object.defineProperty(video, "pause", {
    configurable: true,
    value: () => {},
  });
  Object.defineProperty(video, "videoWidth", {
    configurable: true,
    get: () => 320,
  });
  Object.defineProperty(video, "videoHeight", {
    configurable: true,
    get: () => 240,
  });
  Object.defineProperty(window.HTMLCanvasElement.prototype, "getContext", {
    configurable: true,
    value() {
      return {
        drawImage() {},
        getImageData() {
          return {
            data: new Uint8ClampedArray(320 * 240 * 4),
          };
        },
      };
    },
  });

  window.BarcodeDetector = undefined;
  window.jsQR = () => ({ data: "dm://installation/42" });
  Object.defineProperty(window.navigator, "mediaDevices", {
    configurable: true,
    value: {
      getUserMedia: async () => ({
        getTracks() {
          return [
            {
              stop() {},
            },
          ];
        },
      }),
    },
  });

  const scan = window.createDashboardScan({
    api: {
      lookupCode: async () => ({ match: null }),
    },
    openInstallation: async (installationId) => {
      openedInstallationId = installationId;
    },
    openAsset: async () => {},
    requireActiveSession: () => true,
    showNotification: () => {},
  });

  await scan.startCamera();
  await flushDashboardTasks(220);
  await flushDashboardTasks();

  assert.equal(openedInstallationId, 42);
  assert.match(document.getElementById("scanQrStatus").textContent, /escaneo compatible|resolviendo codigo/i);
});

test("manual record creation updates the installations view without forcing a blocking reload", async () => {
  const recordPayloads = [];
  const router = createFetchRouter([
    {
      method: "POST",
      match: "/web/auth/login",
      resolver: async () =>
        createJsonResponse(
          buildWebSessionPayload({
            username: "ops-admin",
            role: "admin",
          }),
        ),
    },
    {
      method: "GET",
      match: "/web/installations",
      resolver: async () => createJsonResponse([]),
    },
    {
      method: "POST",
      match: "/web/records",
      resolver: async ({ request }) => {
        recordPayloads.push(JSON.parse(await request.text()));
        return createJsonResponse(
          {
            success: true,
            record: {
              id: 123,
              tenant_id: "default",
              timestamp: "2026-03-20T12:00:00.000Z",
              client_name: "Cliente QA",
              driver_brand: "Equipo QA",
              driver_version: "v1",
              status: "manual",
              driver_description: "Registro manual desde dashboard web",
              installation_time_seconds: 0,
              os_info: "web",
              notes: "Alta creada desde test",
              attention_state: "normal",
            },
          },
          { status: 201 },
        );
      },
    },
  ]);

  const { dom } = await setupDashboardApp({ fetchImpl: router.fetch });
  const { window } = dom;
  const { document, MouseEvent, Event } = window;
  installGeolocationMock(window, (success) => {
    success({
      coords: {
        latitude: -34.9011,
        longitude: -56.1645,
        accuracy: 18,
      },
      timestamp: Date.parse("2026-03-20T12:00:00.000Z"),
    });
  });

  await loginThroughForm(dom, {
    username: "ops-admin",
    password: "StrongPass#2026",
  });

  document
    .querySelector(".nav-links a[data-section=\"installations\"]")
    .dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  await flushDashboardTasks(220);
  await flushDashboardTasks();

  const installationsCallsBeforeCreate = router.calls.filter((call) => call.pathname === "/web/installations").length;

  window.createManualRecordFromWeb();
  await flushDashboardTasks();
  document.getElementById("actionRecordClient").value = "Cliente QA";
  document.getElementById("actionRecordBrand").value = "Equipo QA";
  document.getElementById("actionRecordVersion").value = "v1";
  document.getElementById("actionRecordNotes").value = "Alta creada desde test";
  document.getElementById("actionModalForm").dispatchEvent(
    new Event("submit", { bubbles: true, cancelable: true }),
  );
  await flushDashboardTasks();
  await flushDashboardTasks();

  assert.equal(recordPayloads.length, 1);
  assert.equal(recordPayloads[0].gps.status, "captured");
  assert.equal(recordPayloads[0].gps.source, "browser");
  assert.equal(recordPayloads[0].gps.lat, -34.9011);
  assert.equal(recordPayloads[0].gps.lng, -56.1645);
  assert.equal(document.getElementById("actionModal").classList.contains("active"), false);
  assert.match(document.getElementById("installationsTable").textContent, /#123/);
  assert.match(document.getElementById("installationsTable").textContent, /Cliente QA/);
  assert.equal(
    router.calls.filter((call) => call.pathname === "/web/installations").length,
    installationsCallsBeforeCreate,
  );
});

test("incident creation keeps the modal flow responsive without forcing an installations reload", async () => {
  const incidentPayloads = [];
  const router = createFetchRouter([
    {
      method: "POST",
      match: "/web/auth/login",
      resolver: async () =>
        createJsonResponse(
          buildWebSessionPayload({
            username: "ops-admin",
            role: "admin",
          }),
        ),
    },
    {
      method: "GET",
      match: "/web/installations",
      resolver: async () => createJsonResponse([]),
    },
    {
      method: "POST",
      match: "/web/installations/45/incidents",
      resolver: async ({ request }) => {
        incidentPayloads.push(JSON.parse(await request.text()));
        return createJsonResponse(
          {
            success: true,
            incident: {
              id: 88,
              installation_id: 45,
              note: "Incidencia creada desde test",
              severity: "high",
              incident_status: "open",
              created_at: "2026-03-20T12:15:00.000Z",
              reporter_username: "ops-admin",
              photos: [],
            },
          },
          { status: 201 },
        );
      },
    },
    {
      method: "GET",
      match: "/web/installations/45/incidents",
      resolver: async () =>
        createJsonResponse({
          success: true,
          installation_id: 45,
          incidents: [
            {
              id: 88,
              installation_id: 45,
              note: "Incidencia creada desde test",
              severity: "high",
              incident_status: "open",
              created_at: "2026-03-20T12:15:00.000Z",
              reporter_username: "ops-admin",
              photos: [],
            },
          ],
        }),
    },
  ]);

  const { dom } = await setupDashboardApp({ fetchImpl: router.fetch });
  const { window } = dom;
  const { document, Event } = window;
  installGeolocationMock(window, (success) => {
    success({
      coords: {
        latitude: -34.9011,
        longitude: -56.1645,
        accuracy: 12,
      },
      timestamp: Date.parse("2026-03-20T12:15:00.000Z"),
    });
  });

  await loginThroughForm(dom, {
    username: "ops-admin",
    password: "StrongPass#2026",
  });

  const installationsCallsBeforeCreate = router.calls.filter((call) => call.pathname === "/web/installations").length;

  window.createIncidentFromWeb(45);
  await flushDashboardTasks();
  document.getElementById("actionIncidentNote").value = "Incidencia creada desde test";
  document.getElementById("actionIncidentSeverity").value = "high";
  document.getElementById("actionModalForm").dispatchEvent(
    new Event("submit", { bubbles: true, cancelable: true }),
  );
  await flushDashboardTasks();
  await flushDashboardTasks();

  assert.equal(incidentPayloads.length, 1);
  assert.equal(incidentPayloads[0].gps.status, "captured");
  assert.equal(incidentPayloads[0].gps.source, "browser");
  assert.equal(incidentPayloads[0].gps.accuracy_m, 12);
  assert.equal(document.getElementById("actionModal").classList.contains("active"), false);
  assert.equal(
    router.calls.filter((call) => call.pathname === "/web/installations").length,
    installationsCallsBeforeCreate,
  );
  assert.ok(router.calls.some((call) => call.pathname === "/web/installations/45/incidents"));
});

test("manual record submission stores denied geolocation status without blocking the flow", async () => {
  const recordPayloads = [];
  const router = createFetchRouter([
    {
      method: "POST",
      match: "/web/auth/login",
      resolver: async () => createJsonResponse(buildWebSessionPayload({ username: "ops-admin", role: "admin" })),
    },
    {
      method: "POST",
      match: "/web/records",
      resolver: async ({ request }) => {
        recordPayloads.push(JSON.parse(await request.text()));
        return createJsonResponse({ success: true, record: { id: 301, client_name: "Cliente QA" } }, { status: 201 });
      },
    },
  ]);

  const { dom } = await setupDashboardApp({ fetchImpl: router.fetch });
  const { window } = dom;
  const { document, Event } = window;
  installGeolocationMock(window, (_success, error) => {
    error({ code: 1 });
  });

  await loginThroughForm(dom, { username: "ops-admin", password: "StrongPass#2026" });

  window.createManualRecordFromWeb();
  await flushDashboardTasks();
  document.getElementById("actionRecordClient").value = "Cliente QA";
  document.getElementById("actionModalForm").dispatchEvent(
    new Event("submit", { bubbles: true, cancelable: true }),
  );
  await flushDashboardTasks();
  await flushDashboardTasks();

  assert.equal(recordPayloads.length, 1);
  assert.equal(recordPayloads[0].gps.status, "denied");
  assert.equal(recordPayloads[0].gps.source, "browser");
});

test("manual record keeps captured gps without creating site reference metadata", async () => {
  const recordPayloads = [];
  const router = createFetchRouter([
    {
      method: "POST",
      match: "/web/auth/login",
      resolver: async () => createJsonResponse(buildWebSessionPayload({ username: "ops-admin", role: "admin" })),
    },
    {
      method: "POST",
      match: "/web/records",
      resolver: async ({ request }) => {
        recordPayloads.push(JSON.parse(await request.text()));
        return createJsonResponse({ success: true, record: { id: 306 } }, { status: 201 });
      },
    },
  ]);

  const { dom } = await setupDashboardApp({ fetchImpl: router.fetch });
  const { window } = dom;
  const { document, Event } = window;
  installGeolocationMock(window, (success) => {
    success({
      coords: {
        latitude: -34.9011,
        longitude: -56.1645,
        accuracy: 18,
      },
      timestamp: Date.parse("2026-03-20T12:00:00.000Z"),
    });
  });

  await loginThroughForm(dom, { username: "ops-admin", password: "StrongPass#2026" });

  window.createManualRecordFromWeb();
  await flushDashboardTasks();
  document.getElementById("actionModalForm").dispatchEvent(
    new Event("submit", { bubbles: true, cancelable: true }),
  );
  await flushDashboardTasks();
  await flushDashboardTasks();

  assert.equal(recordPayloads.length, 1);
  assert.equal(recordPayloads[0].gps.status, "captured");
  assert.equal(recordPayloads[0].site_lat, undefined);
  assert.equal(recordPayloads[0].site_lng, undefined);
  assert.equal(recordPayloads[0].site_radius_m, undefined);
});

test("manual record submission preserves timeout geolocation status", async () => {
  const recordPayloads = [];
  const router = createFetchRouter([
    {
      method: "POST",
      match: "/web/auth/login",
      resolver: async () => createJsonResponse(buildWebSessionPayload({ username: "ops-admin", role: "admin" })),
    },
    {
      method: "POST",
      match: "/web/records",
      resolver: async ({ request }) => {
        recordPayloads.push(JSON.parse(await request.text()));
        return createJsonResponse({ success: true, record: { id: 302 } }, { status: 201 });
      },
    },
  ]);

  const { dom } = await setupDashboardApp({ fetchImpl: router.fetch });
  const { window } = dom;
  const { document, Event } = window;
  installGeolocationMock(window, (_success, error) => {
    error({ code: 3 });
  });

  await loginThroughForm(dom, { username: "ops-admin", password: "StrongPass#2026" });

  window.createManualRecordFromWeb();
  await flushDashboardTasks();
  document.getElementById("actionModalForm").dispatchEvent(
    new Event("submit", { bubbles: true, cancelable: true }),
  );
  await flushDashboardTasks();
  await flushDashboardTasks();

  assert.equal(recordPayloads[0].gps.status, "timeout");
});

test("manual record submission preserves unavailable geolocation status", async () => {
  const recordPayloads = [];
  const router = createFetchRouter([
    {
      method: "POST",
      match: "/web/auth/login",
      resolver: async () => createJsonResponse(buildWebSessionPayload({ username: "ops-admin", role: "admin" })),
    },
    {
      method: "POST",
      match: "/web/records",
      resolver: async ({ request }) => {
        recordPayloads.push(JSON.parse(await request.text()));
        return createJsonResponse({ success: true, record: { id: 305 } }, { status: 201 });
      },
    },
  ]);

  const { dom } = await setupDashboardApp({ fetchImpl: router.fetch });
  const { window } = dom;
  const { document, Event } = window;
  installGeolocationMock(window, (_success, error) => {
    error({ code: 2 });
  });

  await loginThroughForm(dom, { username: "ops-admin", password: "StrongPass#2026" });

  window.createManualRecordFromWeb();
  await flushDashboardTasks();
  document.getElementById("actionModalForm").dispatchEvent(
    new Event("submit", { bubbles: true, cancelable: true }),
  );
  await flushDashboardTasks();
  await flushDashboardTasks();

  assert.equal(recordPayloads[0].gps.status, "unavailable");
});

test("manual record submission marks geolocation as unsupported when navigator API is unavailable", async () => {
  const recordPayloads = [];
  const router = createFetchRouter([
    {
      method: "POST",
      match: "/web/auth/login",
      resolver: async () => createJsonResponse(buildWebSessionPayload({ username: "ops-admin", role: "admin" })),
    },
    {
      method: "POST",
      match: "/web/records",
      resolver: async ({ request }) => {
        recordPayloads.push(JSON.parse(await request.text()));
        return createJsonResponse({ success: true, record: { id: 303 } }, { status: 201 });
      },
    },
  ]);

  const { dom } = await setupDashboardApp({ fetchImpl: router.fetch });
  const { window } = dom;
  const { document, Event } = window;
  Object.defineProperty(window.navigator, "geolocation", {
    configurable: true,
    value: undefined,
  });

  await loginThroughForm(dom, { username: "ops-admin", password: "StrongPass#2026" });

  window.createManualRecordFromWeb();
  await flushDashboardTasks();
  document.getElementById("actionModalForm").dispatchEvent(
    new Event("submit", { bubbles: true, cancelable: true }),
  );
  await flushDashboardTasks();
  await flushDashboardTasks();

  assert.equal(recordPayloads[0].gps.status, "unsupported");
});

test("submitting while geolocation capture is still pending sends a pending snapshot note", async () => {
  const recordPayloads = [];
  const router = createFetchRouter([
    {
      method: "POST",
      match: "/web/auth/login",
      resolver: async () => createJsonResponse(buildWebSessionPayload({ username: "ops-admin", role: "admin" })),
    },
    {
      method: "POST",
      match: "/web/records",
      resolver: async ({ request }) => {
        recordPayloads.push(JSON.parse(await request.text()));
        return createJsonResponse({ success: true, record: { id: 304 } }, { status: 201 });
      },
    },
  ]);

  const { dom } = await setupDashboardApp({ fetchImpl: router.fetch });
  const { window } = dom;
  const { document, Event } = window;
  installGeolocationMock(window, () => {});

  await loginThroughForm(dom, { username: "ops-admin", password: "StrongPass#2026" });

  window.createManualRecordFromWeb();
  document.getElementById("actionModalForm").dispatchEvent(
    new Event("submit", { bubbles: true, cancelable: true }),
  );
  await flushDashboardTasks();
  await flushDashboardTasks();

  assert.equal(recordPayloads[0].gps.status, "pending");
  assert.equal(recordPayloads[0].gps.note, "capture_in_progress_at_submit");
  assert.equal(recordPayloads[0].gps.source, "browser");
});

test("asset incident creation includes geolocation payload", async () => {
  const incidentPayloads = [];
  const router = createFetchRouter([
    {
      method: "POST",
      match: "/web/auth/login",
      resolver: async () => createJsonResponse(buildWebSessionPayload({ username: "ops-admin", role: "admin" })),
    },
    {
      method: "POST",
      match: "/web/assets/77/incidents",
      resolver: async ({ request }) => {
        incidentPayloads.push(JSON.parse(await request.text()));
        return createJsonResponse({
          success: true,
          installation_id: 12,
          incident: {
            id: 401,
            installation_id: 12,
            asset_id: 77,
            note: "Incidencia equipo",
            severity: "medium",
            incident_status: "open",
            created_at: "2026-03-20T12:20:00.000Z",
            reporter_username: "ops-admin",
            photos: [],
          },
        }, { status: 201 });
      },
    },
    {
      method: "GET",
      match: "/web/assets/77/incidents",
      resolver: async () => createJsonResponse({
        success: true,
        asset: { id: 77, external_code: "EQ-77", brand: "Entrust", model: "Sigma", serial_number: "SN-77", client_name: "QA", status: "active" },
        active_link: { installation_id: 12 },
        links: [],
        incidents: [],
      }),
    },
  ]);

  const { dom } = await setupDashboardApp({ fetchImpl: router.fetch });
  const { window } = dom;
  const { document, Event } = window;
  installGeolocationMock(window, (success) => {
    success({
      coords: {
        latitude: -34.88,
        longitude: -56.15,
        accuracy: 9,
      },
      timestamp: Date.parse("2026-03-20T12:20:00.000Z"),
    });
  });

  await loginThroughForm(dom, { username: "ops-admin", password: "StrongPass#2026" });

  window.createIncidentFromWeb("", { assetId: 77, activeInstallationId: 12 });
  await flushDashboardTasks();
  document.getElementById("actionIncidentNote").value = "Incidencia equipo";
  document.getElementById("actionModalForm").dispatchEvent(
    new Event("submit", { bubbles: true, cancelable: true }),
  );
  await flushDashboardTasks();
  await flushDashboardTasks();

  assert.equal(incidentPayloads.length, 1);
  assert.equal(incidentPayloads[0].gps.status, "captured");
  assert.equal(incidentPayloads[0].gps.source, "browser");
});

test("incident modal preselects the assigned technician for the installation", async () => {
  const router = createFetchRouter([
    {
      method: "POST",
      match: "/web/auth/login",
      resolver: async () => createJsonResponse(buildWebSessionPayload({ username: "ops-admin", role: "admin" })),
    },
    {
      method: "GET",
      match: "/web/technicians",
      resolver: async () =>
        createJsonResponse({
          success: true,
          technicians: [
            { id: 1, display_name: "Luis Rivera", employee_code: "TEC-09", is_active: true, active_assignment_count: 1 },
            { id: 2, display_name: "Maria Campo", employee_code: "TEC-10", is_active: true, active_assignment_count: 0 },
          ],
        }),
    },
    {
      method: "GET",
      match: ({ url }) =>
        url.pathname === "/web/technician-assignments" &&
        url.searchParams.get("entity_type") === "installation" &&
        url.searchParams.get("entity_id") === "45",
      resolver: async () =>
        createJsonResponse({
          success: true,
          assignments: [
            {
              id: 51,
              technician_id: 1,
              technician_display_name: "Luis Rivera",
              technician_employee_code: "TEC-09",
              assignment_role: "owner",
            },
          ],
        }),
    },
  ]);

  const { dom } = await setupDashboardApp({ fetchImpl: router.fetch });
  const { window } = dom;
  const { document } = window;

  await loginThroughForm(dom, { username: "ops-admin", password: "StrongPass#2026" });

  window.createIncidentFromWeb(45);
  await flushDashboardTasks();
  await flushDashboardTasks();

  const technicianSelect = document.getElementById("actionIncidentTechnicianName");
  assert.ok(technicianSelect instanceof window.HTMLSelectElement);
  assert.equal(technicianSelect.value, "Luis Rivera");
});

test("incident creation includes captured gps payload without geofence override fields", async () => {
  const incidentPayloads = [];
  const router = createFetchRouter([
    {
      method: "POST",
      match: "/web/auth/login",
      resolver: async () => createJsonResponse(buildWebSessionPayload({ username: "ops-admin", role: "admin" })),
    },
    {
      method: "GET",
      match: "/web/installations",
      resolver: async () => createJsonResponse([
        {
          id: 45,
          client_name: "Acme",
          driver_brand: "Intel",
        },
      ]),
    },
    {
      method: "POST",
      match: "/web/installations/45/incidents",
      resolver: async ({ request }) => {
        incidentPayloads.push(JSON.parse(await request.text()));
        return createJsonResponse({
          success: true,
          incident: {
            id: 402,
            installation_id: 45,
            note: "Fuera del radio",
            severity: "medium",
            incident_status: "open",
            created_at: "2026-03-20T12:20:00.000Z",
            reporter_username: "ops-admin",
            photos: [],
          },
        }, { status: 201 });
      },
    },
  ]);

  const { dom } = await setupDashboardApp({ fetchImpl: router.fetch });
  const { window } = dom;
  const { document, Event } = window;
  installGeolocationMock(window, (success) => {
    success({
      coords: {
        latitude: -34.89,
        longitude: -56.15,
        accuracy: 12,
      },
      timestamp: Date.parse("2026-03-20T12:20:00.000Z"),
    });
  });

  await loginThroughForm(dom, { username: "ops-admin", password: "StrongPass#2026" });

  window.createIncidentFromWeb(45);
  await flushDashboardTasks();
  await flushDashboardTasks();

  document.getElementById("actionIncidentNote").value = "Fuera del radio";
  document.getElementById("actionModalForm").dispatchEvent(
    new Event("submit", { bubbles: true, cancelable: true }),
  );
  await flushDashboardTasks();
  await flushDashboardTasks();

  assert.equal(incidentPayloads.length, 1);
  assert.equal(incidentPayloads[0].gps.status, "captured");
  assert.equal(incidentPayloads[0].geofence_override_note, undefined);
});

test("incidents view shows assigned technician and can filter cards by technician", async () => {
  const router = createFetchRouter([
    {
      method: "POST",
      match: "/web/auth/login",
      resolver: async () => createJsonResponse(buildWebSessionPayload({ username: "ops-admin", role: "admin" })),
    },
    {
      method: "GET",
      match: "/web/technicians",
      resolver: async () =>
        createJsonResponse({
          success: true,
          technicians: [
            { id: 1, display_name: "Luis Rivera", employee_code: "TEC-09", is_active: true, active_assignment_count: 1 },
            { id: 2, display_name: "Maria Campo", employee_code: "TEC-10", is_active: true, active_assignment_count: 0 },
          ],
        }),
    },
    {
      method: "GET",
      match: ({ url }) =>
        url.pathname === "/web/technician-assignments" &&
        url.searchParams.get("entity_type") === "installation" &&
        url.searchParams.get("entity_id") === "45",
      resolver: async () =>
        createJsonResponse({
          success: true,
          assignments: [
            {
              id: 51,
              technician_id: 1,
              technician_display_name: "Luis Rivera",
              technician_employee_code: "TEC-09",
              assignment_role: "owner",
            },
          ],
        }),
    },
    {
      method: "GET",
      match: "/web/installations/45/conformity",
      resolver: async () => createJsonResponse({ success: true, conformity: null }),
    },
  ]);

  const { dom } = await setupDashboardApp({ fetchImpl: router.fetch });
  const { window } = dom;
  const { document, Event } = window;

  await loginThroughForm(dom, { username: "ops-admin", password: "StrongPass#2026" });

  await window.renderIncidents(
    [
      {
        id: 18,
        installation_id: 45,
        note: "Primera incidencia",
        severity: "medium",
        incident_status: "open",
        created_at: "2026-03-20T12:00:00.000Z",
        reporter_username: "Maria Campo",
        photos: [],
      },
      {
        id: 19,
        installation_id: 45,
        note: "Segunda incidencia",
        severity: "high",
        incident_status: "in_progress",
        created_at: "2026-03-20T12:20:00.000Z",
        reporter_username: "ops-admin",
        photos: [],
      },
    ],
    45,
  );
  await flushDashboardTasks();
  await flushDashboardTasks();

  const cards = Array.from(document.querySelectorAll("#incidentsList .incident-card"));
  assert.equal(cards.length, 2);
  assert.match(cards[0].textContent || "", /Tecnico asignado:\s*Luis Rivera/i);

  const filterSelect = document.getElementById("incidentsTechnicianFilter");
  assert.ok(filterSelect instanceof window.HTMLSelectElement);
  filterSelect.value = "Maria Campo";
  filterSelect.dispatchEvent(new Event("change", { bubbles: true }));

  const visibleCards = cards.filter((card) => card.hidden !== true);
  assert.equal(visibleCards.length, 1);
  assert.match(visibleCards[0].textContent || "", /Primera incidencia/i);
});

test("conformity creation includes captured geolocation payload", async () => {
  const conformityPayloads = [];
  const router = createFetchRouter([
    {
      method: "POST",
      match: "/web/auth/login",
      resolver: async () => createJsonResponse(buildWebSessionPayload({ username: "ops-admin", role: "admin" })),
    },
    {
      method: "GET",
      match: "/web/installations/45/conformity",
      resolver: async () => createJsonResponse({ success: true, conformity: null }),
    },
    {
      method: "POST",
      match: "/web/installations/45/conformity",
      resolver: async ({ request }) => {
        conformityPayloads.push(JSON.parse(await request.text()));
        return createJsonResponse({
          success: true,
          conformity: { id: 90, status: "emailed" },
        }, { status: 201 });
      },
    },
  ]);

  const { dom } = await setupDashboardApp({ fetchImpl: router.fetch });
  const { window } = dom;
  const { document, Event } = window;
  installGeolocationMock(window, (success) => {
    success({
      coords: {
        latitude: -34.9011,
        longitude: -56.1645,
        accuracy: 18,
      },
      timestamp: Date.parse("2026-03-26T10:01:00.000Z"),
    });
  });

  await loginThroughForm(dom, { username: "ops-admin", password: "StrongPass#2026" });
  await window.renderIncidents([], 45);
  document.querySelector('[data-role="conformity-trigger"]').click();
  await flushDashboardTasks();
  await flushDashboardTasks();

  const canvas = document.getElementById("actionConformitySignatureCanvas");
  canvas.onpointerdown?.({
    preventDefault() {},
    clientX: 10,
    clientY: 10,
    pointerId: 1,
  });
  canvas.onpointermove?.({
    preventDefault() {},
    clientX: 40,
    clientY: 24,
  });
  canvas.onpointerup?.({});

  document.getElementById("actionConformityEmailTo").value = "cliente@example.com";
  document.getElementById("actionModalForm").dispatchEvent(
    new Event("submit", { bubbles: true, cancelable: true }),
  );
  await flushDashboardTasks();
  await flushDashboardTasks();

  assert.equal(conformityPayloads.length, 1);
  assert.equal(conformityPayloads[0].gps.status, "captured");
  assert.equal(conformityPayloads[0].gps.source, "browser");
  assert.equal(conformityPayloads[0].gps.lat, -34.9011);
});

test("conformity creation includes captured gps payload without geofence override note", async () => {
  const conformityPayloads = [];
  const router = createFetchRouter([
    {
      method: "POST",
      match: "/web/auth/login",
      resolver: async () => createJsonResponse(buildWebSessionPayload({ username: "ops-admin", role: "admin" })),
    },
    {
      method: "GET",
      match: "/web/installations",
      resolver: async () => createJsonResponse([
        {
          id: 45,
          client_name: "Acme",
          driver_brand: "Intel",
        },
      ]),
    },
    {
      method: "GET",
      match: "/web/installations/45/conformity",
      resolver: async () => createJsonResponse({ success: true, conformity: null }),
    },
    {
      method: "POST",
      match: "/web/installations/45/conformity",
      resolver: async ({ request }) => {
        conformityPayloads.push(JSON.parse(await request.text()));
        return createJsonResponse({
          success: true,
          conformity: {
            id: 92,
            status: "generated",
            metadata_json: JSON.stringify({}),
          },
        }, { status: 201 });
      },
    },
  ]);

  const { dom } = await setupDashboardApp({ fetchImpl: router.fetch });
  const { window } = dom;
  const { document, Event } = window;
  installGeolocationMock(window, (success) => {
    success({
      coords: {
        latitude: -34.89,
        longitude: -56.15,
        accuracy: 18,
      },
      timestamp: Date.parse("2026-03-26T10:01:00.000Z"),
    });
  });

  await loginThroughForm(dom, { username: "ops-admin", password: "StrongPass#2026" });
  await window.renderIncidents([], 45);
  document.querySelector('[data-role="conformity-trigger"]').click();
  await flushDashboardTasks();
  await flushDashboardTasks();

  const canvas = document.getElementById("actionConformitySignatureCanvas");
  canvas.onpointerdown?.({
    preventDefault() {},
    clientX: 10,
    clientY: 10,
    pointerId: 1,
  });
  canvas.onpointermove?.({
    preventDefault() {},
    clientX: 40,
    clientY: 24,
  });
  canvas.onpointerup?.({});

  document.getElementById("actionConformityEmailTo").value = "cliente@example.com";
  document.getElementById("actionModalForm").dispatchEvent(
    new Event("submit", { bubbles: true, cancelable: true }),
  );
  await flushDashboardTasks();
  await flushDashboardTasks();

  assert.equal(conformityPayloads.length, 1);
  assert.equal(conformityPayloads[0].gps.status, "captured");
  assert.equal(conformityPayloads[0].geofence_override_note, undefined);
});

test("conformity creation requires override note when geolocation is not usable", async () => {
  const conformityPayloads = [];
  const router = createFetchRouter([
    {
      method: "POST",
      match: "/web/auth/login",
      resolver: async () => createJsonResponse(buildWebSessionPayload({ username: "ops-admin", role: "admin" })),
    },
    {
      method: "GET",
      match: "/web/installations/45/conformity",
      resolver: async () => createJsonResponse({ success: true, conformity: null }),
    },
    {
      method: "POST",
      match: "/web/installations/45/conformity",
      resolver: async ({ request }) => {
        conformityPayloads.push(JSON.parse(await request.text()));
        return createJsonResponse({
          success: true,
          conformity: { id: 91, status: "generated" },
        }, { status: 201 });
      },
    },
  ]);

  const { dom } = await setupDashboardApp({ fetchImpl: router.fetch });
  const { window } = dom;
  const { document, Event } = window;
  installGeolocationMock(window, (_success, error) => {
    error({ code: 1 });
  });

  await loginThroughForm(dom, { username: "ops-admin", password: "StrongPass#2026" });
  await window.renderIncidents([], 45);
  document.querySelector('[data-role="conformity-trigger"]').click();
  await flushDashboardTasks();
  await flushDashboardTasks();

  const overrideWrap = document.getElementById("actionConformityGpsOverrideWrap");
  assert.equal(overrideWrap.hidden, false);

  const canvas = document.getElementById("actionConformitySignatureCanvas");
  canvas.onpointerdown?.({
    preventDefault() {},
    clientX: 10,
    clientY: 10,
    pointerId: 1,
  });
  canvas.onpointermove?.({
    preventDefault() {},
    clientX: 40,
    clientY: 24,
  });
  canvas.onpointerup?.({});

  document.getElementById("actionConformityEmailTo").value = "cliente@example.com";
  document.getElementById("actionConformityGpsOverrideNote").value = "Sin senal dentro de la sala tecnica.";
  document.getElementById("actionModalForm").dispatchEvent(
    new Event("submit", { bubbles: true, cancelable: true }),
  );
  await flushDashboardTasks();
  await flushDashboardTasks();

  assert.equal(conformityPayloads.length, 1);
  assert.deepEqual(conformityPayloads[0].gps, {
    status: "override",
    source: "override",
    note: "Sin senal dentro de la sala tecnica.",
  });
});

test("installations table surfaces gps state without geofence badges or site actions", async () => {
  const { dom } = await setupDashboardApp();
  const { window } = dom;

  window.renderInstallationsTable([
    {
      id: 41,
      client_name: "Cliente sin sitio",
      driver_brand: "Marca A",
      installation_time_seconds: 0,
      notes: "",
      timestamp: "2026-03-26T10:00:00.000Z",
      attention_state: "clear",
      site_lat: null,
      site_lng: null,
      site_radius_m: null,
      gps_capture_status: "denied",
      gps_accuracy_m: null,
    },
    {
      id: 42,
      client_name: "Cliente con sitio",
      driver_brand: "Marca B",
      installation_time_seconds: 0,
      notes: "",
      timestamp: "2026-03-26T10:00:00.000Z",
      attention_state: "normal",
      site_lat: -34.9,
      site_lng: -56.16,
      site_radius_m: 60,
      gps_capture_status: "captured",
      gps_accuracy_m: 14,
    },
  ]);

  const tableText = window.document.getElementById("installationsTable").textContent;
  assert.match(tableText, /GPS denegado/);
  assert.match(tableText, /GPS \+\- 14 m/);
  assert.doesNotMatch(tableText, /Sin geofence|Geofence 60 m|Referencia 60 m|Sin referencia/);
  assert.equal(
    Array.from(window.document.querySelectorAll(".table-action-btn")).some((button) => button.textContent.includes("Sitio")),
    false,
  );
});

test("installations table shows estimated and actual time summary and aligned actions group", async () => {
  const { dom } = await setupDashboardApp();
  const { window } = dom;
  const { document } = window;

  window.renderInstallationsTable([
    {
      id: 51,
      client_name: "Cliente tiempos",
      driver_brand: "Entrust",
      installation_time_seconds: 120,
      incident_estimated_duration_seconds_total: 5400,
      incident_estimated_duration_count: 1,
      incident_actual_duration_seconds_total: 3900,
      incident_actual_duration_count: 1,
      notes: "",
      timestamp: "2026-03-26T10:00:00.000Z",
      attention_state: "resolved",
      site_lat: -34.9,
      site_lng: -56.16,
      site_radius_m: 60,
    },
  ]);

  const timeCellText = document.querySelector("#installationsTable tbody td:nth-child(5)").textContent;
  assert.match(timeCellText, /Est\./);
  assert.match(timeCellText, /1h 30m/);
  assert.match(timeCellText, /Real/);
  assert.match(timeCellText, /1h 5m/);

  const actionsGroup = document.querySelector("#installationsTable .table-actions-group");
  assert.ok(actionsGroup, "actions group should exist");
  assert.equal(actionsGroup.children.length, 1);
});

test("public tracking modal loads, regenerates, copies and revokes the shared link", async () => {
  const clipboardWrites = [];
  const router = createFetchRouter([
    {
      method: "POST",
      match: "/web/auth/login",
      resolver: async () => createJsonResponse(buildWebSessionPayload({ username: "ops-admin", role: "admin" })),
    },
    {
      method: "GET",
      match: "/web/installations/45/public-tracking-link",
      resolver: async () => createJsonResponse({
        success: true,
        link: {
          active: true,
          status: "active",
          short_code: "AB7K9Q2M",
          tracking_url: "https://worker.example/track/AB7K9Q2M",
          expires_at: "2026-03-29T10:00:00.000Z",
          snapshot: {
            public_status: "pendiente",
            public_message: "Tu solicitud ya fue registrada y esta pendiente de atencion.",
          },
        },
      }),
    },
    {
      method: "POST",
      match: "/web/installations/45/public-tracking-link",
      resolver: async () => createJsonResponse({
        success: true,
        link: {
          active: true,
          status: "active",
          short_code: "XZ4N8R6T",
          tracking_url: "https://worker.example/track/XZ4N8R6T",
          expires_at: "2026-03-30T12:00:00.000Z",
          snapshot: {
            public_status: "en_progreso",
            public_message: "Estamos trabajando en tu servicio.",
          },
        },
      }, { status: 201 }),
    },
    {
      method: "DELETE",
      match: "/web/installations/45/public-tracking-link",
      resolver: async () => createJsonResponse({
        success: true,
        revoked: true,
      }),
    },
  ]);

  const { dom } = await setupDashboardApp({ fetchImpl: router.fetch });
  const { window } = dom;
  const { document } = window;
  window.navigator.clipboard.writeText = async (value) => {
    clipboardWrites.push(value);
  };

  await loginThroughForm(dom, { username: "ops-admin", password: "StrongPass#2026" });
  await window.renderIncidents([], 45);

  document.querySelector('[data-role="public-tracking-trigger"]').click();
  await flushDashboardTasks();
  await flushDashboardTasks();

  assert.ok(document.getElementById("actionModal").classList.contains("active"));
  assert.equal(
    document.getElementById("actionPublicTrackingUrl").value,
    "https://worker.example/track/AB7K9Q2M",
  );
  assert.match(document.getElementById("actionPublicTrackingSnapshot").textContent, /pendiente/i);

  document.getElementById("actionPublicTrackingCopyBtn").click();
  await flushDashboardTasks();

  assert.deepEqual(clipboardWrites, ["https://worker.example/track/AB7K9Q2M"]);

  document.getElementById("actionModalSubmitBtn").click();
  await flushDashboardTasks();
  await flushDashboardTasks();

  assert.equal(
    document.getElementById("actionPublicTrackingUrl").value,
    "https://worker.example/track/XZ4N8R6T",
  );
  assert.match(document.getElementById("actionPublicTrackingSnapshot").textContent, /en_progreso/i);

  document.getElementById("actionPublicTrackingRevokeBtn").click();
  await flushDashboardTasks();
  await flushDashboardTasks();

  assert.equal(document.getElementById("actionPublicTrackingUrl").value, "");
  assert.equal(document.getElementById("actionPublicTrackingRevokeBtn").disabled, true);
  assert.ok(
    router.calls.some((call) => call.pathname === "/web/installations/45/public-tracking-link" && call.method === "DELETE"),
  );
});

test("incident photo upload accepts multiple files and limits each batch to five", async () => {
  const uploadedFileNames = [];
  const router = createFetchRouter([
    {
      method: "POST",
      match: "/web/auth/login",
      resolver: async () =>
        createJsonResponse(
          buildWebSessionPayload({
            username: "ops-admin",
            role: "admin",
          }),
        ),
    },
    {
      method: "POST",
      match: "/web/incidents/19/photos",
      resolver: async ({ request }) => {
        uploadedFileNames.push(request.headers.get("X-File-Name"));
        return createJsonResponse({ success: true }, { status: 201 });
      },
    },
    {
      method: "GET",
      match: "/web/installations/45/incidents",
      resolver: async () =>
        createJsonResponse({
          success: true,
          installation_id: 45,
          incidents: [
            {
              id: 19,
              installation_id: 45,
              note: "Fotos en curso",
              severity: "medium",
              incident_status: "open",
              created_at: "2026-03-20T12:20:00.000Z",
              reporter_username: "ops-admin",
              photos: [],
            },
          ],
        }),
    },
  ]);

  const { dom } = await setupDashboardApp({ fetchImpl: router.fetch });
  const { window } = dom;
  const { document, Event } = window;

  await loginThroughForm(dom, {
    username: "ops-admin",
    password: "StrongPass#2026",
  });

  await window.renderIncidents(
    [
      {
        id: 19,
        installation_id: 45,
        note: "Fotos en curso",
        severity: "medium",
        incident_status: "open",
        created_at: "2026-03-20T12:20:00.000Z",
        reporter_username: "ops-admin",
        photos: [],
      },
    ],
    45,
  );

  assert.match(document.querySelector(".incident-upload-btn").textContent, /max 5/i);

  window.selectAndUploadIncidentPhoto(19, 45);
  const picker = document.querySelector(".hidden-file-picker");
  assert.ok(picker);

  const files = Array.from({ length: 6 }, (_, index) =>
    new window.File([`image-${index + 1}`], `photo-${index + 1}.jpg`, { type: "image/jpeg" }),
  );
  Object.defineProperty(picker, "files", {
    configurable: true,
    value: files,
  });
  picker.dispatchEvent(new Event("change", { bubbles: true }));

  await flushDashboardTasks();
  await flushDashboardTasks();
  await flushDashboardTasks();

  assert.deepEqual(uploadedFileNames, [
    "photo-1.jpg",
    "photo-2.jpg",
    "photo-3.jpg",
    "photo-4.jpg",
    "photo-5.jpg",
  ]);
  assert.ok(router.calls.some((call) => call.pathname === "/web/installations/45/incidents"));
  assert.match(document.body.textContent, /Solo se permiten 5 fotos por carga/i);
});

test("incident photo upload rejects batches over 20MB before sending requests", async () => {
  const uploadedFileNames = [];
  const router = createFetchRouter([
    {
      method: "POST",
      match: "/web/auth/login",
      resolver: async () =>
        createJsonResponse(
          buildWebSessionPayload({
            username: "ops-admin",
            role: "admin",
          }),
        ),
    },
    {
      method: "POST",
      match: "/web/incidents/19/photos",
      resolver: async ({ request }) => {
        uploadedFileNames.push(request.headers.get("X-File-Name"));
        return createJsonResponse({ success: true }, { status: 201 });
      },
    },
  ]);

  const { dom } = await setupDashboardApp({ fetchImpl: router.fetch });
  const { window } = dom;
  const { document, Event } = window;

  await loginThroughForm(dom, {
    username: "ops-admin",
    password: "StrongPass#2026",
  });

  await window.selectAndUploadIncidentPhoto(19, 45);
  const picker = document.querySelector(".hidden-file-picker");
  assert.ok(picker);

  const oversizedBatch = Array.from({ length: 5 }, (_, index) => ({
    name: `photo-${index + 1}.jpg`,
    size: Math.floor(4.5 * 1024 * 1024),
    type: "image/jpeg",
  }));
  Object.defineProperty(picker, "files", {
    configurable: true,
    value: oversizedBatch,
  });
  picker.dispatchEvent(new Event("change", { bubbles: true }));

  await flushDashboardTasks();
  await flushDashboardTasks();

  assert.deepEqual(uploadedFileNames, []);
  assert.match(document.body.textContent, /supera el maximo de 20\.0MB por tanda/i);
});

test("incident map lets admin set operational target directly from the map", async () => {
  const patchPayloads = [];
  const baseIncident = {
    id: 19,
    installation_id: 45,
    asset_id: 6,
    note: "Visita de coordinacion",
    severity: "high",
    incident_status: "open",
    created_at: "2026-03-20T12:20:00.000Z",
    reporter_username: "ops-admin",
    gps_lat: -34.9011,
    gps_lng: -56.1645,
    gps_accuracy_m: 8,
    target_lat: null,
    target_lng: null,
    target_label: null,
    target_source: null,
    dispatch_place_name: null,
    asset_code: "ATM-009",
    installation_client_name: "Cliente QA",
    photos: [],
  };

  const router = createFetchRouter([
    {
      method: "POST",
      match: "/web/auth/login",
      resolver: async () =>
        createJsonResponse(
          buildWebSessionPayload({
            username: "ops-admin",
            role: "admin",
          }),
        ),
    },
    {
      method: "GET",
      match: "/web/incidents/map",
      resolver: async () =>
        createJsonResponse({
          success: true,
          incidents: [baseIncident],
        }),
    },
    {
      method: "PATCH",
      match: "/web/incidents/19/dispatch-target",
      resolver: async ({ request }) => {
        const body = JSON.parse(await request.text());
        patchPayloads.push(body);
        return createJsonResponse({
          success: true,
          incident: {
            ...baseIncident,
            ...body,
            dispatch_place_name: "Punto manual",
          },
        });
      },
    },
  ]);

  const { dom } = await setupDashboardApp({ fetchImpl: router.fetch });
  const { window } = dom;
  const { document } = window;

  class MockLngLatBounds {
    constructor() {
      this.points = [];
    }

    extend(coordinates) {
      this.points.push(coordinates);
      return this;
    }
  }

  class MockMap {
    constructor() {
      this.handlers = new Map();
      this.sources = new Map();
      this.layers = new Set();
      this.canvas = document.createElement("div");
      window.__lastIncidentMap = this;
      window.setTimeout(() => this.trigger("load"), 0);
    }

    addControl() {}

    addSource(id, config) {
      this.sources.set(id, {
        ...config,
        setData: (data) => {
          const current = this.sources.get(id) || {};
          this.sources.set(id, { ...current, data });
        },
      });
    }

    getSource(id) {
      return this.sources.get(id) || null;
    }

    addLayer(layer) {
      this.layers.add(layer.id);
    }

    getLayer(id) {
      return this.layers.has(id) ? { id } : null;
    }

    on(eventName, layerOrHandler, maybeHandler) {
      const layerId = typeof layerOrHandler === "string" ? layerOrHandler : "__base__";
      const handler = typeof layerOrHandler === "function" ? layerOrHandler : maybeHandler;
      if (typeof handler !== "function") return;
      this.handlers.set(`${eventName}:${layerId}`, handler);
    }

    getCanvas() {
      return this.canvas;
    }

    easeTo(options) {
      this.lastEaseTo = options;
    }

    fitBounds(bounds, options) {
      this.lastFitBounds = { bounds, options };
    }

    remove() {}

    trigger(eventName, payload = {}, layerId = "__base__") {
      const handler = this.handlers.get(`${eventName}:${layerId}`);
      if (handler) {
        handler(payload);
      }
    }
  }

  window.mapboxgl = {
    Map: MockMap,
    NavigationControl: class NavigationControl {},
    LngLatBounds: MockLngLatBounds,
  };
  window.localStorage.setItem("dm_mapbox_access_token", "token-qa");

  await loginThroughForm(dom, {
    username: "ops-admin",
    password: "StrongPass#2026",
  });

  await window.activateSection("incidentMap");
  await flushDashboardTasks();
  await flushDashboardTasks();
  await flushDashboardTasks();

  const adjustButton = Array.from(document.querySelectorAll("#incidentMapDetail button")).find((button) =>
    /Elegir destino/i.test(button.textContent || ""),
  );
  assert.ok(adjustButton);

  adjustButton.click();
  await flushDashboardTasks();

  assert.match(document.getElementById("incidentMapDetail").textContent || "", /Modo ajuste activo/i);

  window.__lastIncidentMap.trigger("click", {
    lngLat: { lat: -34.907654, lng: -56.198765 },
  });
  await flushDashboardTasks();
  await flushDashboardTasks();
  await flushDashboardTasks();

  assert.equal(patchPayloads.length, 1);
  assert.equal(patchPayloads[0].target_source, "manual_map");
  assert.equal(patchPayloads[0].target_lat, -34.907654);
  assert.equal(patchPayloads[0].target_lng, -56.198765);
  assert.match(document.getElementById("incidentMapDetail").textContent || "", /Punto manual/i);
  assert.match(document.getElementById("incidentMapDetail").textContent || "", /-34\.90765/i);
  assert.match(document.getElementById("incidentMapDetail").textContent || "", /-56\.19877/i);
});

test("paused incidents show paused runtime and offer resume action", async () => {
  const { dom } = await setupDashboardApp();
  const { window } = dom;
  const { document } = window;

  await window.renderIncidents(
    [
      {
        id: 27,
        installation_id: 45,
        note: "Pendiente por salida a campo",
        severity: "medium",
        incident_status: "paused",
        created_at: "2026-03-20T12:20:00.000Z",
        status_updated_at: "2026-03-20T12:40:00.000Z",
        actual_duration_seconds: 780,
        reporter_username: "ops-admin",
        photos: [],
      },
    ],
    45,
  );

  const card = document.querySelector("#incidentsList .incident-card");
  assert.ok(card);
  assert.equal(card.dataset.status, "paused");
  assert.match(card.textContent, /Pausada/);
  assert.match(card.textContent, /en pausa/i);
  assert.match(
    card.querySelector('.incident-action-btn[data-action="in_progress"]').textContent,
    /Reanudar/,
  );
});

test("status updates apply pause state immediately in the visible card", async () => {
  const router = createFetchRouter([
    {
      method: "POST",
      match: "/web/auth/login",
      resolver: async () =>
        createJsonResponse(
          buildWebSessionPayload({
            username: "ops-admin",
            role: "admin",
          }),
        ),
    },
    {
      method: "PATCH",
      match: "/web/incidents/27/status",
      resolver: async () =>
        createJsonResponse({
          success: true,
          incident: {
            id: 27,
            installation_id: 45,
            note: "Pendiente por salida a campo",
            severity: "medium",
            incident_status: "paused",
            created_at: "2026-03-20T12:20:00.000Z",
            status_updated_at: "2026-03-20T12:40:00.000Z",
            actual_duration_seconds: 780,
            reporter_username: "ops-admin",
            photos: [],
          },
        }),
    },
    {
      method: "GET",
      match: "/web/installations/45/incidents",
      resolver: async () =>
        createJsonResponse({
          incidents: [
            {
              id: 27,
              installation_id: 45,
              note: "Pendiente por salida a campo",
              severity: "medium",
              incident_status: "paused",
              created_at: "2026-03-20T12:20:00.000Z",
              status_updated_at: "2026-03-20T12:40:00.000Z",
              actual_duration_seconds: 780,
              reporter_username: "ops-admin",
              photos: [],
            },
          ],
        }),
    },
  ]);

  const { dom } = await setupDashboardApp({ fetchImpl: router.fetch });
  const { window } = dom;
  const { document } = window;

  await loginThroughForm(dom, {
    username: "ops-admin",
    password: "StrongPass#2026",
  });

  await window.renderIncidents(
    [
      {
        id: 27,
        installation_id: 45,
        note: "Pendiente por salida a campo",
        severity: "medium",
        incident_status: "in_progress",
        created_at: "2026-03-20T12:20:00.000Z",
        status_updated_at: "2026-03-20T12:27:00.000Z",
        reporter_username: "ops-admin",
        photos: [],
      },
    ],
    45,
  );

  document.querySelector('.incident-action-btn[data-action="paused"]').click();
  await flushDashboardTasks();
  await flushDashboardTasks();

  const card = document.querySelector("#incidentsList .incident-card");
  assert.ok(card);
  assert.equal(card.dataset.status, "paused");
  assert.match(card.textContent, /Pausada/);
  assert.match(card.textContent, /en pausa/i);
  assert.match(
    card.querySelector('.incident-action-btn[data-action="in_progress"]').textContent,
    /Reanudar/,
  );
});

test("status updates mark the card as updating while the request is in flight", async () => {
  let resolvePatch;
  const patchPromise = new Promise((resolve) => {
    resolvePatch = resolve;
  });
  const router = createFetchRouter([
    {
      method: "POST",
      match: "/web/auth/login",
      resolver: async () =>
        createJsonResponse(
          buildWebSessionPayload({
            username: "ops-admin",
            role: "admin",
          }),
        ),
    },
    {
      method: "PATCH",
      match: "/web/incidents/27/status",
      resolver: async () => {
        await patchPromise;
        return createJsonResponse({
          success: true,
          incident: {
            id: 27,
            installation_id: 45,
            note: "Pendiente por salida a campo",
            severity: "medium",
            incident_status: "paused",
            created_at: "2026-03-20T12:20:00.000Z",
            status_updated_at: "2026-03-20T12:40:00.000Z",
            actual_duration_seconds: 780,
            reporter_username: "ops-admin",
            photos: [],
          },
        });
      },
    },
    {
      method: "GET",
      match: "/web/installations/45/incidents",
      resolver: async () =>
        createJsonResponse({
          incidents: [
            {
              id: 27,
              installation_id: 45,
              note: "Pendiente por salida a campo",
              severity: "medium",
              incident_status: "paused",
              created_at: "2026-03-20T12:20:00.000Z",
              status_updated_at: "2026-03-20T12:40:00.000Z",
              actual_duration_seconds: 780,
              reporter_username: "ops-admin",
              photos: [],
            },
          ],
        }),
    },
  ]);

  const { dom } = await setupDashboardApp({ fetchImpl: router.fetch });
  const { window } = dom;
  const { document } = window;

  await loginThroughForm(dom, {
    username: "ops-admin",
    password: "StrongPass#2026",
  });

  await window.renderIncidents(
    [
      {
        id: 27,
        installation_id: 45,
        note: "Pendiente por salida a campo",
        severity: "medium",
        incident_status: "in_progress",
        created_at: "2026-03-20T12:20:00.000Z",
        status_updated_at: "2026-03-20T12:27:00.000Z",
        reporter_username: "ops-admin",
        photos: [],
      },
    ],
    45,
  );

  document.querySelector('.incident-action-btn[data-action="paused"]').click();
  await flushDashboardTasks();

  const card = document.querySelector("#incidentsList .incident-card");
  assert.ok(card);
  assert.equal(card.dataset.updating, "true");
  assert.equal(
    card.querySelector('.incident-action-btn[data-action="paused"]').disabled,
    true,
  );

  resolvePatch();
  await flushDashboardTasks();
  await flushDashboardTasks();

  assert.equal(card.dataset.updating, "false");
});

test("resuming an incident keeps the accumulated runtime in the live counter", async () => {
  const resumedAtIso = new Date(Date.now()).toISOString();
  const router = createFetchRouter([
    {
      method: "POST",
      match: "/web/auth/login",
      resolver: async () =>
        createJsonResponse(
          buildWebSessionPayload({
            username: "ops-admin",
            role: "admin",
          }),
        ),
    },
    {
      method: "PATCH",
      match: "/web/incidents/27/status",
      resolver: async () =>
        createJsonResponse({
          success: true,
          incident: {
            id: 27,
            installation_id: 45,
            note: "Pendiente por salida a campo",
            severity: "medium",
            incident_status: "in_progress",
            created_at: "2026-03-20T12:20:00.000Z",
            status_updated_at: resumedAtIso,
            work_started_at: resumedAtIso,
            actual_duration_seconds: 780,
            reporter_username: "ops-admin",
            photos: [],
          },
        }),
    },
    {
      method: "GET",
      match: "/web/installations/45/incidents",
      resolver: async () =>
        createJsonResponse({
          incidents: [
            {
              id: 27,
              installation_id: 45,
              note: "Pendiente por salida a campo",
              severity: "medium",
              incident_status: "in_progress",
              created_at: "2026-03-20T12:20:00.000Z",
              status_updated_at: resumedAtIso,
              work_started_at: resumedAtIso,
              actual_duration_seconds: 780,
              reporter_username: "ops-admin",
              photos: [],
            },
          ],
        }),
    },
  ]);

  const { dom } = await setupDashboardApp({ fetchImpl: router.fetch });
  const { window } = dom;
  const { document } = window;

  await loginThroughForm(dom, {
    username: "ops-admin",
    password: "StrongPass#2026",
  });

  await window.renderIncidents(
    [
      {
        id: 27,
        installation_id: 45,
        note: "Pendiente por salida a campo",
        severity: "medium",
        incident_status: "paused",
        created_at: "2026-03-20T12:20:00.000Z",
        status_updated_at: "2026-03-20T12:40:00.000Z",
        work_ended_at: "2026-03-20T12:40:00.000Z",
        actual_duration_seconds: 780,
        reporter_username: "ops-admin",
        photos: [],
      },
    ],
    45,
  );

  document.querySelector('.incident-action-btn[data-action="in_progress"]').click();
  await flushDashboardTasks();
  await flushDashboardTasks();

  const runtimeChip = document.querySelector('.incident-highlight-chip[data-chip="runtime"]');
  assert.ok(runtimeChip);
  assert.match(runtimeChip.textContent, /13m/);
  assert.equal(runtimeChip.dataset.runtimeBaseSeconds, "780");

  await new Promise((resolve) => window.setTimeout(resolve, 1100));
  assert.match(runtimeChip.textContent, /13m(?: 1s)? \(en curso\)/);
  window.stopIncidentRuntimeTicker();
});

test("incident cards avoid repeating low-priority metadata already shown in chips and panels", async () => {
  const { dom } = await setupDashboardApp();
  const { window } = dom;
  const { document } = window;

  await window.renderIncidents(
    [
      {
        id: 19,
        installation_id: 34,
        asset_id: 6,
        severity: "high",
        incident_status: "resolved",
        reporter_username: "diegosasen",
        created_at: "2026-03-19T06:29:00.000Z",
        resolved_at: "2026-03-19T06:29:00.000Z",
        resolved_by: "diegosasen",
        note: "Se cambió el rodillo.",
        resolution_note: "Equipo funcionando correctamente.",
        checklist_items: [
          "Equipo identificado (QR/serie)",
          "Evidencia fotografica capturada",
        ],
        installation_client_name: "Equipo ARSL1-003",
        installation_brand: "Entrust",
        installation_version: "Sigma SL1",
        photos: [],
      },
    ],
    34,
  );

  const card = document.querySelector("#incidentsList .incident-card");
  assert.ok(card);
  assert.equal(card.querySelector(".incident-context-primary")?.textContent, "Equipo ARSL1-003");
  assert.match(card.querySelector(".incident-context-meta")?.textContent || "", /Equipo #6/);
  assert.match(card.querySelector(".incident-context-meta")?.textContent || "", /Registro #34/);
  assert.equal(card.textContent.includes("Cliente:"), false);
  assert.equal(card.textContent.includes("Estado:"), false);
  assert.equal(card.querySelectorAll(".incident-dispatch-block").length, 1);
  assert.match(card.textContent, /Sin destino operativo definido/i);
  assert.equal(card.querySelectorAll(".incident-meta-line").length, 1);
});

test("qr preview builds payload and image url for installation codes", async () => {
  const { dom } = await setupDashboardApp();
  const { window } = dom;
  const { document } = window;

  window.showQrModal({ type: "installation", value: "42" });
  document.querySelector('input[name="qrType"][value="installation"]').checked = true;
  document.getElementById("qrValueInput").value = "42";
  window.generateQrPreview();
  await flushDashboardTasks();

  assert.equal(document.getElementById("qrPayloadText").textContent, "dm://installation/42");
  assert.match(document.getElementById("qrPreviewImage").src, /^data:image\//);
  assert.equal(document.getElementById("qrDownloadBtn").dataset.filename, "qr-instalacion-42.png");
});
