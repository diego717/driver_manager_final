import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import bcrypt from "bcryptjs";

import worker from "../worker.js";

const DEFAULT_API_TOKEN = "token-123";
const DEFAULT_API_SECRET = "secret-abc";

async function workerFetch(request, env = {}) {
  const mergedEnv = {
    API_TOKEN: DEFAULT_API_TOKEN,
    API_SECRET: DEFAULT_API_SECRET,
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

function normalizeSql(sql) {
  return sql.replace(/\s+/g, " ").trim();
}

function sha256Hex(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function signRequest({ method, path, timestamp, bodyBuffer, secret }) {
  const bodyHash = sha256Hex(bodyBuffer || Buffer.alloc(0));
  const canonical = `${method.toUpperCase()}|${path}|${timestamp}|${bodyHash}`;
  return crypto.createHmac("sha256", secret).update(canonical).digest("hex");
}

function createMockDB({
  installations = [],
  byBrand = [],
  incidents = [],
  incidentPhotos = [],
  auditLogs = [],
  webUsers = [],
} = {}) {
  const calls = [];
  const state = {
    installations: installations.map((row) => ({ ...row })),
    byBrand: byBrand.map((row) => ({ ...row })),
    incidents: incidents.map((row) => ({ ...row })),
    incidentPhotos: incidentPhotos.map((row) => ({ ...row })),
    auditLogs: auditLogs.map((row) => ({ ...row })),
    webUsers: webUsers.map((row) => ({
      password_hash_type: "pbkdf2_sha256",
      is_active: 1,
      ...row,
    })),
  };

  let nextInstallationId = 100;
  let nextIncidentId = 1000;
  let nextPhotoId = 2000;
  let nextAuditLogId = 2500;
  let nextWebUserId = 3000;

  const normalizeStatus = (value) => String(value ?? "").toLowerCase();
  const parseDate = (value) => {
    if (!value) return null;
    const parsed = new Date(String(value));
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  };
  const applyDateRange = (rows, startIso, endIso) => {
    const start = parseDate(startIso);
    const end = parseDate(endIso);
    return rows.filter((row) => {
      const ts = parseDate(row.timestamp);
      if (!ts) return false;
      if (start && ts < start) return false;
      if (end && ts >= end) return false;
      return true;
    });
  };
  const round2 = (value) => Math.round(value * 100) / 100;

  return {
    calls,
    state,
    prepare(sql) {
      const normalized = normalizeSql(sql);
      const call = { sql: normalized, bound: null };
      calls.push(call);

      return {
        bind(...args) {
          call.bound = args;
          return this;
        },
        async all() {
          if (normalized.startsWith("SELECT * FROM installations ORDER BY timestamp DESC")) {
            return { results: state.installations };
          }

          if (normalized.startsWith("SELECT * FROM installations WHERE id = ? LIMIT 1")) {
            const id = Number(call.bound?.[0]);
            const row = state.installations.find((item) => Number(item.id) === id);
            return { results: row ? [row] : [] };
          }

          if (normalized.includes("COUNT(*) AS total_installations")) {
            const start = call.bound?.[1] ?? call.bound?.[0] ?? null;
            const end = call.bound?.[3] ?? call.bound?.[2] ?? null;
            const filtered = applyDateRange(state.installations, start, end);

            const total = filtered.length;
            const successful = filtered.filter((row) => normalizeStatus(row.status) === "success").length;
            const failed = filtered.filter((row) => normalizeStatus(row.status) === "failed").length;
            const seconds = filtered
              .map((row) => Number(row.installation_time_seconds))
              .filter((value) => Number.isFinite(value) && value > 0);
            const avgMinutes = seconds.length > 0 ? round2(seconds.reduce((sum, value) => sum + value, 0) / seconds.length / 60) : 0;
            const uniqueClients = new Set(
              filtered
                .map((row) => String(row.client_name ?? "").trim())
                .filter((value) => value.length > 0),
            ).size;

            return {
              results: [
                {
                  total_installations: total,
                  successful_installations: successful,
                  failed_installations: failed,
                  success_rate: total > 0 ? round2((successful / total) * 100) : 0,
                  average_time_minutes: avgMinutes,
                  unique_clients: uniqueClients,
                },
              ],
            };
          }

          if (normalized.startsWith("SELECT driver_brand AS brand, COUNT(*) AS count FROM installations")) {
            const start = call.bound?.[1] ?? call.bound?.[0] ?? null;
            const end = call.bound?.[3] ?? call.bound?.[2] ?? null;
            const filtered = applyDateRange(state.installations, start, end);
            const counts = new Map();

            for (const row of filtered) {
              const brand = String(row.driver_brand ?? "").trim();
              if (!brand) continue;
              counts.set(brand, (counts.get(brand) || 0) + 1);
            }

            return {
              results: [...counts.entries()].map(([brand, count]) => ({ brand, count })),
            };
          }

          if (
            normalized.startsWith(
              "SELECT TRIM(driver_brand) AS brand, TRIM(driver_version) AS version, COUNT(*) AS count FROM installations",
            )
          ) {
            const start = call.bound?.[1] ?? call.bound?.[0] ?? null;
            const end = call.bound?.[3] ?? call.bound?.[2] ?? null;
            const filtered = applyDateRange(state.installations, start, end);
            const counts = new Map();

            for (const row of filtered) {
              const brand = String(row.driver_brand ?? "").trim();
              const version = String(row.driver_version ?? "").trim();
              const key = `${brand} ${version}`.trim();
              if (!key) continue;
              counts.set(key, {
                brand,
                version,
                count: (counts.get(key)?.count || 0) + 1,
              });
            }

            return {
              results: [...counts.values()],
            };
          }

          if (normalized.startsWith("SELECT driver_brand, COUNT(*) as count FROM installations")) {
            return { results: state.byBrand };
          }

          if (normalized.startsWith("SELECT id, notes, installation_time_seconds FROM installations WHERE id = ?")) {
            const id = Number(call.bound?.[0]);
            const row = state.installations.find((item) => Number(item.id) === id);
            return { results: row ? [row] : [] };
          }

          if (
            normalized.startsWith(
              "SELECT id, installation_id, reporter_username, note, time_adjustment_seconds, severity, source, created_at FROM incidents WHERE installation_id = ?",
            )
          ) {
            const installationId = Number(call.bound?.[0]);
            const rows = state.incidents
              .filter((item) => Number(item.installation_id) === installationId)
              .sort((a, b) => Number(b.id) - Number(a.id));
            return { results: rows };
          }

          if (
            normalized.startsWith(
              "SELECT p.id, p.incident_id, p.r2_key, p.file_name, p.content_type, p.size_bytes, p.sha256, p.created_at FROM incident_photos p INNER JOIN incidents i ON i.id = p.incident_id WHERE i.installation_id = ?",
            )
          ) {
            const installationId = Number(call.bound?.[0]);
            const incidentIds = new Set(
              state.incidents
                .filter((item) => Number(item.installation_id) === installationId)
                .map((item) => Number(item.id)),
            );
            const rows = state.incidentPhotos.filter((item) => incidentIds.has(Number(item.incident_id)));
            return { results: rows };
          }

          if (normalized.startsWith("SELECT id, installation_id FROM incidents WHERE id = ?")) {
            const id = Number(call.bound?.[0]);
            const row = state.incidents.find((item) => Number(item.id) === id);
            return { results: row ? [row] : [] };
          }

          if (
            normalized.startsWith(
              "SELECT id, incident_id, r2_key, file_name, content_type, size_bytes, sha256, created_at FROM incident_photos WHERE id = ?",
            )
          ) {
            const id = Number(call.bound?.[0]);
            const row = state.incidentPhotos.find((item) => Number(item.id) === id);
            return { results: row ? [row] : [] };
          }

          if (
            normalized.startsWith(
              "SELECT id, timestamp, action, username, success, details, computer_name, ip_address, platform FROM audit_logs ORDER BY timestamp DESC, id DESC LIMIT ?",
            )
          ) {
            const limit = Math.max(1, Number(call.bound?.[0]) || 100);
            const rows = [...state.auditLogs].sort((a, b) => {
              const byTimestamp = String(b.timestamp ?? "").localeCompare(String(a.timestamp ?? ""));
              if (byTimestamp !== 0) return byTimestamp;
              return Number(b.id) - Number(a.id);
            });
            return { results: rows.slice(0, limit) };
          }

          if (normalized === "SELECT COUNT(*) AS total FROM web_users") {
            return { results: [{ total: state.webUsers.length }] };
          }

          if (
            normalized.startsWith(
              "SELECT id, username, password_hash, password_hash_type, role, is_active, created_at, updated_at, last_login_at FROM web_users WHERE username = ? LIMIT 1",
            )
          ) {
            const username = String(call.bound?.[0] ?? "");
            const row = state.webUsers.find((item) => item.username === username);
            return { results: row ? [row] : [] };
          }

          if (
            normalized.startsWith(
              "SELECT id, username, password_hash, password_hash_type, role, is_active, created_at, updated_at, last_login_at FROM web_users WHERE id = ? LIMIT 1",
            )
          ) {
            const userId = Number(call.bound?.[0]);
            const row = state.webUsers.find((item) => Number(item.id) === userId);
            return { results: row ? [row] : [] };
          }

          if (
            normalized.startsWith(
              "SELECT id, username, role, is_active, created_at, updated_at, last_login_at FROM web_users ORDER BY username ASC",
            )
          ) {
            const rows = [...state.webUsers].sort((a, b) =>
              String(a.username).localeCompare(String(b.username)),
            );
            return {
              results: rows.map((row) => ({
                id: row.id,
                username: row.username,
                role: row.role,
                is_active: row.is_active,
                created_at: row.created_at,
                updated_at: row.updated_at,
                last_login_at: row.last_login_at ?? null,
              })),
            };
          }

          throw new Error(`Unexpected query for .all(): ${normalized}`);
        },
        async run() {
          if (
            normalized.startsWith(
              "INSERT INTO audit_logs (timestamp, action, username, success, details, computer_name, ip_address, platform) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            )
          ) {
            const id = nextAuditLogId++;
            const [timestamp, action, username, success, details, computerName, ipAddress, platform] = call.bound;
            state.auditLogs.push({
              id,
              timestamp,
              action,
              username,
              success,
              details,
              computer_name: computerName,
              ip_address: ipAddress,
              platform,
            });
            return { success: true, meta: { last_row_id: id } };
          }

          if (normalized.startsWith("INSERT INTO installations")) {
            const id = nextInstallationId++;
            const [timestamp, driverBrand, driverVersion, status, clientName, driverDescription, installationTime, osInfo, notes] =
              call.bound;
            state.installations.push({
              id,
              timestamp,
              driver_brand: driverBrand,
              driver_version: driverVersion,
              status,
              client_name: clientName,
              driver_description: driverDescription,
              installation_time_seconds: installationTime,
              os_info: osInfo,
              notes,
            });
            return { success: true, meta: { last_row_id: id } };
          }

          if (normalized.startsWith("UPDATE installations SET notes = ?, installation_time_seconds = ? WHERE id = ?")) {
            const [notes, installationTimeSeconds, id] = call.bound;
            const row = state.installations.find((item) => String(item.id) === String(id));
            if (row) {
              row.notes = notes;
              row.installation_time_seconds = installationTimeSeconds;
            }
            return { success: true };
          }

          if (normalized === "DELETE FROM installations WHERE id = ?") {
            const [id] = call.bound;
            state.installations = state.installations.filter((item) => String(item.id) !== String(id));
            return { success: true };
          }

          if (normalized.startsWith("INSERT INTO incidents (installation_id, reporter_username, note, time_adjustment_seconds, severity, source, created_at)")) {
            const id = nextIncidentId++;
            const [installationId, reporterUsername, note, timeAdjustmentSeconds, severity, source, createdAt] =
              call.bound;
            state.incidents.push({
              id,
              installation_id: installationId,
              reporter_username: reporterUsername,
              note,
              time_adjustment_seconds: timeAdjustmentSeconds,
              severity,
              source,
              created_at: createdAt,
            });
            return { success: true, meta: { last_row_id: id } };
          }

          if (normalized.startsWith("INSERT INTO incident_photos (incident_id, r2_key, file_name, content_type, size_bytes, sha256, created_at)")) {
            const id = nextPhotoId++;
            const [incidentId, r2Key, fileName, contentType, sizeBytes, sha256, createdAt] = call.bound;
            state.incidentPhotos.push({
              id,
              incident_id: incidentId,
              r2_key: r2Key,
              file_name: fileName,
              content_type: contentType,
              size_bytes: sizeBytes,
              sha256,
              created_at: createdAt,
            });
            return { success: true, meta: { last_row_id: id } };
          }

          if (
            normalized.startsWith(
              "INSERT INTO web_users (username, password_hash, password_hash_type, role, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?)",
            )
          ) {
            const id = nextWebUserId++;
            const [username, passwordHash, passwordHashType, role, createdAt, updatedAt] = call.bound;
            state.webUsers.push({
              id,
              username,
              password_hash: passwordHash,
              password_hash_type: passwordHashType,
              role,
              is_active: 1,
              created_at: createdAt,
              updated_at: updatedAt,
              last_login_at: null,
            });
            return { success: true, meta: { last_row_id: id } };
          }

          if (
            normalized.startsWith(
              "INSERT INTO web_users (username, password_hash, password_hash_type, role, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
            )
          ) {
            const id = nextWebUserId++;
            const [username, passwordHash, passwordHashType, role, isActive, createdAt, updatedAt] = call.bound;
            state.webUsers.push({
              id,
              username,
              password_hash: passwordHash,
              password_hash_type: passwordHashType,
              role,
              is_active: isActive,
              created_at: createdAt,
              updated_at: updatedAt,
              last_login_at: null,
            });
            return { success: true, meta: { last_row_id: id } };
          }

          if (
            normalized.startsWith(
              "UPDATE web_users SET password_hash = ?, password_hash_type = ?, role = ?, is_active = ?, updated_at = ? WHERE id = ?",
            )
          ) {
            const [passwordHash, passwordHashType, role, isActive, updatedAt, id] = call.bound;
            const row = state.webUsers.find((item) => Number(item.id) === Number(id));
            if (row) {
              row.password_hash = passwordHash;
              row.password_hash_type = passwordHashType;
              row.role = role;
              row.is_active = isActive;
              row.updated_at = updatedAt;
            }
            return { success: true };
          }

          if (normalized.startsWith("UPDATE web_users SET last_login_at = ?, updated_at = ? WHERE id = ?")) {
            const [lastLoginAt, updatedAt, id] = call.bound;
            const row = state.webUsers.find((item) => Number(item.id) === Number(id));
            if (row) {
              row.last_login_at = lastLoginAt;
              row.updated_at = updatedAt;
            }
            return { success: true };
          }

          if (normalized.startsWith("UPDATE web_users SET role = ?, is_active = ?, updated_at = ? WHERE id = ?")) {
            const [role, isActive, updatedAt, id] = call.bound;
            const row = state.webUsers.find((item) => Number(item.id) === Number(id));
            if (row) {
              row.role = role;
              row.is_active = isActive;
              row.updated_at = updatedAt;
            }
            return { success: true };
          }

          if (
            normalized.startsWith(
              "UPDATE web_users SET password_hash = ?, password_hash_type = ?, updated_at = ? WHERE id = ?",
            )
          ) {
            const [passwordHash, passwordHashType, updatedAt, id] = call.bound;
            const row = state.webUsers.find((item) => Number(item.id) === Number(id));
            if (row) {
              row.password_hash = passwordHash;
              row.password_hash_type = passwordHashType;
              row.updated_at = updatedAt;
            }
            return { success: true };
          }

          return { success: true };
        },
      };
    },
  };
}

function createMockKV(initialEntries = {}) {
  const store = new Map(
    Object.entries(initialEntries).map(([key, value]) => [String(key), String(value)]),
  );
  const calls = [];

  return {
    calls,
    async get(key) {
      const normalizedKey = String(key);
      calls.push({ op: "get", key: normalizedKey });
      return store.has(normalizedKey) ? store.get(normalizedKey) : null;
    },
    async put(key, value, options = {}) {
      const normalizedKey = String(key);
      const normalizedValue = String(value);
      calls.push({ op: "put", key: normalizedKey, value: normalizedValue, options });
      store.set(normalizedKey, normalizedValue);
    },
    async delete(key) {
      const normalizedKey = String(key);
      calls.push({ op: "delete", key: normalizedKey });
      store.delete(normalizedKey);
    },
  };
}

test("OPTIONS request returns CORS headers", async () => {
  const request = new Request("https://worker.example/installations", { method: "OPTIONS" });
  const response = await workerFetch(request, {});

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), "*");
  assert.match(response.headers.get("Access-Control-Allow-Methods"), /OPTIONS/);
});

test("GET / returns service metadata", async () => {
  const request = new Request("https://worker.example/", { method: "GET" });
  const response = await workerFetch(request, {});
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.service, "driver-manager-api");
  assert.equal(body.status, "ok");
});

test("GET /installations returns DB rows as JSON", async () => {
  const db = createMockDB({
    installations: [{ id: 1, driver_brand: "Zebra", status: "success" }],
  });
  const request = new Request("https://worker.example/installations", { method: "GET" });

  const response = await workerFetch(request, { DB: db });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(body, [{ id: 1, driver_brand: "Zebra", status: "success" }]);
  assert.equal(db.calls.length, 1);
  assert.ok(db.calls[0].sql.startsWith("SELECT * FROM installations"));
});

test("GET /installations applies filters from query params", async () => {
  const db = createMockDB({
    installations: [
      {
        id: 1,
        timestamp: "2026-07-10T10:00:00.000Z",
        driver_brand: "Zebra",
        status: "success",
        client_name: "ACME Norte",
      },
      {
        id: 2,
        timestamp: "2026-07-12T09:00:00.000Z",
        driver_brand: "Magicard",
        status: "failed",
        client_name: "Beta",
      },
      {
        id: 3,
        timestamp: "2026-08-01T00:00:00.000Z",
        driver_brand: "Zebra",
        status: "success",
        client_name: "ACME Sur",
      },
    ],
  });
  const request = new Request(
    "https://worker.example/installations?brand=zebra&status=success&client_name=acme&start_date=2026-07-01T00:00:00.000Z&end_date=2026-08-01T00:00:00.000Z&limit=5",
    { method: "GET" },
  );

  const response = await workerFetch(request, { DB: db });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.length, 1);
  assert.equal(body[0].id, 1);
});

test("POST /installations inserts record with defaults and returns 201", async () => {
  const db = createMockDB();
  const request = new Request("https://worker.example/installations", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      driver_brand: "Magicard",
      driver_version: "2.0.0",
    }),
  });

  const response = await workerFetch(request, { DB: db });
  const body = await response.json();

  assert.equal(response.status, 201);
  assert.deepEqual(body, { success: true });

  const insertCall = db.calls.find((c) => c.sql.startsWith("INSERT INTO installations"));
  assert.ok(insertCall);
  assert.equal(insertCall.bound.length, 9);
  assert.equal(insertCall.bound[1], "Magicard");
  assert.equal(insertCall.bound[2], "2.0.0");
  assert.equal(insertCall.bound[3], "unknown");
  assert.equal(insertCall.bound[6], 0);
});

test("POST /installations with empty payload uses fallback defaults", async () => {
  const db = createMockDB();
  const request = new Request("https://worker.example/installations", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });

  const response = await workerFetch(request, { DB: db });
  const body = await response.json();

  assert.equal(response.status, 201);
  assert.deepEqual(body, { success: true });

  const insertCall = db.calls.find((c) => c.sql.startsWith("INSERT INTO installations"));
  assert.ok(insertCall);
  assert.equal(typeof insertCall.bound[0], "string");
  assert.notEqual(insertCall.bound[0].length, 0);
  assert.equal(insertCall.bound[1], "");
  assert.equal(insertCall.bound[2], "");
  assert.equal(insertCall.bound[3], "unknown");
  assert.equal(insertCall.bound[4], "");
  assert.equal(insertCall.bound[5], "");
  assert.equal(insertCall.bound[6], 0);
  assert.equal(insertCall.bound[7], "");
  assert.equal(insertCall.bound[8], "");
});

test("POST /records creates manual record with explicit defaults", async () => {
  const db = createMockDB();
  const request = new Request("https://worker.example/records", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ notes: "Registro manual desde app" }),
  });

  const response = await workerFetch(request, { DB: db });
  const body = await response.json();

  assert.equal(response.status, 201);
  assert.equal(body.success, true);
  assert.equal(typeof body.record.id, "number");
  assert.equal(body.record.status, "manual");
  assert.equal(body.record.driver_brand, "N/A");
  assert.equal(body.record.driver_version, "N/A");
  assert.equal(body.record.client_name, "Sin cliente");
  assert.equal(body.record.notes, "Registro manual desde app");
});

test("POST /records respects provided fields", async () => {
  const db = createMockDB();
  const request = new Request("https://worker.example/records", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_name: "Cliente ACME",
      driver_brand: "Zebra",
      driver_version: "7.4.1",
      status: "success",
      installation_time_seconds: 120,
      notes: "Creado sin instalacion previa",
      os_info: "Windows 11",
    }),
  });

  const response = await workerFetch(request, { DB: db });
  const body = await response.json();

  assert.equal(response.status, 201);
  assert.equal(body.success, true);
  assert.equal(body.record.client_name, "Cliente ACME");
  assert.equal(body.record.driver_brand, "Zebra");
  assert.equal(body.record.driver_version, "7.4.1");
  assert.equal(body.record.status, "success");
  assert.equal(body.record.installation_time_seconds, 120);
  assert.equal(body.record.notes, "Creado sin instalacion previa");
  assert.equal(body.record.os_info, "Windows 11");
});

test("PUT /installations/:id updates notes and installation time", async () => {
  const db = createMockDB();
  const request = new Request("https://worker.example/installations/42", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      notes: "Actualizado",
      installation_time_seconds: 150,
    }),
  });

  const response = await workerFetch(request, { DB: db });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(body, { success: true, updated: "42" });

  const updateCall = db.calls.find((c) => c.sql.startsWith("UPDATE installations"));
  assert.ok(updateCall);
  assert.deepEqual(updateCall.bound, ["Actualizado", 150, "42"]);
});

test("PUT /installations/:id with missing fields binds null values", async () => {
  const db = createMockDB();
  const request = new Request("https://worker.example/installations/77", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });

  const response = await workerFetch(request, { DB: db });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(body, { success: true, updated: "77" });

  const updateCall = db.calls.find((c) => c.sql.startsWith("UPDATE installations"));
  assert.ok(updateCall);
  assert.deepEqual(updateCall.bound, [null, null, "77"]);
});

test("DELETE /installations/:id deletes record and returns message", async () => {
  const db = createMockDB();
  const request = new Request("https://worker.example/installations/10", {
    method: "DELETE",
  });

  const response = await workerFetch(request, { DB: db });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.message, "Registro 10 eliminado.");

  const deleteCall = db.calls.find((c) => c.sql === "DELETE FROM installations WHERE id = ?");
  assert.ok(deleteCall);
  assert.deepEqual(deleteCall.bound, ["10"]);
});

test("POST /installations/:id/incidents creates incident and can apply installation update", async () => {
  const db = createMockDB({
    installations: [{ id: 45, notes: "nota inicial", installation_time_seconds: 120 }],
  });
  const request = new Request("https://worker.example/installations/45/incidents", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      note: "Fallo de instalación en paso final",
      time_adjustment_seconds: 30,
      severity: "high",
      source: "mobile",
      apply_to_installation: true,
      reporter_username: "admin",
    }),
  });

  const response = await workerFetch(request, { DB: db });
  const body = await response.json();

  assert.equal(response.status, 201);
  assert.equal(body.success, true);
  assert.equal(body.incident.installation_id, 45);
  assert.equal(body.incident.note, "Fallo de instalación en paso final");
  assert.equal(body.incident.time_adjustment_seconds, 30);

  const incidentInsert = db.calls.find((c) => c.sql.startsWith("INSERT INTO incidents"));
  assert.ok(incidentInsert);

  const installationUpdate = db.calls.find(
    (c) => c.sql === "UPDATE installations SET notes = ?, installation_time_seconds = ? WHERE id = ?",
  );
  assert.ok(installationUpdate);
  assert.equal(installationUpdate.bound[2], 45);
});

test("POST /installations/:id/incidents rejects payload without note", async () => {
  const db = createMockDB({
    installations: [{ id: 45, notes: "", installation_time_seconds: 0 }],
  });
  const request = new Request("https://worker.example/installations/45/incidents", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ severity: "high" }),
  });

  const response = await workerFetch(request, { DB: db });
  const body = await response.json();

  assert.equal(response.status, 400);
  assert.equal(body.success, false);
  assert.match(body.error.message, /note/i);
});

test("POST /installations/:id/incidents rejects invalid severity", async () => {
  const db = createMockDB({
    installations: [{ id: 45, notes: "", installation_time_seconds: 0 }],
  });
  const request = new Request("https://worker.example/installations/45/incidents", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      note: "detalle",
      severity: "urgent",
    }),
  });

  const response = await workerFetch(request, { DB: db });
  const body = await response.json();

  assert.equal(response.status, 400);
  assert.equal(body.success, false);
  assert.match(body.error.message, /severity/i);
});

test("POST /installations/:id/incidents rejects invalid source", async () => {
  const db = createMockDB({
    installations: [{ id: 45, notes: "", installation_time_seconds: 0 }],
  });
  const request = new Request("https://worker.example/installations/45/incidents", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      note: "detalle",
      source: "desktop_app",
    }),
  });

  const response = await workerFetch(request, { DB: db });
  const body = await response.json();

  assert.equal(response.status, 400);
  assert.equal(body.success, false);
  assert.match(body.error.message, /source/i);
});

test("POST /installations/:id/incidents rejects invalid time adjustment", async () => {
  const db = createMockDB({
    installations: [{ id: 45, notes: "", installation_time_seconds: 0 }],
  });
  const request = new Request("https://worker.example/installations/45/incidents", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      note: "detalle",
      time_adjustment_seconds: 86401,
    }),
  });

  const response = await workerFetch(request, { DB: db });
  const body = await response.json();

  assert.equal(response.status, 400);
  assert.equal(body.success, false);
  assert.match(body.error.message, /time_adjustment_seconds/i);
});

test("GET /installations/:id/incidents returns incidents with nested photos", async () => {
  const db = createMockDB({
    incidents: [
      {
        id: 11,
        installation_id: 45,
        reporter_username: "admin",
        note: "Incidencia A",
        time_adjustment_seconds: 10,
        severity: "medium",
        source: "mobile",
        created_at: "2026-02-15T10:00:00Z",
      },
    ],
    incidentPhotos: [
      {
        id: 21,
        incident_id: 11,
        r2_key: "incidents/45/11/photo1.jpg",
        file_name: "photo1.jpg",
        content_type: "image/jpeg",
        size_bytes: 1234,
        sha256: "abc",
        created_at: "2026-02-15T10:05:00Z",
      },
    ],
  });
  const request = new Request("https://worker.example/installations/45/incidents", {
    method: "GET",
  });

  const response = await workerFetch(request, { DB: db });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.success, true);
  assert.equal(body.installation_id, 45);
  assert.equal(body.incidents.length, 1);
  assert.equal(body.incidents[0].photos.length, 1);
  assert.equal(body.incidents[0].photos[0].file_name, "photo1.jpg");
});

test("POST /incidents/:id/photos uploads to R2 and persists metadata", async () => {
  const db = createMockDB({
    incidents: [{ id: 11, installation_id: 45 }],
  });

  const uploaded = [];
  const bucket = {
    async put(key, value, options) {
      uploaded.push({ key, size: value.byteLength, options });
    },
  };

  const payload = new Uint8Array(1500);
  payload.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  const request = new Request("https://worker.example/incidents/11/photos", {
    method: "POST",
    headers: {
      "Content-Type": "image/png",
      "X-File-Name": "evidencia.png",
    },
    body: payload,
  });

  const response = await workerFetch(request, {
    DB: db,
    INCIDENTS_BUCKET: bucket,
  });
  const body = await response.json();

  assert.equal(response.status, 201);
  assert.equal(body.success, true);
  assert.equal(body.photo.incident_id, 11);
  assert.equal(body.photo.content_type, "image/png");
  assert.equal(uploaded.length, 1);
  assert.match(uploaded[0].key, /^incidents\/45\/11\//);
  assert.equal(uploaded[0].options.httpMetadata.contentType, "image/png");
});

test("GET /photos/:id returns binary content from R2", async () => {
  const db = createMockDB({
    incidentPhotos: [
      {
        id: 21,
        incident_id: 11,
        r2_key: "incidents/45/11/photo1.jpg",
        file_name: "photo1.jpg",
        content_type: "image/jpeg",
        size_bytes: 4,
        sha256: "abc",
        created_at: "2026-02-15T10:05:00Z",
      },
    ],
  });

  const bucket = {
    async get(key) {
      if (key !== "incidents/45/11/photo1.jpg") return null;
      return {
        body: new Uint8Array([1, 2, 3, 4]),
        httpMetadata: { contentType: "image/jpeg" },
      };
    },
  };

  const request = new Request("https://worker.example/photos/21", {
    method: "GET",
  });

  const response = await workerFetch(request, {
    DB: db,
    INCIDENTS_BUCKET: bucket,
  });

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Content-Type"), "image/jpeg");
  const body = new Uint8Array(await response.arrayBuffer());
  assert.equal(body.length, 4);
});

test("POST /incidents/:id/photos rejects oversized files", async () => {
  const db = createMockDB({
    incidents: [{ id: 11, installation_id: 45 }],
  });

  const bucket = {
    async put() {
      throw new Error("should not upload");
    },
  };

  const request = new Request("https://worker.example/incidents/11/photos", {
    method: "POST",
    headers: { "Content-Type": "image/jpeg" },
    body: new Uint8Array(5 * 1024 * 1024 + 1),
  });

  const response = await workerFetch(request, {
    DB: db,
    INCIDENTS_BUCKET: bucket,
  });
  const body = await response.json();

  assert.equal(response.status, 413);
  assert.equal(body.success, false);
  assert.match(body.error.message, /5MB/i);
});

test("POST /incidents/:id/photos rejects too-small images", async () => {
  const db = createMockDB({
    incidents: [{ id: 11, installation_id: 45 }],
  });
  const request = new Request("https://worker.example/incidents/11/photos", {
    method: "POST",
    headers: { "Content-Type": "image/jpeg" },
    body: new Uint8Array(900),
  });

  const response = await workerFetch(request, { DB: db });
  const body = await response.json();

  assert.equal(response.status, 400);
  assert.equal(body.success, false);
  assert.match(body.error.message, /pequena|corrupta/i);
});

test("POST /incidents/:id/photos rejects invalid image magic bytes", async () => {
  const db = createMockDB({
    incidents: [{ id: 11, installation_id: 45 }],
  });
  const payload = new Uint8Array(1400);
  payload.fill(0x11);
  const request = new Request("https://worker.example/incidents/11/photos", {
    method: "POST",
    headers: { "Content-Type": "image/png" },
    body: payload,
  });

  const response = await workerFetch(request, { DB: db });
  const body = await response.json();

  assert.equal(response.status, 400);
  assert.equal(body.success, false);
  assert.match(body.error.message, /imagen valida/i);
});

test("POST /incidents/:id/photos rejects unsupported content type", async () => {
  const db = createMockDB({
    incidents: [{ id: 11, installation_id: 45 }],
  });
  const request = new Request("https://worker.example/incidents/11/photos", {
    method: "POST",
    headers: { "Content-Type": "application/gif" },
    body: new Uint8Array([1, 2, 3]),
  });

  const response = await workerFetch(request, { DB: db });
  const body = await response.json();

  assert.equal(response.status, 400);
  assert.equal(body.success, false);
  assert.match(body.error.message, /imagen/i);
});

test("POST /incidents/:id/photos rejects empty body", async () => {
  const db = createMockDB({
    incidents: [{ id: 11, installation_id: 45 }],
  });
  let uploaded = false;
  const bucket = {
    async put() {
      uploaded = true;
    },
  };
  const request = new Request("https://worker.example/incidents/11/photos", {
    method: "POST",
    headers: { "Content-Type": "image/jpeg" },
    body: new Uint8Array(0),
  });

  const response = await workerFetch(request, {
    DB: db,
    INCIDENTS_BUCKET: bucket,
  });
  const body = await response.json();

  assert.equal(response.status, 400);
  assert.equal(body.success, false);
  assert.equal(uploaded, false);
});

test("POST /incidents/:id/photos returns 404 when incident does not exist", async () => {
  const db = createMockDB({
    incidents: [],
  });
  const bucket = {
    async put() {
      throw new Error("should not upload");
    },
  };
  const payload = new Uint8Array(1500);
  payload.set([0xff, 0xd8, 0xff], 0);
  const request = new Request("https://worker.example/incidents/999/photos", {
    method: "POST",
    headers: { "Content-Type": "image/jpeg" },
    body: payload,
  });

  const response = await workerFetch(request, {
    DB: db,
    INCIDENTS_BUCKET: bucket,
  });
  const body = await response.json();

  assert.equal(response.status, 404);
  assert.equal(body.success, false);
  assert.match(body.error.message, /incidencia/i);
});

test("POST /incidents/:id/photos returns 500 when R2 bucket binding is missing", async () => {
  const db = createMockDB({
    incidents: [{ id: 11, installation_id: 45 }],
  });
  const payload = new Uint8Array(1500);
  payload.set([0xff, 0xd8, 0xff], 0);
  const request = new Request("https://worker.example/incidents/11/photos", {
    method: "POST",
    headers: { "Content-Type": "image/jpeg" },
    body: payload,
  });

  const response = await workerFetch(request, { DB: db });
  const body = await response.json();

  assert.equal(response.status, 500);
  assert.match(body.error, /INCIDENTS_BUCKET/);
});

test("POST /incidents/:id/photos rejects invalid incident id", async () => {
  const db = createMockDB({
    incidents: [{ id: 11, installation_id: 45 }],
  });
  const request = new Request("https://worker.example/incidents/not-a-number/photos", {
    method: "POST",
    headers: { "Content-Type": "image/jpeg" },
    body: new Uint8Array([1, 2, 3]),
  });

  const response = await workerFetch(request, { DB: db });
  const body = await response.json();

  assert.equal(response.status, 400);
  assert.equal(body.success, false);
  assert.match(body.error.message, /incident_id/i);
});

test("GET /statistics returns full stats with brand grouping", async () => {
  const db = createMockDB({
    installations: [
      {
        id: 1,
        timestamp: "2026-07-10T10:00:00.000Z",
        driver_brand: "Zebra",
        driver_version: "1.0",
        status: "success",
        client_name: "ACME",
        installation_time_seconds: 120,
      },
      {
        id: 2,
        timestamp: "2026-07-11T10:00:00.000Z",
        driver_brand: "Magicard",
        driver_version: "2.0",
        status: "failed",
        client_name: "BETA",
        installation_time_seconds: 60,
      },
      {
        id: 3,
        timestamp: "2026-08-01T00:00:00.000Z",
        driver_brand: "Zebra",
        driver_version: "1.0",
        status: "success",
        client_name: "ACME",
        installation_time_seconds: 180,
      },
    ],
  });
  const request = new Request(
    "https://worker.example/statistics?start_date=2026-07-01T00:00:00.000Z&end_date=2026-08-01T00:00:00.000Z",
    { method: "GET" },
  );

  const response = await workerFetch(request, { DB: db });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.total_installations, 2);
  assert.equal(body.successful_installations, 1);
  assert.equal(body.failed_installations, 1);
  assert.equal(body.unique_clients, 2);
  assert.deepEqual(body.by_brand, { Zebra: 1, Magicard: 1 });
});

test("POST /audit-logs stores audit event in D1", async () => {
  const db = createMockDB();
  const request = new Request("https://worker.example/audit-logs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "login_success",
      username: "admin_root",
      success: true,
      details: { role: "super_admin" },
      computer_name: "LAPTOP-01",
      ip_address: "10.0.0.10",
      platform: "Windows",
    }),
  });

  const response = await workerFetch(request, { DB: db });
  const body = await response.json();

  assert.equal(response.status, 201);
  assert.equal(body.success, true);
  assert.equal(db.state.auditLogs.length, 1);
  assert.equal(db.state.auditLogs[0].action, "login_success");
});

test("GET /audit-logs returns latest rows sorted desc and respects limit", async () => {
  const db = createMockDB({
    auditLogs: [
      {
        id: 1,
        timestamp: "2026-08-01T10:00:00.000Z",
        action: "a",
        username: "u1",
        success: 1,
        details: "{}",
      },
      {
        id: 2,
        timestamp: "2026-08-02T10:00:00.000Z",
        action: "b",
        username: "u2",
        success: 0,
        details: "{}",
      },
    ],
  });
  const request = new Request("https://worker.example/audit-logs?limit=1", {
    method: "GET",
  });

  const response = await workerFetch(request, { DB: db });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.length, 1);
  assert.equal(body[0].id, 2);
});

test("unsupported method on /installations returns 404", async () => {
  const db = createMockDB();
  const request = new Request("https://worker.example/installations", {
    method: "PATCH",
  });

  const response = await workerFetch(request, { DB: db });
  const text = await response.text();

  assert.equal(response.status, 404);
  assert.equal(text, "Ruta no encontrada.");
});

test("GET /installations/:id returns installation when it exists", async () => {
  const db = createMockDB({
    installations: [{ id: 99, driver_brand: "Zebra", status: "success" }],
  });
  const request = new Request("https://worker.example/installations/99", {
    method: "GET",
  });

  const response = await workerFetch(request, { DB: db });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.id, 99);
  assert.equal(body.driver_brand, "Zebra");
});

test("GET /installations/:id returns 404 when installation does not exist", async () => {
  const db = createMockDB();
  const request = new Request("https://worker.example/installations/99", {
    method: "GET",
  });

  const response = await workerFetch(request, { DB: db });
  const body = await response.json();

  assert.equal(response.status, 404);
  assert.equal(body.success, false);
  assert.match(body.error.message, /registro no encontrado/i);
});

test("invalid JSON payload returns 500 with error body", async () => {
  const db = createMockDB();
  const request = new Request("https://worker.example/installations", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{invalid json",
  });

  const response = await workerFetch(request, { DB: db });
  const body = await response.json();

  assert.equal(response.status, 500);
  assert.equal(typeof body.error, "string");
  assert.notEqual(body.error.length, 0);
});

test("unknown route returns 404", async () => {
  const db = createMockDB();
  const request = new Request("https://worker.example/unknown", { method: "GET" });

  const response = await workerFetch(request, { DB: db });
  const text = await response.text();

  assert.equal(response.status, 404);
  assert.equal(text, "Ruta no encontrada.");
});

test("returns 500 when DB binding is missing", async () => {
  const request = new Request("https://worker.example/installations", { method: "GET" });

  const response = await workerFetch(request, {});
  const body = await response.json();

  assert.equal(response.status, 500);
  assert.match(body.error, /D1/);
});

test("returns 503 when API auth secrets are missing", async () => {
  const db = createMockDB();
  const request = new Request("https://worker.example/installations", { method: "GET" });

  const response = await worker.fetch(request, { DB: db });
  const body = await response.json();

  assert.equal(response.status, 503);
  assert.equal(body.success, false);
  assert.match(body.error.message, /API_TOKEN/);
  assert.match(body.error.message, /API_SECRET/);
});

test("returns 401 when auth secrets are configured but headers are missing", async () => {
  const db = createMockDB();
  const request = new Request("https://worker.example/installations", { method: "GET" });

  const response = await worker.fetch(request, {
    DB: db,
    API_TOKEN: "token-123",
    API_SECRET: "secret-abc",
  });
  const body = await response.json();

  assert.equal(response.status, 401);
  assert.equal(body.success, false);
  assert.equal(body.error.code, "UNAUTHORIZED");
});

test("returns 401 when auth token is invalid", async () => {
  const db = createMockDB();
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signature = signRequest({
    method: "GET",
    path: "/installations",
    timestamp,
    bodyBuffer: Buffer.alloc(0),
    secret: "secret-abc",
  });

  const request = new Request("https://worker.example/installations", {
    method: "GET",
    headers: {
      "X-API-Token": "wrong-token",
      "X-Request-Timestamp": timestamp,
      "X-Request-Signature": signature,
    },
  });

  const response = await workerFetch(request, {
    DB: db,
    API_TOKEN: "token-123",
    API_SECRET: "secret-abc",
  });
  const body = await response.json();

  assert.equal(response.status, 401);
  assert.equal(body.success, false);
  assert.match(body.error.message, /token/i);
});

test("returns 401 when auth timestamp is outside allowed window", async () => {
  const db = createMockDB();
  const timestamp = (Math.floor(Date.now() / 1000) - 301).toString();
  const signature = signRequest({
    method: "GET",
    path: "/installations",
    timestamp,
    bodyBuffer: Buffer.alloc(0),
    secret: "secret-abc",
  });

  const request = new Request("https://worker.example/installations", {
    method: "GET",
    headers: {
      "X-API-Token": "token-123",
      "X-Request-Timestamp": timestamp,
      "X-Request-Signature": signature,
    },
  });

  const response = await workerFetch(request, {
    DB: db,
    API_TOKEN: "token-123",
    API_SECRET: "secret-abc",
  });
  const body = await response.json();

  assert.equal(response.status, 401);
  assert.equal(body.success, false);
  assert.match(body.error.message, /timestamp/i);
});

test("returns 401 when auth signature is invalid", async () => {
  const db = createMockDB();
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const request = new Request("https://worker.example/installations", {
    method: "GET",
    headers: {
      "X-API-Token": "token-123",
      "X-Request-Timestamp": timestamp,
      "X-Request-Signature": "not-a-valid-signature",
    },
  });

  const response = await workerFetch(request, {
    DB: db,
    API_TOKEN: "token-123",
    API_SECRET: "secret-abc",
  });
  const body = await response.json();

  assert.equal(response.status, 401);
  assert.equal(body.success, false);
  assert.match(body.error.message, /firma/i);
});

test("GET /health returns OK without DB/auth", async () => {
  const request = new Request("https://worker.example/health", { method: "GET" });
  const response = await workerFetch(request, {});
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(typeof body.now, "string");
});

test("POST /web/auth/login issues access token for web routes", async () => {
  const db = createMockDB({
    installations: [{ id: 1, driver_brand: "Zebra", status: "success" }],
  });

  const bootstrapRequest = new Request("https://worker.example/web/auth/bootstrap", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      bootstrap_password: "web-pass",
      username: "admin_root",
      password: "StrongPass#2026",
    }),
  });
  const bootstrapResponse = await workerFetch(bootstrapRequest, {
    DB: db,
    WEB_LOGIN_PASSWORD: "web-pass",
    WEB_SESSION_SECRET: "web-session-secret",
  });
  assert.equal(bootstrapResponse.status, 201);

  const loginRequest = new Request("https://worker.example/web/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username: "admin_root",
      password: "StrongPass#2026",
    }),
  });

  const loginResponse = await workerFetch(loginRequest, {
    DB: db,
    API_TOKEN: "token-123",
    API_SECRET: "secret-abc",
    WEB_LOGIN_PASSWORD: "web-pass",
    WEB_SESSION_SECRET: "web-session-secret",
  });
  const loginBody = await loginResponse.json();

  assert.equal(loginResponse.status, 200);
  assert.equal(loginBody.success, true);
  assert.equal(typeof loginBody.access_token, "string");

  const listRequest = new Request("https://worker.example/web/installations", {
    method: "GET",
    headers: {
      Authorization: `Bearer ${loginBody.access_token}`,
    },
  });

  const listResponse = await workerFetch(listRequest, {
    DB: db,
    API_TOKEN: "token-123",
    API_SECRET: "secret-abc",
    WEB_LOGIN_PASSWORD: "web-pass",
    WEB_SESSION_SECRET: "web-session-secret",
  });
  const listBody = await listResponse.json();

  assert.equal(listResponse.status, 200);
  assert.deepEqual(listBody, [{ id: 1, driver_brand: "Zebra", status: "success" }]);
});

test("POST /web/auth/bootstrap creates first web user with hashed password", async () => {
  const db = createMockDB();
  const bootstrapRequest = new Request("https://worker.example/web/auth/bootstrap", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      bootstrap_password: "web-pass",
      username: "admin_root",
      password: "StrongPass#2026",
      role: "admin",
    }),
  });

  const response = await workerFetch(bootstrapRequest, {
    DB: db,
    WEB_LOGIN_PASSWORD: "web-pass",
    WEB_SESSION_SECRET: "web-session-secret",
  });
  const body = await response.json();

  assert.equal(response.status, 201);
  assert.equal(body.success, true);
  assert.equal(body.bootstrapped, true);
  assert.equal(body.user.username, "admin_root");
  assert.equal(db.state.webUsers.length, 1);
  assert.notEqual(db.state.webUsers[0].password_hash, "StrongPass#2026");
  assert.match(db.state.webUsers[0].password_hash, /^pbkdf2_sha256\$/);
});

test("POST /web/auth/bootstrap rejects weak password without complexity", async () => {
  const db = createMockDB();
  const bootstrapRequest = new Request("https://worker.example/web/auth/bootstrap", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      bootstrap_password: "web-pass",
      username: "admin_root",
      password: "weakpassword12",
      role: "admin",
    }),
  });

  const response = await workerFetch(bootstrapRequest, {
    DB: db,
    WEB_LOGIN_PASSWORD: "web-pass",
    WEB_SESSION_SECRET: "web-session-secret",
  });
  const body = await response.json();

  assert.equal(response.status, 400);
  assert.equal(body.success, false);
  assert.match(body.error.message, /mayuscula/i);
  assert.match(body.error.message, /especial/i);
});

test("POST /web/auth/login accepts username/password after bootstrap", async () => {
  const db = createMockDB({
    installations: [{ id: 1, driver_brand: "Zebra", status: "success" }],
  });

  const bootstrapRequest = new Request("https://worker.example/web/auth/bootstrap", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      bootstrap_password: "web-pass",
      username: "admin_root",
      password: "StrongPass#2026",
    }),
  });
  const bootstrapResponse = await workerFetch(bootstrapRequest, {
    DB: db,
    WEB_LOGIN_PASSWORD: "web-pass",
    WEB_SESSION_SECRET: "web-session-secret",
  });
  assert.equal(bootstrapResponse.status, 201);

  const loginRequest = new Request("https://worker.example/web/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username: "admin_root",
      password: "StrongPass#2026",
    }),
  });
  const loginResponse = await workerFetch(loginRequest, {
    DB: db,
    WEB_LOGIN_PASSWORD: "web-pass",
    WEB_SESSION_SECRET: "web-session-secret",
  });
  const loginBody = await loginResponse.json();

  assert.equal(loginResponse.status, 200);
  assert.equal(loginBody.success, true);
  assert.equal(loginBody.user.username, "admin_root");
  assert.equal(typeof loginBody.access_token, "string");

  const meRequest = new Request("https://worker.example/web/auth/me", {
    method: "GET",
    headers: {
      Authorization: `Bearer ${loginBody.access_token}`,
    },
  });
  const meResponse = await workerFetch(meRequest, {
    DB: db,
    WEB_LOGIN_PASSWORD: "web-pass",
    WEB_SESSION_SECRET: "web-session-secret",
  });
  const meBody = await meResponse.json();

  assert.equal(meResponse.status, 200);
  assert.equal(meBody.username, "admin_root");
  assert.equal(meBody.role, "admin");
});

test("POST /web/installations/:id/incidents uses web session user as reporter by default", async () => {
  const db = createMockDB({
    installations: [{ id: 45, notes: "", installation_time_seconds: 0 }],
  });

  const bootstrapRequest = new Request("https://worker.example/web/auth/bootstrap", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      bootstrap_password: "web-pass",
      username: "admin_root",
      password: "StrongPass#2026",
    }),
  });
  const bootstrapResponse = await workerFetch(bootstrapRequest, {
    DB: db,
    WEB_LOGIN_PASSWORD: "web-pass",
    WEB_SESSION_SECRET: "web-session-secret",
  });
  const bootstrapBody = await bootstrapResponse.json();
  assert.equal(bootstrapResponse.status, 201);

  const createIncidentRequest = new Request("https://worker.example/web/installations/45/incidents", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${bootstrapBody.access_token}`,
    },
    body: JSON.stringify({
      note: "Incidencia creada desde web",
    }),
  });

  const createIncidentResponse = await workerFetch(createIncidentRequest, {
    DB: db,
    WEB_LOGIN_PASSWORD: "web-pass",
    WEB_SESSION_SECRET: "web-session-secret",
  });
  const createIncidentBody = await createIncidentResponse.json();

  assert.equal(createIncidentResponse.status, 201);
  assert.equal(createIncidentBody.success, true);
  assert.equal(createIncidentBody.incident.reporter_username, "admin_root");
  assert.equal(createIncidentBody.incident.source, "web");
});

test("POST /web/auth/users creates additional users when caller is admin", async () => {
  const db = createMockDB();

  const bootstrapRequest = new Request("https://worker.example/web/auth/bootstrap", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      bootstrap_password: "web-pass",
      username: "admin_root",
      password: "StrongPass#2026",
    }),
  });
  const bootstrapResponse = await workerFetch(bootstrapRequest, {
    DB: db,
    WEB_LOGIN_PASSWORD: "web-pass",
    WEB_SESSION_SECRET: "web-session-secret",
  });
  const bootstrapBody = await bootstrapResponse.json();
  assert.equal(bootstrapResponse.status, 201);

  const createUserRequest = new Request("https://worker.example/web/auth/users", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${bootstrapBody.access_token}`,
    },
    body: JSON.stringify({
      username: "viewer_1",
      password: "ViewerPass#2026",
      role: "viewer",
    }),
  });
  const createUserResponse = await workerFetch(createUserRequest, {
    DB: db,
    WEB_LOGIN_PASSWORD: "web-pass",
    WEB_SESSION_SECRET: "web-session-secret",
  });
  const createUserBody = await createUserResponse.json();

  assert.equal(createUserResponse.status, 201);
  assert.equal(createUserBody.success, true);
  assert.equal(createUserBody.user.username, "viewer_1");
  assert.equal(createUserBody.user.role, "viewer");
  assert.equal(db.state.webUsers.length, 2);
});

test("GET /web/auth/users lists users with active status and last login", async () => {
  const db = createMockDB();

  const bootstrapRequest = new Request("https://worker.example/web/auth/bootstrap", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      bootstrap_password: "web-pass",
      username: "admin_root",
      password: "StrongPass#2026",
    }),
  });
  const bootstrapResponse = await workerFetch(bootstrapRequest, {
    DB: db,
    WEB_LOGIN_PASSWORD: "web-pass",
    WEB_SESSION_SECRET: "web-session-secret",
  });
  const bootstrapBody = await bootstrapResponse.json();
  assert.equal(bootstrapResponse.status, 201);

  const createUserRequest = new Request("https://worker.example/web/auth/users", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${bootstrapBody.access_token}`,
    },
    body: JSON.stringify({
      username: "viewer_1",
      password: "ViewerPass#2026",
      role: "viewer",
    }),
  });
  const createUserResponse = await workerFetch(createUserRequest, {
    DB: db,
    WEB_SESSION_SECRET: "web-session-secret",
  });
  assert.equal(createUserResponse.status, 201);

  const listUsersRequest = new Request("https://worker.example/web/auth/users", {
    method: "GET",
    headers: {
      Authorization: `Bearer ${bootstrapBody.access_token}`,
    },
  });
  const listUsersResponse = await workerFetch(listUsersRequest, {
    DB: db,
    WEB_SESSION_SECRET: "web-session-secret",
  });
  const listUsersBody = await listUsersResponse.json();

  assert.equal(listUsersResponse.status, 200);
  assert.equal(listUsersBody.success, true);
  assert.equal(Array.isArray(listUsersBody.users), true);
  assert.equal(listUsersBody.users.length, 2);
  assert.deepEqual(
    listUsersBody.users.map((item) => item.username),
    ["admin_root", "viewer_1"],
  );
  assert.equal(typeof listUsersBody.users[0].is_active, "boolean");
});

test("PATCH /web/auth/users/:id updates role and active status", async () => {
  const db = createMockDB();

  const bootstrapRequest = new Request("https://worker.example/web/auth/bootstrap", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      bootstrap_password: "web-pass",
      username: "admin_root",
      password: "StrongPass#2026",
    }),
  });
  const bootstrapResponse = await workerFetch(bootstrapRequest, {
    DB: db,
    WEB_LOGIN_PASSWORD: "web-pass",
    WEB_SESSION_SECRET: "web-session-secret",
  });
  const bootstrapBody = await bootstrapResponse.json();
  assert.equal(bootstrapResponse.status, 201);

  const createUserRequest = new Request("https://worker.example/web/auth/users", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${bootstrapBody.access_token}`,
    },
    body: JSON.stringify({
      username: "viewer_1",
      password: "ViewerPass#2026",
      role: "viewer",
    }),
  });
  const createUserResponse = await workerFetch(createUserRequest, {
    DB: db,
    WEB_SESSION_SECRET: "web-session-secret",
  });
  const createUserBody = await createUserResponse.json();
  assert.equal(createUserResponse.status, 201);

  const patchUserRequest = new Request(
    `https://worker.example/web/auth/users/${createUserBody.user.id}`,
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${bootstrapBody.access_token}`,
      },
      body: JSON.stringify({
        role: "admin",
        is_active: false,
      }),
    },
  );
  const patchUserResponse = await workerFetch(patchUserRequest, {
    DB: db,
    WEB_SESSION_SECRET: "web-session-secret",
  });
  const patchUserBody = await patchUserResponse.json();

  assert.equal(patchUserResponse.status, 200);
  assert.equal(patchUserBody.success, true);
  assert.equal(patchUserBody.user.role, "admin");
  assert.equal(patchUserBody.user.is_active, false);
});

test("POST /web/auth/users/:id/force-password resets password and allows login", async () => {
  const db = createMockDB();

  const bootstrapRequest = new Request("https://worker.example/web/auth/bootstrap", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      bootstrap_password: "web-pass",
      username: "admin_root",
      password: "StrongPass#2026",
    }),
  });
  const bootstrapResponse = await workerFetch(bootstrapRequest, {
    DB: db,
    WEB_LOGIN_PASSWORD: "web-pass",
    WEB_SESSION_SECRET: "web-session-secret",
  });
  const bootstrapBody = await bootstrapResponse.json();
  assert.equal(bootstrapResponse.status, 201);

  const createUserRequest = new Request("https://worker.example/web/auth/users", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${bootstrapBody.access_token}`,
    },
    body: JSON.stringify({
      username: "viewer_1",
      password: "ViewerPass#2026",
      role: "viewer",
    }),
  });
  const createUserResponse = await workerFetch(createUserRequest, {
    DB: db,
    WEB_SESSION_SECRET: "web-session-secret",
  });
  const createUserBody = await createUserResponse.json();
  assert.equal(createUserResponse.status, 201);

  const resetPasswordRequest = new Request(
    `https://worker.example/web/auth/users/${createUserBody.user.id}/force-password`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${bootstrapBody.access_token}`,
      },
      body: JSON.stringify({
        new_password: "ViewerPass#2027",
      }),
    },
  );
  const resetPasswordResponse = await workerFetch(resetPasswordRequest, {
    DB: db,
    WEB_SESSION_SECRET: "web-session-secret",
  });
  const resetPasswordBody = await resetPasswordResponse.json();
  assert.equal(resetPasswordResponse.status, 200);
  assert.equal(resetPasswordBody.success, true);

  const oldLoginRequest = new Request("https://worker.example/web/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username: "viewer_1",
      password: "ViewerPass#2026",
    }),
  });
  const oldLoginResponse = await workerFetch(oldLoginRequest, {
    DB: db,
    WEB_SESSION_SECRET: "web-session-secret",
  });
  assert.equal(oldLoginResponse.status, 401);

  const newLoginRequest = new Request("https://worker.example/web/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username: "viewer_1",
      password: "ViewerPass#2027",
    }),
  });
  const newLoginResponse = await workerFetch(newLoginRequest, {
    DB: db,
    WEB_SESSION_SECRET: "web-session-secret",
  });
  const newLoginBody = await newLoginResponse.json();

  assert.equal(newLoginResponse.status, 200);
  assert.equal(newLoginBody.success, true);
});

test("POST /web/auth/import-users imports bcrypt users and login works", async () => {
  const db = createMockDB();

  const bootstrapRequest = new Request("https://worker.example/web/auth/bootstrap", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      bootstrap_password: "web-pass",
      username: "admin_root",
      password: "StrongPass#2026",
    }),
  });
  const bootstrapResponse = await workerFetch(bootstrapRequest, {
    DB: db,
    WEB_LOGIN_PASSWORD: "web-pass",
    WEB_SESSION_SECRET: "web-session-secret",
  });
  const bootstrapBody = await bootstrapResponse.json();
  assert.equal(bootstrapResponse.status, 201);

  const importedHash = bcrypt.hashSync("DesktopUser#2026", 10);
  const importRequest = new Request("https://worker.example/web/auth/import-users", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${bootstrapBody.access_token}`,
    },
    body: JSON.stringify({
      users: [
        {
          username: "desktop_admin",
          password_hash: importedHash,
          password_hash_type: "bcrypt",
          role: "admin",
          is_active: true,
        },
      ],
    }),
  });
  const importResponse = await workerFetch(importRequest, {
    DB: db,
    WEB_SESSION_SECRET: "web-session-secret",
  });
  const importBody = await importResponse.json();
  assert.equal(importResponse.status, 200);
  assert.equal(importBody.success, true);
  assert.equal(importBody.imported, 1);
  assert.equal(importBody.created, 1);

  const loginRequest = new Request("https://worker.example/web/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username: "desktop_admin",
      password: "DesktopUser#2026",
    }),
  });
  const loginResponse = await workerFetch(loginRequest, {
    DB: db,
    WEB_SESSION_SECRET: "web-session-secret",
  });
  const loginBody = await loginResponse.json();

  assert.equal(loginResponse.status, 200);
  assert.equal(loginBody.success, true);
  assert.equal(loginBody.user.username, "desktop_admin");

  const migratedUser = db.state.webUsers.find((item) => item.username === "desktop_admin");
  assert.equal(migratedUser?.password_hash_type, "pbkdf2_sha256");
  assert.match(String(migratedUser?.password_hash || ""), /^pbkdf2_sha256\$/);
});

test("POST /web/auth/login requires username in payload", async () => {
  const request = new Request("https://worker.example/web/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: "no-legacy-mode" }),
  });

  const response = await workerFetch(request, {
    DB: createMockDB(),
    WEB_SESSION_SECRET: "web-session-secret",
  });
  const body = await response.json();

  assert.equal(response.status, 400);
  assert.equal(body.success, false);
  assert.match(body.error.message, /username/i);
});

test("GET /web/installations rejects request without Bearer token", async () => {
  const db = createMockDB();
  const request = new Request("https://worker.example/web/installations", {
    method: "GET",
  });

  const response = await workerFetch(request, {
    DB: db,
    WEB_LOGIN_PASSWORD: "web-pass",
    WEB_SESSION_SECRET: "web-session-secret",
  });
  const body = await response.json();

  assert.equal(response.status, 401);
  assert.equal(body.success, false);
  assert.match(body.error.message, /bearer/i);
});

test("POST /web/auth/login rejects wrong password", async () => {
  const db = createMockDB();

  const bootstrapRequest = new Request("https://worker.example/web/auth/bootstrap", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      bootstrap_password: "web-pass",
      username: "admin_root",
      password: "StrongPass#2026",
    }),
  });
  const bootstrapResponse = await workerFetch(bootstrapRequest, {
    DB: db,
    WEB_LOGIN_PASSWORD: "web-pass",
    WEB_SESSION_SECRET: "web-session-secret",
  });
  assert.equal(bootstrapResponse.status, 201);

  const request = new Request("https://worker.example/web/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username: "admin_root",
      password: "wrong",
    }),
  });

  const response = await workerFetch(request, {
    DB: db,
    WEB_LOGIN_PASSWORD: "web-pass",
    WEB_SESSION_SECRET: "web-session-secret",
  });
  const body = await response.json();

  assert.equal(response.status, 401);
  assert.equal(body.success, false);
  assert.match(body.error.message, /credenciales/i);
});

test("POST /web/auth/login rate limits repeated failed attempts with RATE_LIMIT_KV", async () => {
  const db = createMockDB();
  const rateLimitKv = createMockKV();

  const bootstrapRequest = new Request("https://worker.example/web/auth/bootstrap", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      bootstrap_password: "web-pass",
      username: "admin_root",
      password: "StrongPass#2026",
    }),
  });
  const bootstrapResponse = await workerFetch(bootstrapRequest, {
    DB: db,
    WEB_LOGIN_PASSWORD: "web-pass",
    WEB_SESSION_SECRET: "web-session-secret",
    RATE_LIMIT_KV: rateLimitKv,
  });
  assert.equal(bootstrapResponse.status, 201);

  const requestPayload = JSON.stringify({
    username: "admin_root",
    password: "WrongPassword#2026",
  });
  const requestHeaders = {
    "Content-Type": "application/json",
    "CF-Connecting-IP": "198.51.100.10",
  };

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const loginRequest = new Request("https://worker.example/web/auth/login", {
      method: "POST",
      headers: requestHeaders,
      body: requestPayload,
    });
    const loginResponse = await workerFetch(loginRequest, {
      DB: db,
      WEB_LOGIN_PASSWORD: "web-pass",
      WEB_SESSION_SECRET: "web-session-secret",
      RATE_LIMIT_KV: rateLimitKv,
    });
    assert.equal(loginResponse.status, 401);
  }

  const blockedRequest = new Request("https://worker.example/web/auth/login", {
    method: "POST",
    headers: requestHeaders,
    body: requestPayload,
  });
  const blockedResponse = await workerFetch(blockedRequest, {
    DB: db,
    WEB_LOGIN_PASSWORD: "web-pass",
    WEB_SESSION_SECRET: "web-session-secret",
    RATE_LIMIT_KV: rateLimitKv,
  });
  const blockedBody = await blockedResponse.json();

  assert.equal(blockedResponse.status, 429);
  assert.equal(blockedBody.success, false);
  assert.match(blockedBody.error.message, /demasiados intentos/i);
  assert.equal(
    await rateLimitKv.get("web_login_attempts:198.51.100.10:admin_root"),
    "5",
  );

  const ttlCall = rateLimitKv.calls.find(
    (entry) => entry.op === "put" && entry.key === "web_login_attempts:198.51.100.10:admin_root",
  );
  assert.equal(ttlCall?.options?.expirationTtl, 900);
});

test("POST /web/auth/login clears RATE_LIMIT_KV counter after successful login", async () => {
  const db = createMockDB();
  const rateLimitKv = createMockKV();
  const env = {
    DB: db,
    WEB_LOGIN_PASSWORD: "web-pass",
    WEB_SESSION_SECRET: "web-session-secret",
    RATE_LIMIT_KV: rateLimitKv,
  };

  const bootstrapRequest = new Request("https://worker.example/web/auth/bootstrap", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      bootstrap_password: "web-pass",
      username: "admin_root",
      password: "StrongPass#2026",
    }),
  });
  const bootstrapResponse = await workerFetch(bootstrapRequest, env);
  assert.equal(bootstrapResponse.status, 201);

  const failedRequest = new Request("https://worker.example/web/auth/login", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "CF-Connecting-IP": "198.51.100.10",
    },
    body: JSON.stringify({
      username: "admin_root",
      password: "WrongPassword#2026",
    }),
  });
  const failedResponse = await workerFetch(failedRequest, env);
  assert.equal(failedResponse.status, 401);
  assert.equal(
    await rateLimitKv.get("web_login_attempts:198.51.100.10:admin_root"),
    "1",
  );

  const successfulRequest = new Request("https://worker.example/web/auth/login", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "CF-Connecting-IP": "198.51.100.10",
    },
    body: JSON.stringify({
      username: "admin_root",
      password: "StrongPass#2026",
    }),
  });
  const successfulResponse = await workerFetch(successfulRequest, env);
  assert.equal(successfulResponse.status, 200);
  assert.equal(
    await rateLimitKv.get("web_login_attempts:198.51.100.10:admin_root"),
    null,
  );
  assert.equal(
    rateLimitKv.calls.some(
      (entry) => entry.op === "delete" && entry.key === "web_login_attempts:198.51.100.10:admin_root",
    ),
    true,
  );
});

test("accepts signed requests when auth secrets are configured", async () => {
  const db = createMockDB({
    installations: [{ id: 1, driver_brand: "Zebra", status: "success" }],
  });
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signature = signRequest({
    method: "GET",
    path: "/installations",
    timestamp,
    bodyBuffer: Buffer.alloc(0),
    secret: "secret-abc",
  });

  const request = new Request("https://worker.example/installations", {
    method: "GET",
    headers: {
      "X-API-Token": "token-123",
      "X-Request-Timestamp": timestamp,
      "X-Request-Signature": signature,
    },
  });

  const response = await workerFetch(request, {
    DB: db,
    API_TOKEN: "token-123",
    API_SECRET: "secret-abc",
  });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(body, [{ id: 1, driver_brand: "Zebra", status: "success" }]);
});
