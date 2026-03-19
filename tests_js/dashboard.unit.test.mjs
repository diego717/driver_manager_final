import test from "node:test";
import assert from "node:assert/strict";

import {
  createFetchRouter,
  createJsonResponse,
  flushDashboardTasks,
  setupDashboardApp,
} from "./helpers/dashboard.test-helpers.mjs";

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

test("dashboard bootstrap shows login and masks protected panels without session", async () => {
  const { dom } = await setupDashboardApp();
  const { document } = dom.window;

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
