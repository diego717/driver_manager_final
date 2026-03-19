import assert from "node:assert/strict";
import test from "node:test";

import { HttpError } from "../../worker/lib/core.js";
import { createAuthSecurityHelpers } from "../../worker/auth/security.js";

function createKvStore() {
  const store = new Map();
  return {
    async get(key) {
      return store.has(key) ? store.get(key) : null;
    },
    async put(key, value) {
      store.set(key, value);
    },
    async delete(key) {
      store.delete(key);
    },
  };
}

function createAuthSecurityTestKit(overrides = {}) {
  const auditEvents = [];
  const helpers = createAuthSecurityHelpers({
    HttpError,
    DEFAULT_REALTIME_TENANT_ID: "default",
    WEB_LOGIN_RATE_LIMIT_MAX_ATTEMPTS: 2,
    WEB_LOGIN_RATE_LIMIT_LOCKOUT_SECONDS: 900,
    WEB_PASSWORD_VERIFY_RATE_LIMIT_MAX_ATTEMPTS: 3,
    WEB_PASSWORD_VERIFY_RATE_LIMIT_LOCKOUT_SECONDS: 600,
    WEB_AUTH_ALLOW_INSECURE_FALLBACK_ENV: "ALLOW_INSECURE_WEB_AUTH_FALLBACK",
    AUTH_NONCE_TTL_SECONDS: 360,
    AUTH_NONCE_PATTERN: /^[A-Za-z0-9._:-]{16,128}$/,
    AUTH_NONCE_MAX_LENGTH: 128,
    MAX_AUTH_INMEM_NONCE_TRACKED: 4,
    normalizeOptionalString(value, fallback = "") {
      if (value === null || value === undefined) return fallback;
      return String(value).trim();
    },
    normalizeRealtimeTenantId(value) {
      return String(value || "").trim().toLowerCase() || "default";
    },
    normalizeWebUsername(value) {
      return String(value || "").trim().toLowerCase();
    },
    nowUnixSeconds() {
      return 1000;
    },
    async sha256Hex() {
      return "a".repeat(64);
    },
    sanitizeStorageSegment(value, fallback = "default", maxLength = 96) {
      return (String(value || fallback) || fallback).slice(0, maxLength);
    },
    async logAuditEvent(_env, payload) {
      auditEvents.push(payload);
    },
    ...overrides,
  });

  return {
    helpers,
    auditEvents,
  };
}

test("auth security helpers enforce the web login rate limit", async () => {
  const { helpers } = createAuthSecurityTestKit();
  const env = {
    RATE_LIMIT_KV: createKvStore(),
  };
  const identifier = helpers.buildWebLoginRateLimitIdentifier(
    new Request("https://worker.example/web/auth/login", {
      headers: {
        "CF-Connecting-IP": "203.0.113.10",
      },
    }),
    "ADMIN_ROOT",
  );

  await helpers.recordFailedWebLoginAttempt(env, identifier);
  await helpers.recordFailedWebLoginAttempt(env, identifier);

  await assert.rejects(
    () => helpers.checkWebLoginRateLimit(env, identifier),
    (error) => error instanceof HttpError && error.status === 429,
  );

  await helpers.clearWebLoginRateLimit(env, identifier);
  await helpers.checkWebLoginRateLimit(env, identifier);
});

test("auth security helpers reject replayed nonces without kv storage", async () => {
  const { helpers } = createAuthSecurityTestKit();
  const noncePayload = {
    token: "token-1",
    timestamp: 1000,
    nonce: "nonce-123456789012",
  };

  await helpers.consumeAuthReplayNonce({}, noncePayload);

  await assert.rejects(
    () => helpers.consumeAuthReplayNonce({}, noncePayload),
    (error) =>
      error instanceof HttpError &&
      error.status === 401 &&
      error.message === "Nonce ya utilizado.",
  );
});

test("auth security helpers log normalized web audit events with the request ip", async () => {
  const { helpers, auditEvents } = createAuthSecurityTestKit();

  await helpers.logWebAuditEvent(
    {},
    new Request("https://worker.example/web/auth/login", {
      headers: {
        "X-Forwarded-For": "198.51.100.24, 10.0.0.1",
      },
    }),
    {
      action: "web_login_success",
      username: "Admin Root",
      tenantId: "Tenant-A",
      details: {
        role: "admin",
      },
    },
  );

  assert.deepEqual(auditEvents, [
    {
      action: "web_login_success",
      username: "Admin Root",
      success: true,
      tenantId: "tenant-a",
      details: {
        role: "admin",
      },
      ipAddress: "198.51.100.24",
      platform: "web",
    },
  ]);
});
