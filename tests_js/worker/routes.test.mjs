import assert from "node:assert/strict";
import test from "node:test";

import { createDevicesRouteHandlers } from "../../worker/routes/devices.js";
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
