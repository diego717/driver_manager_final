import assert from "node:assert/strict";
import test from "node:test";

import { HttpError } from "../../worker/lib/core.js";
import { createLegacyAuthHelpers } from "../../worker/auth/legacy.js";

const EMPTY_BODY_SHA256_HEX = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

function createLegacyAuthTestKit(overrides = {}) {
  const replayNonceCalls = [];
  const helpers = createLegacyAuthHelpers({
    HttpError,
    LEGACY_API_TENANT_ENV_NAME: "DRIVER_MANAGER_API_TENANT_ID",
    AUTH_WINDOW_SECONDS: 300,
    AUTH_NONCE_PATTERN: /^[A-Za-z0-9._:-]{16,128}$/,
    AUTH_NONCE_MAX_LENGTH: 128,
    MAX_AUTH_INMEM_BODY_HASH_BYTES: 256 * 1024,
    EMPTY_BODY_SHA256_HEX,
    normalizeOptionalString(value, fallback = "") {
      if (value === null || value === undefined) return fallback;
      return String(value).trim();
    },
    normalizeRealtimeTenantId(value) {
      return String(value || "").trim().toLowerCase() || "default";
    },
    nowUnixSeconds() {
      return 1000;
    },
    timingSafeEqual(left, right) {
      return left === right;
    },
    async sha256Hex() {
      return "b".repeat(64);
    },
    async hmacSha256Hex(secret, message) {
      return `sig:${secret}:${message}`;
    },
    async consumeAuthReplayNonce(_env, payload) {
      replayNonceCalls.push(payload);
    },
    ...overrides,
  });

  return {
    helpers,
    replayNonceCalls,
  };
}

test("legacy auth helpers validate HMAC requests and return the configured tenant", async () => {
  const { helpers, replayNonceCalls } = createLegacyAuthTestKit();
  const nonce = "nonce-123456789012";
  const timestamp = "1000";
  const url = new URL("https://worker.example/installations");
  const signature = `sig:secret-1:GET|/installations|${timestamp}|${EMPTY_BODY_SHA256_HEX}|${nonce}`;
  const request = new Request(url, {
    headers: {
      "X-API-Token": "token-1",
      "X-Request-Timestamp": timestamp,
      "X-Request-Signature": signature,
      "X-Request-Nonce": nonce,
      "X-Tenant-Id": "Tenant-A",
    },
  });
  const tenantId = await helpers.verifyAuth(
    request,
    {
      DRIVER_MANAGER_API_TOKEN: "token-1",
      DRIVER_MANAGER_API_SECRET: "secret-1",
      DRIVER_MANAGER_API_TENANT_ID: "tenant-a",
    },
    url,
  );

  assert.equal(tenantId, "tenant-a");
  assert.deepEqual(replayNonceCalls, [
    {
      token: "token-1",
      timestamp: 1000,
      nonce,
    },
  ]);
});

test("legacy auth helpers require the body hash on photo uploads", async () => {
  const { helpers } = createLegacyAuthTestKit();
  const request = new Request("https://worker.example/incidents/55/photos", {
    method: "POST",
    headers: {
      "X-API-Token": "token-1",
      "X-Request-Timestamp": "1000",
      "X-Request-Signature": "sig:unused",
      "X-Request-Nonce": "nonce-123456789012",
    },
    body: new Uint8Array([1, 2, 3]),
  });

  await assert.rejects(
    () =>
      helpers.verifyAuth(
        request,
        {
          DRIVER_MANAGER_API_TOKEN: "token-1",
          DRIVER_MANAGER_API_SECRET: "secret-1",
          DRIVER_MANAGER_API_TENANT_ID: "tenant-a",
        },
        new URL(request.url),
      ),
    (error) =>
      error instanceof HttpError &&
      error.status === 401 &&
      error.message === "Falta header X-Body-SHA256 para upload binario. Actualiza el cliente.",
  );
});
