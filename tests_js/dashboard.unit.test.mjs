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

  await loginThroughForm(dom, {
    username: "ops-admin",
    password: "StrongPass#2026",
  });

  const installationsCallsBeforeCreate = router.calls.filter((call) => call.pathname === "/web/installations").length;

  window.createIncidentFromWeb(45);
  document.getElementById("actionIncidentNote").value = "Incidencia creada desde test";
  document.getElementById("actionIncidentSeverity").value = "high";
  document.getElementById("actionModalForm").dispatchEvent(
    new Event("submit", { bubbles: true, cancelable: true }),
  );
  await flushDashboardTasks();
  await flushDashboardTasks();

  assert.equal(incidentPayloads.length, 1);
  assert.equal(document.getElementById("actionModal").classList.contains("active"), false);
  assert.equal(
    router.calls.filter((call) => call.pathname === "/web/installations").length,
    installationsCallsBeforeCreate,
  );
  assert.ok(router.calls.some((call) => call.pathname === "/web/installations/45/incidents"));
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
  assert.match(runtimeChip.textContent, /13m 1s \(en curso\)/);
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
  assert.equal(card.textContent.includes("Cliente:"), false);
  assert.equal(card.textContent.includes("Estado:"), false);
  assert.equal(
    card.querySelectorAll(".incident-meta-line").length,
    0,
  );
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
