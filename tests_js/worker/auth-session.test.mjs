import assert from "node:assert/strict";
import test from "node:test";

import { HttpError } from "../../worker/lib/core.js";
import { createWebSessionHelpers } from "../../worker/auth/web-session.js";

function createWebSessionKv() {
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

function createWebSessionTestKit(overrides = {}) {
  const helpers = createWebSessionHelpers({
    HttpError,
    DEFAULT_REALTIME_TENANT_ID: "default",
    WEB_DEFAULT_ROLE: "admin",
    WEB_BEARER_TOKEN_TYPE: "Bearer",
    WEB_ACCESS_TTL_SECONDS: 3600,
    WEB_SESSION_COOKIE_NAME: "__Host-web_session",
    WEB_SESSION_STORE_TTL_SECONDS: 3660,
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
    normalizeWebUsername(value) {
      return String(value || "").trim().toLowerCase();
    },
    async hmacSha256Hex(secret, message) {
      return Buffer.from(`${secret}:${message}`, "utf8")
        .toString("hex")
        .padEnd(64, "0")
        .slice(0, 64);
    },
    timingSafeEqual(left, right) {
      return left === right;
    },
    base64UrlEncodeUtf8(value) {
      return Buffer.from(String(value), "utf8").toString("base64url");
    },
    base64UrlDecodeUtf8(value) {
      return Buffer.from(String(value), "base64url").toString("utf8");
    },
    serializeWebUser(user) {
      return {
        id: Number(user.id),
        username: String(user.username),
        role: String(user.role),
        tenant_id: String(user.tenant_id),
        is_active: Boolean(user.is_active),
      };
    },
    async getWebUserById() {
      return null;
    },
    async getWebUserByUsername(_env, username) {
      return {
        id: 7,
        username,
        role: "admin",
        tenant_id: "tenant-a",
        is_active: 1,
      };
    },
    ensureDbBinding(env) {
      if (!env.DB) {
        throw new Error("DB missing");
      }
    },
    normalizeActiveFlag(value, fallback = 1) {
      return Number(value ?? fallback) ? 1 : 0;
    },
    ...overrides,
  });

  return {
    helpers,
  };
}

test("web session helpers build and verify bearer tokens", async () => {
  const { helpers } = createWebSessionTestKit();
  const env = {
    WEB_SESSION_SECRET: "secret-1",
    WEB_SESSION_KV: createWebSessionKv(),
  };
  const sessionVersion = await helpers.rotateWebSessionVersion(env, 7);
  const token = await helpers.buildWebAccessToken(env, {
    username: "ADMIN_ROOT",
    role: "admin",
    user_id: 7,
    session_version: sessionVersion,
    tenant_id: "Tenant-A",
  });
  const session = await helpers.verifyWebAccessToken(
    new Request("https://worker.example/web/auth/me", {
      headers: {
        Authorization: `Bearer ${token.token}`,
      },
    }),
    {
      ...env,
      DB: {},
    },
  );
  const statusPayload = helpers.buildWebSessionStatusPayload(
    {
      ...session,
      exp: 4600,
    },
    {
      id: 7,
      username: "admin_root",
      role: "admin",
      tenant_id: "tenant-a",
      is_active: 1,
    },
  );

  assert.equal(token.tenant_id, "tenant-a");
  assert.equal(session.sub, "admin_root");
  assert.equal(statusPayload.token_type, "Bearer");
  assert.match(helpers.buildWebSessionCookie(token.token), /^__Host-web_session=/);
});

test("web session helpers invalidate cookies and reject closed sessions", async () => {
  const { helpers } = createWebSessionTestKit();
  const env = {
    WEB_SESSION_SECRET: "secret-1",
    WEB_SESSION_KV: createWebSessionKv(),
  };
  const sessionVersion = await helpers.rotateWebSessionVersion(env, 7);
  const token = await helpers.buildWebAccessToken(env, {
    username: "admin_root",
    role: "admin",
    user_id: 7,
    session_version: sessionVersion,
    tenant_id: "tenant-a",
  });

  await helpers.invalidateWebSessionVersion(env, 7);

  await assert.rejects(
    () =>
      helpers.verifyWebAccessToken(
        new Request("https://worker.example/web/auth/me", {
          headers: {
            Cookie: `__Host-web_session=${encodeURIComponent(token.token)}`,
          },
        }),
        env,
      ),
    (error) =>
      error instanceof HttpError &&
      error.status === 401 &&
      error.message === "Sesion web invalida o cerrada.",
  );

  assert.equal(
    helpers.buildWebSessionCookieClearHeader(),
    "__Host-web_session=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0",
  );
});

test("web session helpers reject inactive users while resolving the current session user", async () => {
  const { helpers } = createWebSessionTestKit({
    async getWebUserById() {
      return {
        id: 7,
        username: "admin_root",
        role: "admin",
        tenant_id: "tenant-a",
        is_active: 0,
      };
    },
  });

  await assert.rejects(
    () =>
      helpers.resolveCurrentWebSessionUser(
        {
          DB: {},
        },
        {
          user_id: 7,
          sub: "admin_root",
        },
      ),
    (error) =>
      error instanceof HttpError &&
      error.status === 403 &&
      error.message === "Usuario web inactivo.",
  );
});
