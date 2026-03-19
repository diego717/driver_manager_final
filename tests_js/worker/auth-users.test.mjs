import assert from "node:assert/strict";
import test from "node:test";

import bcrypt from "bcryptjs";

import { HttpError } from "../../worker/lib/core.js";
import { createWebUserAuthHelpers } from "../../worker/auth/users.js";

function normalizeSql(sql) {
  return String(sql).replace(/\s+/g, " ").trim();
}

function createAuthUsersTestKit(overrides = {}) {
  const helpers = createWebUserAuthHelpers({
    HttpError,
    WEB_USERNAME_PATTERN: /^[a-z0-9._-]{3,64}$/,
    WEB_PASSWORD_MIN_LENGTH: 12,
    WEB_PASSWORD_SPECIAL_CHARS: "!@#$%^&*()_+-=[]{}|;:,.<>?",
    WEB_PASSWORD_PBKDF2_ITERATIONS: 100000,
    WEB_PASSWORD_KEY_LENGTH_BYTES: 32,
    WEB_DEFAULT_ROLE: "admin",
    WEB_HASH_TYPE_PBKDF2: "pbkdf2_sha256",
    WEB_HASH_TYPE_BCRYPT: "bcrypt",
    WEB_HASH_TYPE_LEGACY_PBKDF2: "legacy_pbkdf2_hex",
    WEB_ALLOWED_HASH_TYPES: new Set(["pbkdf2_sha256", "bcrypt", "legacy_pbkdf2_hex"]),
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
    nowIso() {
      return "2026-03-18T12:00:00.000Z";
    },
    timingSafeEqual(left, right) {
      return left === right;
    },
    buildUsernameIdCursor(username, id) {
      return `cursor:${username}:${id}`;
    },
    bytesToBase64Url(value) {
      return Buffer.from(value).toString("base64url");
    },
    base64UrlToBytes(value) {
      return new Uint8Array(Buffer.from(String(value), "base64url"));
    },
    ...overrides,
  });

  return {
    helpers,
  };
}

function createDbEnv({ userByUsername = null, listedUsers = [] } = {}) {
  const runs = [];
  return {
    runs,
    env: {
      DB: {
        prepare(sql) {
          const normalized = normalizeSql(sql);
          return {
            bind(...bindings) {
              return {
                async all() {
                  if (normalized.includes("SELECT COUNT(*) AS total FROM web_users")) {
                    return { results: [{ total: listedUsers.length }] };
                  }
                  if (normalized.includes("FROM web_users WHERE username = ? LIMIT 1")) {
                    return { results: userByUsername ? [userByUsername] : [] };
                  }
                  if (normalized.includes("FROM web_users WHERE id = ? LIMIT 1")) {
                    return {
                      results: userByUsername && Number(userByUsername.id) === Number(bindings[0])
                        ? [userByUsername]
                        : [],
                    };
                  }
                  if (normalized.includes("ORDER BY username ASC, id ASC LIMIT ?")) {
                    return { results: listedUsers };
                  }
                  throw new Error(`Unexpected all() SQL: ${normalized}`);
                },
                async run() {
                  runs.push({
                    sql: normalized,
                    bindings,
                  });
                  return {
                    meta: {
                      last_row_id: 11,
                    },
                  };
                },
              };
            },
            async all() {
              if (normalized.includes("SELECT COUNT(*) AS total FROM web_users")) {
                return { results: [{ total: listedUsers.length }] };
              }
              throw new Error(`Unexpected prepare().all() SQL: ${normalized}`);
            },
          };
        },
      },
    },
  };
}

test("web user auth helpers validate password complexity", () => {
  const { helpers } = createAuthUsersTestKit();

  assert.equal(
    helpers.validateWebPassword("StrongPass#2026"),
    "StrongPass#2026",
  );

  assert.throws(
    () => helpers.validateWebPassword("weakpass"),
    (error) =>
      error instanceof HttpError &&
      error.status === 400 &&
      error.message.includes("Debe contener al menos una letra mayuscula."),
  );
});

test("web user auth helpers paginate user listings with a username cursor", async () => {
  const { helpers } = createAuthUsersTestKit();
  const { env } = createDbEnv({
    listedUsers: [
      {
        id: 9,
        username: "ops_user",
        role: "viewer",
        is_active: 1,
        created_at: "2026-03-18T12:00:00.000Z",
        updated_at: "2026-03-18T12:00:00.000Z",
        last_login_at: null,
        tenant_id: "tenant-a",
      },
      {
        id: 10,
        username: "viewer_1",
        role: "viewer",
        is_active: 1,
        created_at: "2026-03-18T12:00:00.000Z",
        updated_at: "2026-03-18T12:00:00.000Z",
        last_login_at: null,
        tenant_id: "tenant-a",
      },
      {
        id: 11,
        username: "viewer_2",
        role: "viewer",
        is_active: 1,
        created_at: "2026-03-18T12:00:00.000Z",
        updated_at: "2026-03-18T12:00:00.000Z",
        last_login_at: null,
        tenant_id: "tenant-a",
      },
    ],
  });

  const page = await helpers.listWebUsers(env, {
    tenantId: "tenant-a",
    limit: 2,
    cursor: {
      username: "admin_root",
      id: 5,
    },
  });

  assert.equal(page.users.length, 2);
  assert.equal(page.users[0].username, "ops_user");
  assert.equal(page.hasMore, true);
  assert.equal(page.nextCursor, "cursor:viewer_1:10");
});

test("web user auth helpers authenticate bcrypt users and upgrade them to pbkdf2", async () => {
  const { helpers } = createAuthUsersTestKit();
  const bcryptHash = await bcrypt.hash("StrongPass#2026", 4);
  const { env, runs } = createDbEnv({
    userByUsername: {
      id: 7,
      username: "admin_root",
      password_hash: bcryptHash,
      password_hash_type: "bcrypt",
      role: "admin",
      is_active: 1,
      tenant_id: "tenant-a",
      created_at: "2026-03-18T12:00:00.000Z",
      updated_at: "2026-03-18T12:00:00.000Z",
      last_login_at: null,
    },
  });

  const user = await helpers.authenticateWebUserByCredentials(env, {
    username: "admin_root",
    password: "StrongPass#2026",
  });

  assert.equal(user.username, "admin_root");
  assert.equal(user.password_hash_type, "pbkdf2_sha256");
  assert.equal(runs.length, 2);
  assert.match(runs[0].sql, /UPDATE web_users SET password_hash = \?, password_hash_type = \?, updated_at = \? WHERE id = \?/);
  assert.equal(runs[0].bindings[1], "pbkdf2_sha256");
  assert.match(runs[1].sql, /UPDATE web_users SET last_login_at = \?, updated_at = \? WHERE id = \?/);
});
