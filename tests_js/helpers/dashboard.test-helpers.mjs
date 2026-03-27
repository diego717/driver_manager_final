import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { JSDOM } from "jsdom";

const PUBLIC_DIR = path.join(process.cwd(), "public");
const DEFAULT_DASHBOARD_TEST_URL = "http://localhost:8787/web/dashboard";
const activeDashboardDoms = new Set();

function resolvePublicAssetPath(assetName) {
  return path.join(PUBLIC_DIR, assetName);
}

export function readPublicTextAsset(assetName) {
  const assetPath = resolvePublicAssetPath(assetName);
  if (!fs.existsSync(assetPath)) {
    throw new Error(`No existe asset sincronizado en public/: ${assetName}`);
  }
  return fs.readFileSync(assetPath, "utf8");
}

export function loadPublicDashboardHtml() {
  return readPublicTextAsset("dashboard.html");
}

export function createJsonResponse(payload, { status = 200, headers = {} } = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...headers,
    },
  });
}

function buildDefaultStatisticsPayload() {
  return {
    total_installations: 1,
    successful_installations: 1,
    failed_installations: 0,
    unique_clients: 1,
    avg_installation_time: 120,
    gps_observability: {
      installations: {
        attempted_count: 0,
        captured_count: 0,
        failure_count: 0,
        capture_success_rate: 0,
        average_accuracy_m: null,
        p95_accuracy_m: null,
      },
      incidents: {
        attempted_count: 0,
        captured_count: 0,
        failure_count: 0,
        capture_success_rate: 0,
        average_accuracy_m: null,
        p95_accuracy_m: null,
      },
      warnings: {
        total_outside_count: 0,
        incident_outside_count: 0,
        conformity_outside_count: 0,
      },
      overrides: {
        total_override_count: 0,
        incident_geofence_count: 0,
        conformity_geofence_count: 0,
        conformity_gps_count: 0,
      },
    },
    by_brand: {
      Zebra: 1,
    },
  };
}

function defaultFetchFallback({ request, url }) {
  const method = request.method.toUpperCase();

  if (method === "POST" && url.pathname === "/web/auth/logout") {
    return createJsonResponse({
      success: true,
      authenticated: false,
      logged_out: true,
    });
  }

  if (method === "GET" && url.pathname === "/web/auth/me") {
    return createJsonResponse(
      {
        error: { message: "No autorizado" },
      },
      { status: 401 },
    );
  }

  if (method === "GET" && url.pathname === "/web/statistics") {
    return createJsonResponse(buildDefaultStatisticsPayload());
  }

  if (method === "GET" && url.pathname === "/web/statistics/trend") {
    return createJsonResponse({ points: [] });
  }

  if (method === "GET" && url.pathname === "/web/installations") {
    return createJsonResponse([]);
  }

  if (method === "GET" && url.pathname === "/web/audit-logs") {
    return createJsonResponse([]);
  }

  if (method === "GET" && url.pathname === "/web/drivers") {
    return createJsonResponse({
      success: true,
      total: 0,
      items: [],
    });
  }

  return null;
}

export function createFetchRouter(handlers = [], { fallback = defaultFetchFallback } = {}) {
  const calls = [];
  const normalizedHandlers = handlers.map((handler) => ({
    method: String(handler.method || "GET").toUpperCase(),
    match: handler.match,
    resolver: handler.resolver,
  }));

  async function fetchRouter(input, init) {
    const normalizedInput =
      typeof input === "string" && input.startsWith("/")
        ? new URL(input, DEFAULT_DASHBOARD_TEST_URL).toString()
        : input;
    const request =
      normalizedInput instanceof Request
        ? normalizedInput
        : new Request(
            typeof normalizedInput === "string" ? normalizedInput : String(normalizedInput),
            init,
          );
    const url = new URL(request.url);
    calls.push({
      method: request.method.toUpperCase(),
      pathname: url.pathname,
      search: url.search,
      url,
    });

    for (const handler of normalizedHandlers) {
      if (handler.method !== request.method.toUpperCase()) {
        continue;
      }

      const matches =
        typeof handler.match === "string"
          ? url.pathname === handler.match
          : handler.match instanceof RegExp
            ? handler.match.test(url.pathname)
            : typeof handler.match === "function"
              ? handler.match({ request, url, calls })
              : false;

      if (!matches) {
        continue;
      }

      const response = await handler.resolver({ request, url, calls });
      if (!(response instanceof Response)) {
        throw new Error(`El handler de ${request.method} ${url.pathname} no devolvio Response.`);
      }
      return response;
    }

    const fallbackResponse = fallback ? await fallback({ request, url, calls }) : null;
    if (fallbackResponse instanceof Response) {
      return fallbackResponse;
    }

    throw new Error(`Unhandled dashboard fetch: ${request.method} ${url.pathname}${url.search}`);
  }

  return {
    calls,
    fetch: fetchRouter,
  };
}

function installBrowserShims(window, fetchImpl) {
  const matchMedia = () => ({
    matches: false,
    media: "",
    onchange: null,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    dispatchEvent() {
      return false;
    },
  });

  class MockChart {
    static defaults = { color: "", borderColor: "", font: {} };

    constructor(ctx, config) {
      this.ctx = ctx;
      this.config = config;
    }

    destroy() {}

    update() {}
  }

  window.fetch = fetchImpl;
  window.Response = Response;
  window.Request = Request;
  window.Headers = Headers;
  window.Blob = Blob;
  if (typeof File !== "undefined") {
    window.File = File;
  }

  Object.defineProperty(window, "Chart", {
    configurable: true,
    writable: true,
    value: MockChart,
  });
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: matchMedia,
  });
  Object.defineProperty(window, "EventSource", {
    configurable: true,
    writable: true,
    value: class EventSourceMock {
      close() {}
    },
  });
  Object.defineProperty(window.navigator, "clipboard", {
    configurable: true,
    value: {
      async writeText() {},
    },
  });

  window.requestAnimationFrame = (callback) => window.setTimeout(() => callback(Date.now()), 0);
  window.cancelAnimationFrame = (timerId) => window.clearTimeout(timerId);
  window.URL.createObjectURL = () => "blob:dashboard-test";
  window.URL.revokeObjectURL = () => {};
  window.scrollTo = () => {};
  window.focus = () => {};
  window.print = () => {};
  window.open = () => null;

  Object.defineProperty(window.HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    value() {},
  });
  Object.defineProperty(window.HTMLCanvasElement.prototype, "getContext", {
    configurable: true,
    value() {
      return {
        canvas: this,
        setTransform() {},
        clearRect() {},
        beginPath() {},
        moveTo() {},
        lineTo() {},
        stroke() {},
        fillRect() {},
        drawImage() {},
      };
    },
  });
  Object.defineProperty(window.HTMLCanvasElement.prototype, "toDataURL", {
    configurable: true,
    value() {
      return "data:image/png;base64,AA==";
    },
  });
}

function runPublicDashboardScripts(dom) {
  const context = dom.getInternalVMContext();
  const qrScript = new vm.Script(readPublicTextAsset("dashboard-qr.js"), {
    filename: "public/dashboard-qr.js",
  });
  qrScript.runInContext(context);

  const apiScript = new vm.Script(readPublicTextAsset("dashboard-api.js"), {
    filename: "public/dashboard-api.js",
  });
  apiScript.runInContext(context);

  const geolocationScript = new vm.Script(readPublicTextAsset("dashboard-geolocation.js"), {
    filename: "public/dashboard-geolocation.js",
  });
  geolocationScript.runInContext(context);

  const jsQrScript = new vm.Script(readPublicTextAsset("jsqr.js"), {
    filename: "public/jsqr.js",
  });
  jsQrScript.runInContext(context);

  const scanScript = new vm.Script(readPublicTextAsset("dashboard-scan.js"), {
    filename: "public/dashboard-scan.js",
  });
  scanScript.runInContext(context);

  const modalsScript = new vm.Script(readPublicTextAsset("dashboard-modals.js"), {
    filename: "public/dashboard-modals.js",
  });
  modalsScript.runInContext(context);

  const incidentsScript = new vm.Script(readPublicTextAsset("dashboard-incidents.js"), {
    filename: "public/dashboard-incidents.js",
  });
  incidentsScript.runInContext(context);

  const assetsScript = new vm.Script(readPublicTextAsset("dashboard-assets.js"), {
    filename: "public/dashboard-assets.js",
  });
  assetsScript.runInContext(context);

  const driversScript = new vm.Script(readPublicTextAsset("dashboard-drivers.js"), {
    filename: "public/dashboard-drivers.js",
  });
  driversScript.runInContext(context);

  const auditScript = new vm.Script(readPublicTextAsset("dashboard-audit.js"), {
    filename: "public/dashboard-audit.js",
  });
  auditScript.runInContext(context);

  const overviewScript = new vm.Script(readPublicTextAsset("dashboard-overview.js"), {
    filename: "public/dashboard-overview.js",
  });
  overviewScript.runInContext(context);

  const realtimeScript = new vm.Script(readPublicTextAsset("dashboard-realtime.js"), {
    filename: "public/dashboard-realtime.js",
  });
  realtimeScript.runInContext(context);

  const authScript = new vm.Script(readPublicTextAsset("dashboard-auth.js"), {
    filename: "public/dashboard-auth.js",
  });
  authScript.runInContext(context);

  const navigationScript = new vm.Script(readPublicTextAsset("dashboard-navigation.js"), {
    filename: "public/dashboard-navigation.js",
  });
  navigationScript.runInContext(context);

  const bootstrapScript = new vm.Script(readPublicTextAsset("dashboard-bootstrap.js"), {
    filename: "public/dashboard-bootstrap.js",
  });
  bootstrapScript.runInContext(context);

  const dashboardScript = new vm.Script(readPublicTextAsset("dashboard.js"), {
    filename: "public/dashboard.js",
  });
  dashboardScript.runInContext(context);
}

export async function flushDashboardTasks(delayMs = 0) {
  await new Promise((resolve) => setTimeout(resolve, delayMs));
}

export async function setupDashboardApp({ fetchImpl, url = DEFAULT_DASHBOARD_TEST_URL } = {}) {
  const router = fetchImpl ? null : createFetchRouter();
  const dom = new JSDOM(loadPublicDashboardHtml(), {
    url,
    runScripts: "outside-only",
  });
  activeDashboardDoms.add(dom);

  installBrowserShims(dom.window, fetchImpl || router.fetch);
  runPublicDashboardScripts(dom);
  await flushDashboardTasks();

  return {
    dom,
    router,
  };
}

export function cleanupDashboardApps() {
  activeDashboardDoms.forEach((dom) => {
    try {
      dom.window.close();
    } catch {}
  });
  activeDashboardDoms.clear();
}
