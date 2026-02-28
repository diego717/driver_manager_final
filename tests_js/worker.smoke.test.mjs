import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

import worker from "../worker.js";
import { createDashboardAssetsBinding } from "./helpers/assets.mock.mjs";

const DEFAULT_API_TOKEN = "token-123";
const DEFAULT_API_SECRET = "secret-abc";

function sha256Hex(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function signRequest({ method, path, timestamp, bodyBuffer, secret }) {
  const bodyHash = sha256Hex(bodyBuffer || Buffer.alloc(0));
  const canonical = `${method.toUpperCase()}|${path}|${timestamp}|${bodyHash}`;
  return crypto.createHmac("sha256", secret).update(canonical).digest("hex");
}

function normalizeSql(sql) {
  return sql.replace(/\s+/g, " ").trim();
}

function createSmokeDb({
  installations = [{ id: 1, tenant_id: "default", driver_brand: "Zebra", status: "success" }],
} = {}) {
  const calls = [];
  const state = {
    installations: installations.map((row) => ({ tenant_id: "default", ...row })),
  };

  return {
    calls,
    state,
    prepare(sql) {
      const normalized = normalizeSql(sql);
      const call = { sql: normalized, bound: [] };
      calls.push(call);

      return {
        bind(...args) {
          call.bound = args;
          return this;
        },
        async all() {
          if (
            normalized.startsWith(
              "SELECT id, name, status, plan_code FROM tenants WHERE id = ? LIMIT 1",
            )
          ) {
            return {
              results: [
                {
                  id: String(call.bound?.[0] ?? "default"),
                  name: "Tenant por defecto",
                  status: "active",
                  plan_code: "starter",
                },
              ],
            };
          }

          if (normalized.startsWith("SELECT * FROM installations")) {
            if (normalized.includes("WHERE tenant_id = ?")) {
              const tenantId = String(call.bound?.[0] ?? "default");
              return {
                results: state.installations.filter(
                  (row) => String(row.tenant_id ?? "default") === tenantId,
                ),
              };
            }
            return { results: state.installations };
          }

          return { results: [] };
        },
        async run() {
          return { meta: {} };
        },
      };
    },
  };
}

async function workerFetch(request, env = {}) {
  const mergedEnv = {
    API_TOKEN: DEFAULT_API_TOKEN,
    API_SECRET: DEFAULT_API_SECRET,
    ASSETS: createDashboardAssetsBinding(),
    ...env,
  };

  const url = new URL(request.url);
  const isWebRoute = url.pathname.startsWith("/web/");
  const isPublicRoot = request.method === "GET" && url.pathname === "/";
  const isHealth = request.method === "GET" && url.pathname === "/health";
  const hasHmacHeaders =
    request.headers.has("X-API-Token") ||
    request.headers.has("X-Request-Timestamp") ||
    request.headers.has("X-Request-Signature");

  let signedRequest = request;

  if (!isWebRoute && !isPublicRoot && !isHealth && !hasHmacHeaders) {
    const bodyBuffer = Buffer.from(await request.clone().arrayBuffer());
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const signature = signRequest({
      method: request.method,
      path: url.pathname,
      timestamp,
      bodyBuffer,
      secret: mergedEnv.API_SECRET,
    });

    const headers = new Headers(request.headers);
    headers.set("X-API-Token", mergedEnv.API_TOKEN);
    headers.set("X-Request-Timestamp", timestamp);
    headers.set("X-Request-Signature", signature);

    signedRequest = new Request(request.url, {
      method: request.method,
      headers,
      body: bodyBuffer.length > 0 ? bodyBuffer : undefined,
    });
  }

  return worker.fetch(signedRequest, mergedEnv);
}

test("smoke: GET /health responds with ok", async () => {
  const response = await workerFetch(new Request("https://worker.example/health"));
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(typeof body.now, "string");
});

test("smoke: GET / responds with service metadata", async () => {
  const response = await workerFetch(new Request("https://worker.example/"));
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.service, "driver-manager-api");
  assert.equal(body.status, "ok");
  assert.equal(typeof body.docs, "object");
  assert.equal(body.docs.health, "/health");
});

test("smoke: GET /web/dashboard responds with dashboard html and security headers", async () => {
  const response = await workerFetch(new Request("https://worker.example/web/dashboard"));
  const html = await response.text();
  const csp = response.headers.get("Content-Security-Policy") || "";

  assert.equal(response.status, 200);
  assert.match(response.headers.get("Content-Type") || "", /text\/html/i);
  assert.match(html, /<html/i);
  assert.match(csp, /frame-ancestors 'none'/);
  assert.match(csp, /script-src 'self' https:\/\/cdn\.jsdelivr\.net/);
});

test("smoke: signed GET /installations returns rows from D1", async () => {
  const db = createSmokeDb({
    installations: [
      { id: 10, tenant_id: "default", driver_brand: "Zebra", status: "success" },
      { id: 11, tenant_id: "default", driver_brand: "Magicard", status: "failed" },
    ],
  });

  const response = await workerFetch(new Request("https://worker.example/installations"), {
    DB: db,
  });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(Array.isArray(body), true);
  assert.equal(body.length, 2);
  assert.equal(body[0].id, 10);
  assert.ok(db.calls.some((call) => call.sql.includes("FROM tenants")));
  assert.ok(db.calls.some((call) => call.sql.includes("FROM installations")));
});
