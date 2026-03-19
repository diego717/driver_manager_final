import assert from "node:assert/strict";
import test from "node:test";

import { HttpError } from "../../worker/lib/core.js";
import { createWebAuthRouteHandlers } from "../../worker/auth/web.js";

function jsonResponse(_request, _env, _corsPolicy, body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
    },
  });
}

function createWebAuthDeps(overrides = {}) {
  return {
    HttpError,
    DEFAULT_REALTIME_TENANT_ID: "default",
    WEB_DEFAULT_ROLE: "admin",
    MAX_WEB_AUTH_DEFAULT_BODY_BYTES: 64 * 1024,
    MAX_WEB_AUTH_IMPORT_BODY_BYTES: 2 * 1024 * 1024,
    jsonResponse,
    normalizeOptionalString(value, fallback = "") {
      if (value === null || value === undefined) {
        return fallback;
      }
      return String(value).trim();
    },
    normalizeRealtimeTenantId(value) {
      return String(value || "").trim().toLowerCase() || "default";
    },
    parsePageLimit() {
      return 100;
    },
    parseUsernameIdCursor() {
      return null;
    },
    async readJsonOrThrowBadRequest() {
      return {};
    },
    ensureWebSessionSecret() {},
    normalizeWebUsername(value) {
      return String(value || "").trim().toLowerCase();
    },
    validateWebUsername(value) {
      return String(value);
    },
    buildWebLoginRateLimitIdentifier() {
      return "login-rate-limit";
    },
    buildWebBootstrapRateLimitIdentifier() {
      return "bootstrap-rate-limit";
    },
    ensureDbBinding() {},
    async checkWebLoginRateLimit() {},
    async authenticateWebUserByCredentials() {
      return {
        id: 7,
        username: "admin_root",
        role: "admin",
        tenant_id: "tenant-a",
      };
    },
    async recordFailedWebLoginAttempt() {},
    async logWebAuditEvent() {},
    buildWebAuthFailureAuditDetails(error) {
      return {
        reason: String(error?.message || ""),
      };
    },
    async clearWebLoginRateLimit() {},
    async rotateWebSessionVersion() {
      return 3;
    },
    async buildWebAccessToken() {
      return {
        token: "token-abc",
        expires_in: 3600,
      };
    },
    buildWebSessionAuthPayload(token, user, extra = {}) {
      return {
        success: true,
        authenticated: true,
        token_type: "Bearer",
        access_token: token.token,
        expires_in: token.expires_in,
        user,
        ...extra,
      };
    },
    buildWebSessionCookie(token, expiresIn) {
      return `__Host-web_session=${token}; Max-Age=${expiresIn}; Path=/;`;
    },
    async verifyWebAccessToken() {
      return {
        role: "admin",
        sub: "admin_root",
        tenant_id: "tenant-a",
        user_id: 7,
      };
    },
    buildWebPasswordVerifyRateLimitIdentifier() {
      return "verify-rate-limit";
    },
    async checkWebPasswordVerifyRateLimit() {},
    async verifyCurrentWebUserPassword() {
      return {
        id: 7,
        role: "admin",
        tenant_id: "tenant-a",
      };
    },
    async recordFailedWebPasswordVerifyAttempt() {},
    async clearWebPasswordVerifyRateLimit() {},
    async countWebUsers() {
      return 0;
    },
    timingSafeEqual(left, right) {
      return left === right;
    },
    validateWebPassword(value) {
      return String(value);
    },
    normalizeWebRole(value) {
      return String(value || "viewer").toLowerCase();
    },
    async createWebUser(_env, payload) {
      return {
        id: 8,
        username: payload.username,
        role: payload.role,
        tenant_id: payload.tenantId,
      };
    },
    canManageAllTenants(role) {
      return role === "super_admin";
    },
    async listWebUsers() {
      return {
        users: [],
        hasMore: false,
        nextCursor: null,
      };
    },
    requireAdminRole() {},
    assertSameTenantOrSuperAdmin() {},
    async getWebUserById() {
      return null;
    },
    parsePositiveInt(value) {
      return Number(value);
    },
    parseBooleanOrNull(value) {
      if (value === null || value === undefined) return null;
      return Boolean(value);
    },
    normalizeActiveFlag(value, fallback = 1) {
      return Number(value ?? fallback) ? 1 : 0;
    },
    async updateWebUserRoleAndStatus() {},
    async invalidateWebSessionVersion() {},
    serializeWebUser(user) {
      return user;
    },
    async forceResetWebUserPassword() {},
    normalizeImportedWebUser(user) {
      return user;
    },
    async upsertWebUserFromImport() {
      return "created";
    },
    buildWebSessionCookieClearHeader() {
      return "__Host-web_session=; Max-Age=0; Path=/;";
    },
    async resolveCurrentWebSessionUser(_env, session) {
      return {
        username: session.sub,
        role: session.role,
        tenant_id: session.tenant_id,
        is_active: true,
      };
    },
    buildWebSessionStatusPayload(session, user) {
      return {
        success: true,
        authenticated: true,
        token_type: "Bearer",
        expires_in: 3600,
        expires_at: "2026-01-01T00:00:00.000Z",
        user,
      };
    },
    ...overrides,
  };
}

test("web auth routes authenticate login requests and set the session cookie", async () => {
  const auditEvents = [];
  const { handleWebAuthLoginRoute } = createWebAuthRouteHandlers(createWebAuthDeps({
    async readJsonOrThrowBadRequest() {
      return {
        username: "ADMIN_ROOT",
        password: "StrongPass#2026",
      };
    },
    async logWebAuditEvent(_env, _request, payload) {
      auditEvents.push(payload);
    },
  }));

  const response = await handleWebAuthLoginRoute(
    new Request("https://worker.example/web/auth/login", { method: "POST" }),
    {},
    {},
  );
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.user.username, "admin_root");
  assert.match(response.headers.get("Set-Cookie"), /__Host-web_session=token-abc/);
  assert.equal(auditEvents[0].action, "web_login_success");
});

test("web auth routes paginate users under the authenticated tenant", async () => {
  const { handleWebAuthUsersListRoute } = createWebAuthRouteHandlers(createWebAuthDeps({
    parsePageLimit(searchParams) {
      assert.equal(searchParams.get("limit"), "50");
      return 50;
    },
    parseUsernameIdCursor(value) {
      assert.equal(value, "ops|9");
      return {
        username: "ops",
        id: 9,
      };
    },
    async listWebUsers(_env, options) {
      assert.deepEqual(options, {
        tenantId: "tenant-a",
        limit: 50,
        cursor: {
          username: "ops",
          id: 9,
        },
      });
      return {
        users: [
          {
            id: 10,
            username: "viewer_1",
            role: "viewer",
            tenant_id: "tenant-a",
          },
        ],
        hasMore: true,
        nextCursor: "next-1",
      };
    },
  }));

  const response = await handleWebAuthUsersListRoute(
    new Request("https://worker.example/web/auth/users?limit=50&cursor=ops%7C9", {
      method: "GET",
    }),
    {},
    {},
  );
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(body.pagination, {
    limit: 50,
    has_more: true,
    next_cursor: "next-1",
  });
  assert.equal(body.users[0].username, "viewer_1");
});

test("web auth route dispatcher ignores non-auth paths", async () => {
  const { handleWebAuthRoute } = createWebAuthRouteHandlers(createWebAuthDeps());

  const response = await handleWebAuthRoute(
    new Request("https://worker.example/web/installations", { method: "GET" }),
    {},
    ["installations"],
    {},
  );

  assert.equal(response, null);
});
