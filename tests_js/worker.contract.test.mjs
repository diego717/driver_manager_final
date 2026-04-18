import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import bcrypt from "bcryptjs";

import worker from "../worker.js";
import { createAssetsBinding } from "./helpers/assets.mock.mjs";

const DEFAULT_API_TOKEN = "token-123";
const DEFAULT_API_SECRET = "secret-abc";
const WEB_SESSION_COOKIE_NAME = "__Host-web_session";
const DEFAULT_REALTIME_TENANT_ID = "default";
let nonceCounter = 0;

async function workerFetch(request, env = {}) {
  ensureDefaultSecurityStores(env);
  const mergedEnv = {
    API_TOKEN: DEFAULT_API_TOKEN,
    API_SECRET: DEFAULT_API_SECRET,
    DRIVER_MANAGER_API_TENANT_ID: "default",
    ASSETS: createAssetsBinding(),
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
    const bodyHash = sha256Hex(bodyBuffer || Buffer.alloc(0));
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const nonce = `auto-${Date.now()}-${++nonceCounter}`;
    const signature = signRequest({
      method: request.method,
      path: url.pathname,
      timestamp,
      bodyBuffer,
      secret: mergedEnv.API_SECRET,
      nonce,
    });

    const headers = new Headers(request.headers);
    headers.set("X-API-Token", mergedEnv.API_TOKEN);
    headers.set("X-Request-Timestamp", timestamp);
    headers.set("X-Request-Signature", signature);
    headers.set("X-Request-Nonce", nonce);
    headers.set("X-Body-SHA256", bodyHash);

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

function signRequest({ method, path, timestamp, bodyBuffer, secret, nonce = "nonce-test-000000000001" }) {
  const bodyHash = sha256Hex(bodyBuffer || Buffer.alloc(0));
  const canonical = `${method.toUpperCase()}|${path}|${timestamp}|${bodyHash}|${nonce}`;
  return crypto.createHmac("sha256", secret).update(canonical).digest("hex");
}

function extractWebSessionCookieFromResponse(response) {
  const setCookieHeader = String(response?.headers?.get("set-cookie") || "");
  const match = setCookieHeader.match(
    new RegExp(`${WEB_SESSION_COOKIE_NAME}=([^;]+)`),
  );
  if (!match) {
    throw new Error("No se encontro cookie de sesion web en Set-Cookie.");
  }
  return `${WEB_SESSION_COOKIE_NAME}=${match[1]}`;
}

function webSessionHeadersFromResponse(response) {
  return {
    Cookie: extractWebSessionCookieFromResponse(response),
  };
}

function webAuthorizationHeadersFromBody(body) {
  const accessToken = String(body?.access_token || "");
  if (!accessToken) {
    throw new Error("No se encontro access_token en el payload de sesion web.");
  }
  return {
    Authorization: `Bearer ${accessToken}`,
  };
}

function assertWebSessionAuthBody(
  body,
  { username, role, tenantId = DEFAULT_REALTIME_TENANT_ID, bootstrapped } = {},
) {
  assert.equal(body.success, true);
  assert.equal(body.authenticated, true);
  assert.equal(body.token_type, "Bearer");
  assert.equal(typeof body.access_token, "string");
  assert.ok(body.access_token.length > 20);
  assert.equal(typeof body.expires_in, "number");
  assert.ok(body.expires_in > 0);
  assert.equal(typeof body.expires_at, "string");
  assert.equal(body.user.username, username);
  assert.equal(body.user.role, role);
  assert.equal(body.user.tenant_id, tenantId);
  assert.equal(body.user.is_active, true);
  if (bootstrapped !== undefined) {
    assert.equal(body.bootstrapped, bootstrapped);
  }
}

function assertWebSessionStatusBody(
  body,
  { username, role, tenantId = DEFAULT_REALTIME_TENANT_ID } = {},
) {
  assert.equal(body.success, true);
  assert.equal(body.authenticated, true);
  assert.equal(body.token_type, "Bearer");
  assert.equal(body.access_token, undefined);
  assert.equal(typeof body.expires_in, "number");
  assert.ok(body.expires_in > 0);
  assert.equal(typeof body.expires_at, "string");
  assert.equal(body.user.username, username);
  assert.equal(body.user.role, role);
  assert.equal(body.user.tenant_id, tenantId);
  assert.equal(body.user.is_active, true);
}

function createTestFcmServiceAccountJson(projectId = "driver-manager-fcm-test") {
  const { privateKey } = crypto.generateKeyPairSync("rsa", {
    modulusLength: 2048,
  });
  const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();

  return JSON.stringify({
    type: "service_account",
    project_id: projectId,
    private_key_id: "test-key-id",
    private_key: privateKeyPem,
    client_email: `${projectId}@example.iam.gserviceaccount.com`,
    client_id: "1234567890",
    token_uri: "https://oauth2.googleapis.com/token",
  });
}

function createMockDB({
  installations = [],
  byBrand = [],
  incidents = [],
  incidentPhotos = [],
  auditLogs = [],
  webUsers = [],
  deviceTokens = [],
  assets = [],
  assetLoans = [],
} = {}) {
  const calls = [];
  const withDefaultGps = (row) => ({
    gps_lat: null,
    gps_lng: null,
    gps_accuracy_m: null,
    gps_captured_at: null,
    gps_capture_source: "none",
    gps_capture_status: "pending",
    gps_capture_note: "",
    ...row,
  });
  const withDefaultGeofence = (row) => ({
    geofence_distance_m: null,
    geofence_radius_m: null,
    geofence_result: "not_applicable",
    geofence_checked_at: null,
    geofence_override_note: "",
    geofence_override_by: null,
    geofence_override_at: null,
    ...row,
  });
  const state = {
    installations: installations.map((row) => ({
      ...withDefaultGps({}),
      site_lat: null,
      site_lng: null,
      site_radius_m: null,
      tenant_id: "default",
      ...row,
    })),
    byBrand: byBrand.map((row) => ({ ...row })),
    incidents: incidents.map((row) => ({
      ...withDefaultGps({}),
      ...withDefaultGeofence({}),
      tenant_id: "default",
      deleted_at: null,
      deleted_by: null,
      deletion_reason: null,
      ...row,
    })),
    incidentPhotos: incidentPhotos.map((row) => ({
      tenant_id: "default",
      ...row,
    })),
    auditLogs: auditLogs.map((row) => ({
      tenant_id: "default",
      ...row,
    })),
    webUsers: webUsers.map((row) => ({
      password_hash_type: "pbkdf2_sha256",
      is_active: 1,
      tenant_id: "default",
      ...row,
    })),
    deviceTokens: deviceTokens.map((row) => ({
      tenant_id: "default",
      ...row,
    })),
    assets: assets.map((row) => ({
      tenant_id: "default",
      brand: "",
      serial_number: "",
      model: "",
      client_name: "",
      notes: "",
      status: "active",
      created_at: row.created_at || "2026-01-01T00:00:00.000Z",
      updated_at: row.updated_at || "2026-01-01T00:00:00.000Z",
      ...row,
    })),
    assetLoans: assetLoans.map((row) => ({
      tenant_id: "default",
      original_client: "",
      expected_return_at: null,
      returned_at: null,
      due_soon_reminded_at: null,
      overdue_reminded_at: null,
      loaned_by_username: "unknown",
      returned_by_username: null,
      notes: "",
      return_notes: "",
      status: "active",
      ...row,
    })),
  };

  let nextInstallationId = 100;
  let nextIncidentId = 1000;
  let nextPhotoId = 2000;
  let nextAuditLogId = 2500;
  let nextWebUserId = 3000;
  let nextDeviceTokenId = 3500;
  let nextAssetLoanId = 4000;

  const normalizeStatus = (value) => String(value ?? "").toLowerCase();
  const parseDate = (value) => {
    if (!value) return null;
    const parsed = new Date(String(value));
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  };
  const applyDateRange = (rows, startIso, endIso, fieldName = "timestamp") => {
    const start = parseDate(startIso);
    const end = parseDate(endIso);
    return rows.filter((row) => {
      const ts = parseDate(row?.[fieldName]);
      if (!ts) return false;
      if (start && ts < start) return false;
      if (end && ts >= end) return false;
      return true;
    });
  };
  const round2 = (value) => Math.round(value * 100) / 100;
  const isIncidentVisible = (incident) => !incident?.deleted_at;

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
          if (normalized.startsWith("SELECT * FROM installations WHERE id = ?")) {
            const id = Number(call.bound?.[0]);
            let rows = state.installations.filter((item) => Number(item.id) === id);
            if (normalized.includes("AND tenant_id = ?")) {
              const tenantId = String(call.bound?.[1] ?? "default");
              rows = rows.filter(
                (item) => String(item.tenant_id ?? "default") === tenantId,
              );
            }
            return { results: rows.slice(0, 1) };
          }

          if (
            normalized.startsWith("SELECT id, timestamp FROM installations WHERE id = ?")
          ) {
            const id = Number(call.bound?.[0]);
            const tenantId = String(call.bound?.[1] ?? "default");
            const rows = state.installations
              .filter(
                (item) =>
                  Number(item.id) === id &&
                  String(item.tenant_id ?? "default") === tenantId,
              )
              .map((item) => ({
                id: item.id,
                timestamp: item.timestamp ?? null,
              }));
            return { results: rows.slice(0, 1) };
          }

          if (normalized.startsWith("SELECT * FROM installations WHERE")) {
            let rows = [...state.installations].sort((a, b) => {
              const byTimestamp = String(b.timestamp ?? "").localeCompare(String(a.timestamp ?? ""));
              if (byTimestamp !== 0) return byTimestamp;
              return Number(b.id) - Number(a.id);
            });

            let bindIndex = 0;
            if (normalized.includes("tenant_id = ?")) {
              const tenantId = String(call.bound?.[bindIndex++] ?? "default");
              rows = rows.filter(
                (row) => String(row.tenant_id ?? "default") === tenantId,
              );
            }
            if (normalized.includes("LOWER(COALESCE(client_name, '')) LIKE ?")) {
              const clientPattern = String(call.bound?.[bindIndex++] ?? "").toLowerCase();
              const clientNeedle = clientPattern.replace(/%/g, "");
              rows = rows.filter((row) =>
                String(row.client_name ?? "").toLowerCase().includes(clientNeedle),
              );
            }
            if (normalized.includes("LOWER(COALESCE(driver_brand, '')) = ?")) {
              const brand = String(call.bound?.[bindIndex++] ?? "").toLowerCase();
              rows = rows.filter(
                (row) => String(row.driver_brand ?? "").toLowerCase() === brand,
              );
            }
            if (normalized.includes("LOWER(COALESCE(status, '')) = ?")) {
              const status = String(call.bound?.[bindIndex++] ?? "").toLowerCase();
              rows = rows.filter((row) => String(row.status ?? "").toLowerCase() === status);
            }
            if (normalized.includes("timestamp >= ?")) {
              const start = String(call.bound?.[bindIndex++] ?? "");
              rows = rows.filter(
                (row) => String(row.timestamp ?? "").localeCompare(start) >= 0,
              );
            }
            if (normalized.includes("timestamp < ?")) {
              const end = String(call.bound?.[bindIndex++] ?? "");
              rows = rows.filter((row) => String(row.timestamp ?? "").localeCompare(end) < 0);
            }
            if (normalized.includes("(timestamp < ? OR (timestamp = ? AND id < ?))")) {
              const cursorTs = String(call.bound?.[bindIndex++] ?? "");
              const cursorTsEq = String(call.bound?.[bindIndex++] ?? "");
              const cursorId = Number(call.bound?.[bindIndex++] ?? 0);
              rows = rows.filter((row) => {
                const ts = String(row.timestamp ?? "");
                if (ts.localeCompare(cursorTs) < 0) return true;
                return ts === cursorTsEq && Number(row.id) < cursorId;
              });
            }

            const limit = Math.max(1, Number(call.bound?.[bindIndex] ?? rows.length));
            return { results: rows.slice(0, limit) };
          }

          if (
            normalized.includes("COUNT(*) AS total_installations") &&
            !normalized.includes("substr(timestamp, 1, 10) AS day")
          ) {
            let filtered = [...state.installations];
            let bindOffset = 0;
            if (normalized.includes("WHERE tenant_id = ?")) {
              const tenantId = String(call.bound?.[bindOffset++] ?? "default");
              filtered = filtered.filter(
                (row) => String(row.tenant_id ?? "default") === tenantId,
              );
            }

            const start = call.bound?.[bindOffset + 1] ?? call.bound?.[bindOffset] ?? null;
            const end = call.bound?.[bindOffset + 3] ?? call.bound?.[bindOffset + 2] ?? null;
            filtered = applyDateRange(filtered, start, end);

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
            let filtered = [...state.installations];
            let bindOffset = 0;
            if (normalized.includes("WHERE tenant_id = ?")) {
              const tenantId = String(call.bound?.[bindOffset++] ?? "default");
              filtered = filtered.filter(
                (row) => String(row.tenant_id ?? "default") === tenantId,
              );
            }
            const start = call.bound?.[bindOffset + 1] ?? call.bound?.[bindOffset] ?? null;
            const end = call.bound?.[bindOffset + 3] ?? call.bound?.[bindOffset + 2] ?? null;
            filtered = applyDateRange(filtered, start, end);
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
            normalized.includes("SELECT substr(timestamp, 1, 10) AS day") &&
            normalized.includes("COUNT(*) AS total_installations") &&
            normalized.includes("GROUP BY substr(timestamp, 1, 10) ORDER BY day ASC")
          ) {
            let bindOffset = 0;
            let filtered = [...state.installations];
            if (normalized.includes("WHERE tenant_id = ?")) {
              const tenantId = String(call.bound?.[bindOffset++] ?? "default");
              filtered = filtered.filter(
                (row) => String(row.tenant_id ?? "default") === tenantId,
              );
            }

            const start = String(call.bound?.[bindOffset] ?? "");
            const end = String(call.bound?.[bindOffset + 1] ?? "");
            filtered = filtered.filter((row) => {
              const ts = String(row.timestamp ?? "");
              return ts.localeCompare(start) >= 0 && ts.localeCompare(end) < 0;
            });

            const grouped = new Map();
            for (const row of filtered) {
              const timestamp = String(row.timestamp ?? "");
              const day = timestamp.slice(0, 10);
              if (!day) continue;
              const current = grouped.get(day) || {
                day,
                total_installations: 0,
                successful_installations: 0,
                failed_installations: 0,
              };
              current.total_installations += 1;
              if (String(row.status ?? "").toLowerCase() === "success") {
                current.successful_installations += 1;
              } else if (String(row.status ?? "").toLowerCase() === "failed") {
                current.failed_installations += 1;
              }
              grouped.set(day, current);
            }

            const results = [...grouped.values()].sort((a, b) => String(a.day).localeCompare(String(b.day)));
            return { results };
          }

          if (
            normalized.startsWith(
              "SELECT TRIM(driver_brand) AS brand, TRIM(driver_version) AS version, COUNT(*) AS count FROM installations",
            )
          ) {
            let filtered = [...state.installations];
            let bindOffset = 0;
            if (normalized.includes("WHERE tenant_id = ?")) {
              const tenantId = String(call.bound?.[bindOffset++] ?? "default");
              filtered = filtered.filter(
                (row) => String(row.tenant_id ?? "default") === tenantId,
              );
            }
            const start = call.bound?.[bindOffset + 1] ?? call.bound?.[bindOffset] ?? null;
            const end = call.bound?.[bindOffset + 3] ?? call.bound?.[bindOffset + 2] ?? null;
            filtered = applyDateRange(filtered, start, end);
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

          if (
            normalized.startsWith("SELECT gps_capture_status, gps_accuracy_m FROM installations")
          ) {
            let filtered = [...state.installations];
            let bindOffset = 0;
            if (normalized.includes("WHERE tenant_id = ?")) {
              const tenantId = String(call.bound?.[bindOffset++] ?? "default");
              filtered = filtered.filter(
                (row) => String(row.tenant_id ?? "default") === tenantId,
              );
            }
            const start = call.bound?.[bindOffset + 1] ?? call.bound?.[bindOffset] ?? null;
            const end = call.bound?.[bindOffset + 3] ?? call.bound?.[bindOffset + 2] ?? null;
            filtered = applyDateRange(filtered, start, end);
            return {
              results: filtered.map((row) => ({
                gps_capture_status: row.gps_capture_status,
                gps_accuracy_m: row.gps_accuracy_m,
              })),
            };
          }

          if (
            normalized.includes("SUM(CASE WHEN LOWER(COALESCE(incident_status, 'open')) = 'open' THEN 1 ELSE 0 END) AS incident_open_count") &&
            normalized.includes("FROM incidents WHERE installation_id = ?")
          ) {
            const installationId = Number(call.bound?.[0]);
            const tenantId = String(call.bound?.[1] ?? "default");
            const filtered = state.incidents.filter(
              (row) =>
                Number(row.installation_id) === installationId &&
                String(row.tenant_id ?? "default") === tenantId &&
                !row.deleted_at,
            );
            return {
              results: [
                {
                  incident_open_count: filtered.filter((row) => normalizeStatus(row.incident_status || "open") === "open").length,
                  incident_in_progress_count: filtered.filter((row) => normalizeStatus(row.incident_status || "open") === "in_progress").length,
                  incident_paused_count: filtered.filter((row) => normalizeStatus(row.incident_status || "open") === "paused").length,
                  incident_resolved_count: filtered.filter((row) => normalizeStatus(row.incident_status || "open") === "resolved").length,
                },
              ],
            };
          }

          if (
            normalized.startsWith("SELECT id, incident_status, created_at, status_updated_at, resolved_at FROM incidents")
          ) {
            const installationId = Number(call.bound?.[0]);
            const tenantId = String(call.bound?.[1] ?? "default");
            const rows = state.incidents
              .filter(
                (row) =>
                  Number(row.installation_id) === installationId &&
                  String(row.tenant_id ?? "default") === tenantId &&
                  !row.deleted_at,
              )
              .sort((left, right) => {
                const leftTs = String(left.status_updated_at ?? left.created_at ?? "");
                const rightTs = String(right.status_updated_at ?? right.created_at ?? "");
                const byTs = rightTs.localeCompare(leftTs);
                if (byTs !== 0) return byTs;
                return Number(right.id) - Number(left.id);
              })
              .map((row) => ({
                id: row.id,
                incident_status: row.incident_status,
                created_at: row.created_at ?? null,
                status_updated_at: row.status_updated_at ?? null,
                resolved_at: row.resolved_at ?? null,
              }));
            return { results: rows.slice(0, 1) };
          }

          if (
            normalized.startsWith("SELECT gps_capture_status, gps_accuracy_m FROM incidents")
          ) {
            let filtered = [...state.incidents];
            let bindOffset = 0;
            if (normalized.includes("WHERE tenant_id = ?")) {
              const tenantId = String(call.bound?.[bindOffset++] ?? "default");
              filtered = filtered.filter(
                (row) => String(row.tenant_id ?? "default") === tenantId,
              );
            }
            const start = call.bound?.[bindOffset + 1] ?? call.bound?.[bindOffset] ?? null;
            const end = call.bound?.[bindOffset + 3] ?? call.bound?.[bindOffset + 2] ?? null;
            filtered = applyDateRange(filtered, start, end, "created_at");
            return {
              results: filtered.map((row) => ({
                gps_capture_status: row.gps_capture_status,
                gps_accuracy_m: row.gps_accuracy_m,
              })),
            };
          }

          if (
            normalized.startsWith(
              "SELECT id, external_code, client_name, brand, model FROM assets WHERE id = ? AND tenant_id = ? LIMIT 1",
            )
          ) {
            const assetId = Number(call.bound?.[0]);
            const tenantId = String(call.bound?.[1] ?? "default");
            const rows = state.assets
              .filter(
                (row) =>
                  Number(row.id) === assetId &&
                  String(row.tenant_id ?? "default") === tenantId,
              )
              .map((row) => ({
                id: row.id,
                external_code: row.external_code,
                client_name: row.client_name,
                brand: row.brand,
                model: row.model,
              }));
            return { results: rows.slice(0, 1) };
          }

          if (
            normalized.startsWith(
              "SELECT id FROM asset_loans WHERE tenant_id = ? AND asset_id = ? AND returned_at IS NULL LIMIT 1",
            )
          ) {
            const tenantId = String(call.bound?.[0] ?? "default");
            const assetId = Number(call.bound?.[1]);
            const rows = state.assetLoans
              .filter(
                (row) =>
                  String(row.tenant_id ?? "default") === tenantId &&
                  Number(row.asset_id) === assetId &&
                  !row.returned_at,
              )
              .map((row) => ({ id: row.id }));
            return { results: rows.slice(0, 1) };
          }

          if (
            normalized.startsWith(
              "SELECT l.*, a.external_code AS asset_external_code, a.brand AS asset_brand, a.model AS asset_model FROM asset_loans l LEFT JOIN assets a ON a.id = l.asset_id AND a.tenant_id = l.tenant_id WHERE l.tenant_id = ?",
            )
          ) {
            let bindIndex = 0;
            const tenantId = String(call.bound?.[bindIndex++] ?? "default");
            let rows = state.assetLoans.filter(
              (row) => String(row.tenant_id ?? "default") === tenantId,
            );

            if (normalized.includes("AND l.asset_id = ?")) {
              const assetId = Number(call.bound?.[bindIndex++]);
              rows = rows.filter((row) => Number(row.asset_id) === assetId);
            }

            if (
              normalized.includes(
                "AND l.returned_at IS NULL AND (l.expected_return_at IS NULL OR l.expected_return_at >= ?)",
              )
            ) {
              const threshold = String(call.bound?.[bindIndex++] ?? "");
              rows = rows.filter(
                (row) =>
                  !row.returned_at &&
                  (!row.expected_return_at || String(row.expected_return_at) >= threshold),
              );
            } else if (
              normalized.includes(
                "AND l.returned_at IS NULL AND l.expected_return_at IS NOT NULL AND l.expected_return_at >= ? AND l.expected_return_at <= ?",
              )
            ) {
              const fromIso = String(call.bound?.[bindIndex++] ?? "");
              const toIso = String(call.bound?.[bindIndex++] ?? "");
              rows = rows.filter(
                (row) =>
                  !row.returned_at &&
                  row.expected_return_at &&
                  String(row.expected_return_at) >= fromIso &&
                  String(row.expected_return_at) <= toIso,
              );
            } else if (
              normalized.includes(
                "AND l.returned_at IS NULL AND l.expected_return_at IS NOT NULL AND l.expected_return_at < ?",
              )
            ) {
              const threshold = String(call.bound?.[bindIndex++] ?? "");
              rows = rows.filter(
                (row) =>
                  !row.returned_at &&
                  row.expected_return_at &&
                  String(row.expected_return_at) < threshold,
              );
            } else if (normalized.includes("AND l.returned_at IS NOT NULL")) {
              rows = rows.filter((row) => Boolean(row.returned_at));
            }

            const limit = Math.max(1, Number(call.bound?.[bindIndex] ?? rows.length));
            rows.sort((left, right) => {
              const byLoanedAt = String(right.loaned_at ?? "").localeCompare(String(left.loaned_at ?? ""));
              if (byLoanedAt !== 0) return byLoanedAt;
              return Number(right.id) - Number(left.id);
            });

            return {
              results: rows.slice(0, limit).map((row) => {
                const asset = state.assets.find(
                  (entry) =>
                    Number(entry.id) === Number(row.asset_id) &&
                    String(entry.tenant_id ?? "default") === String(row.tenant_id ?? "default"),
                );
                return {
                  ...row,
                  asset_external_code: asset?.external_code || null,
                  asset_brand: asset?.brand || null,
                  asset_model: asset?.model || null,
                };
              }),
            };
          }

          if (
            normalized.startsWith(
              "SELECT l.*, a.external_code AS asset_external_code FROM asset_loans l LEFT JOIN assets a ON a.id = l.asset_id AND a.tenant_id = l.tenant_id WHERE l.id = ? AND l.tenant_id = ? LIMIT 1",
            )
          ) {
            const loanId = Number(call.bound?.[0]);
            const tenantId = String(call.bound?.[1] ?? "default");
            const loan = state.assetLoans.find(
              (row) =>
                Number(row.id) === loanId &&
                String(row.tenant_id ?? "default") === tenantId,
            );
            if (!loan) return { results: [] };
            const asset = state.assets.find(
              (entry) =>
                Number(entry.id) === Number(loan.asset_id) &&
                String(entry.tenant_id ?? "default") === tenantId,
            );
            return {
              results: [{
                ...loan,
                asset_external_code: asset?.external_code || null,
              }],
            };
          }

          if (
            normalized.startsWith(
              "SELECT l.*, a.external_code AS asset_external_code, a.brand AS asset_brand, a.model AS asset_model FROM asset_loans l LEFT JOIN assets a ON a.id = l.asset_id AND a.tenant_id = l.tenant_id WHERE l.returned_at IS NULL AND l.expected_return_at IS NOT NULL ORDER BY l.expected_return_at ASC, l.id ASC",
            )
          ) {
            const rows = [...state.assetLoans]
              .filter((row) => !row.returned_at && row.expected_return_at)
              .sort((left, right) => {
                const byExpected = String(left.expected_return_at ?? "").localeCompare(String(right.expected_return_at ?? ""));
                if (byExpected !== 0) return byExpected;
                return Number(left.id) - Number(right.id);
              })
              .map((row) => {
                const asset = state.assets.find(
                  (entry) =>
                    Number(entry.id) === Number(row.asset_id) &&
                    String(entry.tenant_id ?? "default") === String(row.tenant_id ?? "default"),
                );
                return {
                  ...row,
                  asset_external_code: asset?.external_code || null,
                  asset_brand: asset?.brand || null,
                  asset_model: asset?.model || null,
                };
              });
            return { results: rows };
          }

          if (
            normalized.startsWith(
              "SELECT SUM(CASE WHEN returned_at IS NULL AND expected_return_at IS NOT NULL AND expected_return_at >= ? AND expected_return_at <= ? THEN 1 ELSE 0 END) AS loan_due_soon_count, SUM(CASE WHEN returned_at IS NULL AND expected_return_at IS NOT NULL AND expected_return_at < ? THEN 1 ELSE 0 END) AS loan_overdue_count FROM asset_loans WHERE tenant_id = ?",
            )
          ) {
            const [currentIso, dueSoonCutoffIso, overdueCurrentIso, tenantId] = call.bound || [];
            const filtered = state.assetLoans.filter(
              (row) => String(row.tenant_id ?? "default") === String(tenantId ?? "default"),
            );
            return {
              results: [{
                loan_due_soon_count: filtered.filter(
                  (row) =>
                    !row.returned_at &&
                    row.expected_return_at &&
                    String(row.expected_return_at) >= String(currentIso) &&
                    String(row.expected_return_at) <= String(dueSoonCutoffIso),
                ).length,
                loan_overdue_count: filtered.filter(
                  (row) =>
                    !row.returned_at &&
                    row.expected_return_at &&
                    String(row.expected_return_at) < String(overdueCurrentIso),
                ).length,
              }],
            };
          }

          if (
            normalized.startsWith("SELECT action, COUNT(*) AS count FROM audit_logs")
          ) {
            let filtered = [...state.auditLogs];
            let bindOffset = 0;
            if (normalized.includes("WHERE tenant_id = ?")) {
              const tenantId = String(call.bound?.[bindOffset++] ?? "default");
              filtered = filtered.filter(
                (row) => String(row.tenant_id ?? "default") === tenantId,
              );
            }
            const start = call.bound?.[bindOffset + 1] ?? call.bound?.[bindOffset] ?? null;
            const end = call.bound?.[bindOffset + 3] ?? call.bound?.[bindOffset + 2] ?? null;
            filtered = applyDateRange(filtered, start, end);
            bindOffset += normalized.includes("(? IS NULL OR timestamp < ?)") ? 4 : 0;
            const allowedActions = new Set(
              (call.bound || [])
                .slice(bindOffset)
                .map((value) => String(value || "").trim())
                .filter(Boolean),
            );
            if (allowedActions.size > 0) {
              filtered = filtered.filter((row) => allowedActions.has(String(row.action || "").trim()));
            }
            const counts = new Map();
            for (const row of filtered) {
              const action = String(row.action || "").trim();
              if (!action) continue;
              counts.set(action, (counts.get(action) || 0) + 1);
            }
            return {
              results: [...counts.entries()].map(([action, count]) => ({ action, count })),
            };
          }

          if (normalized.startsWith("SELECT driver_brand, COUNT(*) as count FROM installations")) {
            return { results: state.byBrand };
          }

          if (
            normalized.startsWith(
              "SELECT id, notes, installation_time_seconds, site_lat, site_lng, site_radius_m FROM installations WHERE id = ?",
            ) ||
            normalized.startsWith("SELECT id, notes, installation_time_seconds FROM installations WHERE id = ?")
          ) {
            const id = Number(call.bound?.[0]);
            const tenantId = normalized.includes("tenant_id = ?")
              ? String(call.bound?.[1] ?? "default")
              : null;
            const row = state.installations.find(
              (item) =>
                Number(item.id) === id &&
                (!tenantId || String(item.tenant_id ?? "default") === tenantId),
            );
            return { results: row ? [row] : [] };
          }

          if (normalized.startsWith("SELECT id FROM installations WHERE id = ? AND tenant_id = ? LIMIT 1")) {
            const id = Number(call.bound?.[0]);
            const tenantId = String(call.bound?.[1] ?? "default");
            const row = state.installations.find(
              (item) =>
                Number(item.id) === id &&
                String(item.tenant_id ?? "default") === tenantId,
            );
            return { results: row ? [{ id: row.id }] : [] };
          }

          if (normalized.startsWith("SELECT id FROM installations WHERE id = ? LIMIT 1")) {
            const id = Number(call.bound?.[0]);
            const row = state.installations.find((item) => Number(item.id) === id);
            return { results: row ? [{ id: row.id }] : [] };
          }

          if (
            normalized.startsWith("SELECT id, installation_id") &&
            normalized.includes("FROM incidents") &&
            normalized.includes("WHERE installation_id = ?")
          ) {
            const installationId = Number(call.bound?.[0]);
            const tenantId = String(call.bound?.[1] ?? "default");
            const rows = state.incidents
              .filter((item) => Number(item.installation_id) === installationId)
              .filter(
                (item) =>
                  !normalized.includes("AND tenant_id = ?") ||
                  String(item.tenant_id ?? "default") === tenantId,
              )
              .filter((item) => !normalized.includes("deleted_at IS NULL") || isIncidentVisible(item))
              .sort((a, b) => {
                const byCreated = String(b.created_at ?? "").localeCompare(String(a.created_at ?? ""));
                if (byCreated !== 0) return byCreated;
                return Number(b.id) - Number(a.id);
              });
            return { results: rows };
          }

          if (
            normalized.startsWith(
              "SELECT installation_id, SUM(CASE WHEN LOWER(COALESCE(incident_status, 'open')) = 'open' THEN 1 ELSE 0 END) AS incident_open_count",
            ) &&
            normalized.includes("FROM incidents") &&
            normalized.includes("GROUP BY installation_id")
          ) {
            let bindIndex = 0;
            let tenantId = null;
            if (normalized.includes("WHERE tenant_id = ?")) {
              tenantId = String(call.bound?.[bindIndex++] ?? "default");
            }

            const installationIds = (call.bound || [])
              .slice(bindIndex)
              .map((value) => Number(value))
              .filter((value) => Number.isInteger(value) && value > 0);
            const installationIdSet = new Set(installationIds);

            const grouped = new Map();
            for (const incident of state.incidents) {
              if (normalized.includes("deleted_at IS NULL") && !isIncidentVisible(incident)) continue;
              const installationId = Number(incident.installation_id);
              if (!installationIdSet.has(installationId)) continue;
              if (tenantId && String(incident.tenant_id ?? "default") !== tenantId) continue;

              const status = String(incident.incident_status ?? "open").toLowerCase();
              const normalizedStatus =
                status === "in_progress" || status === "paused" || status === "resolved"
                  ? status
                  : "open";
              const severity = String(incident.severity ?? "").toLowerCase();
              const current = grouped.get(installationId) || {
                installation_id: installationId,
                incident_open_count: 0,
                incident_in_progress_count: 0,
                incident_paused_count: 0,
                incident_resolved_count: 0,
                incident_active_count: 0,
                incident_critical_active_count: 0,
              };

              if (normalizedStatus === "resolved") {
                current.incident_resolved_count += 1;
              } else if (normalizedStatus === "in_progress") {
                current.incident_in_progress_count += 1;
                current.incident_active_count += 1;
                if (severity === "critical") {
                  current.incident_critical_active_count += 1;
                }
              } else if (normalizedStatus === "paused") {
                current.incident_paused_count += 1;
                current.incident_active_count += 1;
                if (severity === "critical") {
                  current.incident_critical_active_count += 1;
                }
              } else {
                current.incident_open_count += 1;
                current.incident_active_count += 1;
                if (severity === "critical") {
                  current.incident_critical_active_count += 1;
                }
              }
              grouped.set(installationId, current);
            }

            return { results: [...grouped.values()] };
          }

          if (
            normalized.startsWith(
              "SELECT SUM(CASE WHEN LOWER(COALESCE(incident_status, 'open')) = 'in_progress' THEN 1 ELSE 0 END) AS incident_in_progress_count",
            ) &&
            normalized.includes("FROM incidents") &&
            normalized.includes("WHERE tenant_id = ?")
          ) {
            const [outsideSlaCutoffIso, tenantId] = call.bound || [];
            const tenant = String(tenantId ?? "default");
            const cutoffIso = String(outsideSlaCutoffIso || "");
            let inProgressCount = 0;
            let criticalActiveCount = 0;
            let outsideSlaCount = 0;

            for (const incident of state.incidents) {
              if (String(incident.tenant_id ?? "default") !== tenant) continue;
              if (normalized.includes("deleted_at IS NULL") && !isIncidentVisible(incident)) continue;
              const status = String(incident.incident_status ?? "open").toLowerCase();
              const active = status === "open" || status === "in_progress" || status === "paused";
              if (status === "in_progress") {
                inProgressCount += 1;
              }
              if (active && String(incident.severity ?? "").toLowerCase() === "critical") {
                criticalActiveCount += 1;
              }
              if (active && cutoffIso && String(incident.created_at ?? "") < cutoffIso) {
                outsideSlaCount += 1;
              }
            }

            return {
              results: [
                {
                  incident_in_progress_count: inProgressCount,
                  incident_critical_active_count: criticalActiveCount,
                  incident_outside_sla_count: outsideSlaCount,
                },
              ],
            };
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
                .filter((item) => !normalized.includes("i.deleted_at IS NULL") || isIncidentVisible(item))
                .map((item) => Number(item.id)),
            );
            const rows = state.incidentPhotos.filter((item) => incidentIds.has(Number(item.incident_id)));
            return { results: rows };
          }

          if (
            normalized.startsWith(
              "SELECT p.r2_key FROM incident_photos p INNER JOIN incidents i ON i.id = p.incident_id WHERE i.installation_id = ? AND i.tenant_id = ?",
            )
          ) {
            const installationId = Number(call.bound?.[0]);
            const tenantId = String(call.bound?.[1] ?? "default");
            const incidentIds = new Set(
              state.incidents
                .filter(
                  (item) =>
                    Number(item.installation_id) === installationId &&
                    String(item.tenant_id ?? "default") === tenantId,
                )
                .filter((item) => !normalized.includes("i.deleted_at IS NULL") || isIncidentVisible(item))
                .map((item) => Number(item.id)),
            );
            const rows = state.incidentPhotos
              .filter((item) => incidentIds.has(Number(item.incident_id)))
              .map((item) => ({ r2_key: item.r2_key }));
            return { results: rows };
          }

          if (
            normalized.startsWith(
              "SELECT p.r2_key FROM incident_photos p INNER JOIN incidents i ON i.id = p.incident_id WHERE i.installation_id = ?",
            )
          ) {
            const installationId = Number(call.bound?.[0]);
            const incidentIds = new Set(
              state.incidents
                .filter((item) => Number(item.installation_id) === installationId)
                .map((item) => Number(item.id)),
            );
            const rows = state.incidentPhotos
              .filter((item) => incidentIds.has(Number(item.incident_id)))
              .map((item) => ({ r2_key: item.r2_key }));
            return { results: rows };
          }

          if (
            normalized.startsWith(
              "SELECT p.id, p.r2_key FROM incident_photos p LEFT JOIN incidents i ON i.id = p.incident_id AND i.tenant_id = p.tenant_id LEFT JOIN installations ins ON ins.id = i.installation_id AND ins.tenant_id = i.tenant_id WHERE p.tenant_id = ? AND (i.id IS NULL OR ins.id IS NULL)",
            )
          ) {
            const tenantId = String(call.bound?.[0] ?? "default");
            const rows = state.incidentPhotos
              .filter((photo) => String(photo.tenant_id ?? "default") === tenantId)
              .filter((photo) => {
                const incident = state.incidents.find((item) => Number(item.id) === Number(photo.incident_id));
                if (!incident || String(incident.tenant_id ?? "default") !== tenantId) return true;
                const installation = state.installations.find(
                  (item) =>
                    Number(item.id) === Number(incident.installation_id) &&
                    String(item.tenant_id ?? "default") === tenantId,
                );
                return !installation;
              })
              .map((photo) => ({
                id: photo.id,
                r2_key: photo.r2_key,
              }));
            return { results: rows };
          }

          if (
            normalized.startsWith(
              "SELECT p.id, p.r2_key FROM incident_photos p LEFT JOIN incidents i ON i.id = p.incident_id LEFT JOIN installations ins ON ins.id = i.installation_id WHERE i.id IS NULL OR ins.id IS NULL",
            )
          ) {
            const rows = state.incidentPhotos
              .filter((photo) => {
                const incident = state.incidents.find((item) => Number(item.id) === Number(photo.incident_id));
                if (!incident) return true;
                const installation = state.installations.find(
                  (item) => Number(item.id) === Number(incident.installation_id),
                );
                return !installation;
              })
              .map((photo) => ({
                id: photo.id,
                r2_key: photo.r2_key,
              }));
            return { results: rows };
          }

          if (
            normalized.startsWith(
              "SELECT i.id FROM incidents i LEFT JOIN installations ins ON ins.id = i.installation_id AND ins.tenant_id = i.tenant_id WHERE i.tenant_id = ? AND ins.id IS NULL",
            )
          ) {
            const tenantId = String(call.bound?.[0] ?? "default");
            const rows = state.incidents
              .filter((incident) => String(incident.tenant_id ?? "default") === tenantId)
              .filter((incident) => {
                const installation = state.installations.find(
                  (item) =>
                    Number(item.id) === Number(incident.installation_id) &&
                    String(item.tenant_id ?? "default") === tenantId,
                );
                return !installation;
              })
              .map((incident) => ({ id: incident.id }));
            return { results: rows };
          }

          if (
            normalized.startsWith(
              "SELECT i.id FROM incidents i LEFT JOIN installations ins ON ins.id = i.installation_id WHERE ins.id IS NULL",
            )
          ) {
            const rows = state.incidents
              .filter((incident) => {
                const installation = state.installations.find(
                  (item) => Number(item.id) === Number(incident.installation_id),
                );
                return !installation;
              })
              .map((incident) => ({ id: incident.id }));
            return { results: rows };
          }

          if (normalized.startsWith("SELECT id, installation_id FROM incidents WHERE id = ?")) {
            const id = Number(call.bound?.[0]);
            const row = state.incidents.find((item) => Number(item.id) === id);
            if (normalized.includes("deleted_at IS NULL") && !isIncidentVisible(row)) {
              return { results: [] };
            }
            return { results: row ? [row] : [] };
          }

          if (
            normalized.startsWith(
              "SELECT estimated_duration_seconds, work_started_at, work_ended_at, actual_duration_seconds FROM incidents WHERE id = ? AND tenant_id = ?",
            )
          ) {
            const incidentId = Number(call.bound?.[0]);
            const tenantId = String(call.bound?.[1] ?? "default");
            const row = state.incidents.find(
              (item) =>
                Number(item.id) === incidentId &&
                String(item.tenant_id ?? "default") === tenantId,
            );
            if (normalized.includes("deleted_at IS NULL") && !isIncidentVisible(row)) {
              return { results: [] };
            }
            if (!row) {
              return { results: [] };
            }
            return {
              results: [
                {
                  estimated_duration_seconds: row.estimated_duration_seconds ?? 0,
                  work_started_at: row.work_started_at ?? null,
                  work_ended_at: row.work_ended_at ?? null,
                  actual_duration_seconds: row.actual_duration_seconds ?? null,
                },
              ],
            };
          }

          if (
            normalized.startsWith("SELECT i.id, i.installation_id") &&
            normalized.includes("FROM incidents i INNER JOIN installations inst ON inst.id = i.installation_id") &&
            normalized.includes("WHERE i.id = ?") &&
            normalized.includes("i.tenant_id = ?") &&
            normalized.includes("inst.tenant_id = ?")
          ) {
            const incidentId = Number(call.bound?.[0]);
            const incidentTenantId = String(call.bound?.[1] ?? "default");
            const installationTenantId = String(call.bound?.[2] ?? incidentTenantId);
            const installationIdFilter =
              normalized.includes("AND i.installation_id = ?") ? Number(call.bound?.[3]) : null;

            const incident = state.incidents.find(
              (item) =>
                Number(item.id) === incidentId &&
                String(item.tenant_id ?? "default") === incidentTenantId,
            );
            if (normalized.includes("i.deleted_at IS NULL") && !isIncidentVisible(incident)) {
              return { results: [] };
            }
            if (!incident) return { results: [] };

            const installation = state.installations.find(
              (item) =>
                Number(item.id) === Number(incident.installation_id) &&
                String(item.tenant_id ?? "default") === installationTenantId,
            );
            if (!installation) return { results: [] };
            if (
              Number.isInteger(installationIdFilter) &&
              installationIdFilter > 0 &&
              Number(incident.installation_id) !== installationIdFilter
            ) {
              return { results: [] };
            }

            return {
              results: [
                {
                  id: incident.id,
                  installation_id: incident.installation_id,
                  asset_id: incident.asset_id ?? null,
                  reporter_username: incident.reporter_username,
                  note: incident.note,
                  time_adjustment_seconds: incident.time_adjustment_seconds,
                  estimated_duration_seconds: incident.estimated_duration_seconds ?? null,
                  severity: incident.severity,
                  source: incident.source,
                  created_at: incident.created_at,
                  incident_status: incident.incident_status ?? "open",
                  status_updated_at: incident.status_updated_at ?? null,
                  status_updated_by: incident.status_updated_by ?? null,
                  resolved_at: incident.resolved_at ?? null,
                  resolved_by: incident.resolved_by ?? null,
                  resolution_note: incident.resolution_note ?? null,
                  checklist_json: incident.checklist_json ?? null,
                  evidence_note: incident.evidence_note ?? null,
                  work_started_at: incident.work_started_at ?? null,
                  work_ended_at: incident.work_ended_at ?? null,
                  actual_duration_seconds: incident.actual_duration_seconds ?? null,
                  geofence_distance_m: incident.geofence_distance_m ?? null,
                  geofence_radius_m: incident.geofence_radius_m ?? null,
                  geofence_result: incident.geofence_result ?? "not_applicable",
                  geofence_checked_at: incident.geofence_checked_at ?? null,
                  gps_lat: incident.gps_lat ?? null,
                  gps_lng: incident.gps_lng ?? null,
                  gps_accuracy_m: incident.gps_accuracy_m ?? null,
                  gps_captured_at: incident.gps_captured_at ?? null,
                  gps_capture_source: incident.gps_capture_source ?? "none",
                  gps_capture_status: incident.gps_capture_status ?? "pending",
                  gps_capture_note: incident.gps_capture_note ?? "",
                },
              ],
            };
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
              "SELECT p.id, p.incident_id, p.r2_key, p.file_name, p.content_type, p.size_bytes, p.sha256, p.created_at FROM incident_photos p INNER JOIN incidents i ON i.id = p.incident_id WHERE p.id = ?",
            )
          ) {
            const photoId = Number(call.bound?.[0]);
            const photoTenantId = String(call.bound?.[1] ?? "default");
            const incidentTenantId = String(call.bound?.[2] ?? photoTenantId);
            const photo = state.incidentPhotos.find(
              (item) =>
                Number(item.id) === photoId &&
                String(item.tenant_id ?? photoTenantId) === photoTenantId,
            );
            if (!photo) return { results: [] };
            const incident = state.incidents.find(
              (item) =>
                Number(item.id) === Number(photo.incident_id) &&
                String(item.tenant_id ?? incidentTenantId) === incidentTenantId,
            );
            if (normalized.includes("i.deleted_at IS NULL") && !isIncidentVisible(incident)) {
              return { results: [] };
            }
            if (!incident) return { results: [] };
            return {
              results: [
                {
                  id: photo.id,
                  incident_id: photo.incident_id,
                  r2_key: photo.r2_key,
                  file_name: photo.file_name,
                  content_type: photo.content_type,
                  size_bytes: photo.size_bytes,
                  sha256: photo.sha256,
                  created_at: photo.created_at,
                },
              ],
            };
          }

          if (
            normalized.startsWith(
              "SELECT id, timestamp, action, username, success, details, computer_name, ip_address, platform FROM audit_logs",
            )
          ) {
            let rows = [...state.auditLogs].sort((a, b) => {
              const byTimestamp = String(b.timestamp ?? "").localeCompare(String(a.timestamp ?? ""));
              if (byTimestamp !== 0) return byTimestamp;
              return Number(b.id) - Number(a.id);
            });

            let bindIndex = 0;
            if (normalized.includes("WHERE tenant_id = ?")) {
              const tenantId = String(call.bound?.[bindIndex++] ?? "default");
              rows = rows.filter(
                (row) => String(row.tenant_id ?? "default") === tenantId,
              );
            }
            if (normalized.includes("WHERE (timestamp < ? OR (timestamp = ? AND id < ?))")) {
              const cursorTs = String(call.bound?.[bindIndex++] ?? "");
              const cursorTsEq = String(call.bound?.[bindIndex++] ?? "");
              const cursorId = Number(call.bound?.[bindIndex++] ?? 0);
              rows = rows.filter((row) => {
                const ts = String(row.timestamp ?? "");
                if (ts.localeCompare(cursorTs) < 0) return true;
                return ts === cursorTsEq && Number(row.id) < cursorId;
              });
            }
            if (normalized.includes("AND (timestamp < ? OR (timestamp = ? AND id < ?))")) {
              const cursorTs = String(call.bound?.[bindIndex++] ?? "");
              const cursorTsEq = String(call.bound?.[bindIndex++] ?? "");
              const cursorId = Number(call.bound?.[bindIndex++] ?? 0);
              rows = rows.filter((row) => {
                const ts = String(row.timestamp ?? "");
                if (ts.localeCompare(cursorTs) < 0) return true;
                return ts === cursorTsEq && Number(row.id) < cursorId;
              });
            }

            const limit = Math.max(1, Number(call.bound?.[bindIndex]) || 100);
            return { results: rows.slice(0, limit) };
          }

          if (normalized === "SELECT COUNT(*) AS total FROM web_users") {
            return { results: [{ total: state.webUsers.length }] };
          }

          if (
            normalized.startsWith(
              "SELECT id, username, password_hash, password_hash_type, role, is_active, created_at, updated_at, last_login_at, tenant_id FROM web_users WHERE username = ? LIMIT 1",
            )
          ) {
            const username = String(call.bound?.[0] ?? "");
            const row = state.webUsers.find((item) => item.username === username);
            return { results: row ? [row] : [] };
          }

          if (
            normalized.startsWith(
              "SELECT id, username, password_hash, password_hash_type, role, is_active, created_at, updated_at, last_login_at, tenant_id FROM web_users WHERE id = ? LIMIT 1",
            )
          ) {
            const userId = Number(call.bound?.[0]);
            const row = state.webUsers.find((item) => Number(item.id) === userId);
            return { results: row ? [row] : [] };
          }

          if (
            normalized.startsWith(
              "SELECT id, username, role, is_active, created_at, updated_at, last_login_at, tenant_id FROM web_users",
            )
          ) {
            let rows = [...state.webUsers];
            let bindIndex = 0;
            if (normalized.includes("WHERE tenant_id = ?")) {
              const tenantId = String(call.bound?.[bindIndex++] ?? "default");
              rows = rows.filter((row) => String(row.tenant_id ?? "default") === tenantId);
            }
            if (normalized.includes("(username > ? OR (username = ? AND id > ?))")) {
              const cursorUsername = String(call.bound?.[bindIndex++] ?? "");
              const cursorUsernameEq = String(call.bound?.[bindIndex++] ?? "");
              const cursorId = Number(call.bound?.[bindIndex++] ?? 0);
              rows = rows.filter((row) => {
                const username = String(row.username ?? "");
                if (username.localeCompare(cursorUsername) > 0) return true;
                return username === cursorUsernameEq && Number(row.id) > cursorId;
              });
            }
            rows.sort((a, b) => {
              const byUsername = String(a.username).localeCompare(String(b.username));
              if (byUsername !== 0) return byUsername;
              return Number(a.id) - Number(b.id);
            });
            const limit = Math.max(1, Number(call.bound?.[bindIndex]) || rows.length);
            const limited = rows.slice(0, limit);
            return {
              results: limited.map((row) => ({
                id: row.id,
                username: row.username,
                role: row.role,
                is_active: row.is_active,
                created_at: row.created_at,
                updated_at: row.updated_at,
                last_login_at: row.last_login_at ?? null,
                tenant_id: row.tenant_id ?? "default",
              })),
            };
          }

          if (
            normalized.startsWith(
              "SELECT DISTINCT dt.fcm_token FROM device_tokens dt INNER JOIN web_users wu ON wu.id = dt.user_id WHERE wu.is_active = 1 AND wu.role IN (",
            )
          ) {
            let roleBindings = [...(call.bound || [])];
            let tenantId = null;
            if (
              normalized.includes("AND wu.tenant_id = ?") &&
              normalized.includes("AND dt.tenant_id = ?") &&
              roleBindings.length >= 2
            ) {
              tenantId = String(roleBindings[roleBindings.length - 2] ?? "default");
              roleBindings = roleBindings.slice(0, -2);
            }

            const roles = roleBindings.map((value) => String(value ?? "").toLowerCase());
            const allowedRoles = new Set(roles);
            const activeUserIds = new Set(
              state.webUsers
                .filter(
                  (user) =>
                    Number(user.is_active) === 1 &&
                    allowedRoles.has(String(user.role ?? "").toLowerCase()) &&
                    (!tenantId || String(user.tenant_id ?? "default") === tenantId),
                )
                .map((user) => Number(user.id)),
            );

            const unique = new Set();
            for (const row of state.deviceTokens) {
              const token = String(row.fcm_token ?? "").trim();
              if (!token) continue;
              if (!activeUserIds.has(Number(row.user_id))) continue;
              if (tenantId && String(row.tenant_id ?? "default") !== tenantId) continue;
              unique.add(token);
            }

            return {
              results: [...unique].map((token) => ({ fcm_token: token })),
            };
          }

          throw new Error(`Unexpected query for .all(): ${normalized}`);
        },
        async run() {
          if (
            normalized.startsWith(
              "INSERT INTO audit_logs ( tenant_id, timestamp, action, username, success, details, computer_name, ip_address, platform ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            )
          ) {
            const id = nextAuditLogId++;
            const [
              tenantId,
              timestamp,
              action,
              username,
              success,
              details,
              computerName,
              ipAddress,
              platform,
            ] = call.bound;
            state.auditLogs.push({
              id,
              tenant_id: tenantId,
              timestamp,
              action,
              username,
              success,
              details,
              computer_name: computerName,
              ip_address: ipAddress,
              platform,
            });
            return { success: true, meta: { last_row_id: id, changes: 1 } };
          }

          if (
            normalized.startsWith(
              "INSERT INTO audit_logs (timestamp, action, username, success, details, computer_name, ip_address, platform) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            )
          ) {
            const id = nextAuditLogId++;
            const [timestamp, action, username, success, details, computerName, ipAddress, platform] = call.bound;
            state.auditLogs.push({
              id,
              tenant_id: "default",
              timestamp,
              action,
              username,
              success,
              details,
              computer_name: computerName,
              ip_address: ipAddress,
              platform,
            });
            return { success: true, meta: { last_row_id: id, changes: 1 } };
          }

          if (
            normalized.startsWith(
              "INSERT INTO asset_loans ( tenant_id, asset_id, original_client, borrowing_client, loaned_at, expected_return_at, loaned_by_username, notes, status ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active')",
            )
          ) {
            const [
              tenantId,
              assetId,
              originalClient,
              borrowingClient,
              loanedAt,
              expectedReturnAt,
              loanedByUsername,
              notes,
            ] = call.bound || [];
            const inserted = {
              id: nextAssetLoanId++,
              tenant_id: String(tenantId ?? "default"),
              asset_id: Number(assetId),
              original_client: String(originalClient ?? ""),
              borrowing_client: String(borrowingClient ?? ""),
              loaned_at: String(loanedAt ?? ""),
              expected_return_at: expectedReturnAt || null,
              returned_at: null,
              loaned_by_username: String(loanedByUsername ?? "unknown"),
              returned_by_username: null,
              notes: String(notes ?? ""),
              return_notes: "",
              status: "active",
            };
            state.assetLoans.push(inserted);
            return { success: true, meta: { last_row_id: inserted.id, changes: 1 } };
          }

          if (normalized.startsWith("INSERT INTO installations")) {
            const id = nextInstallationId++;
            const gpsOffset = call.bound.length >= 17 ? 9 : -1;
            const siteOffset = call.bound.length >= 20 ? gpsOffset + 7 : -1;
            const [
              timestamp,
              driverBrand,
              driverVersion,
              status,
              clientName,
              driverDescription,
              installationTime,
              osInfo,
              notes,
            ] = call.bound;
            const tenantId = call.bound[call.bound.length - 1];
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
              gps_lat: gpsOffset >= 0 ? call.bound[gpsOffset] : null,
              gps_lng: gpsOffset >= 0 ? call.bound[gpsOffset + 1] : null,
              gps_accuracy_m: gpsOffset >= 0 ? call.bound[gpsOffset + 2] : null,
              gps_captured_at: gpsOffset >= 0 ? call.bound[gpsOffset + 3] : null,
              gps_capture_source: gpsOffset >= 0 ? call.bound[gpsOffset + 4] : "none",
              gps_capture_status: gpsOffset >= 0 ? call.bound[gpsOffset + 5] : "pending",
              gps_capture_note: gpsOffset >= 0 ? call.bound[gpsOffset + 6] : "",
              site_lat: siteOffset >= 0 ? call.bound[siteOffset] : null,
              site_lng: siteOffset >= 0 ? call.bound[siteOffset + 1] : null,
              site_radius_m: siteOffset >= 0 ? call.bound[siteOffset + 2] : null,
              tenant_id: tenantId || "default",
            });
            return { success: true, meta: { last_row_id: id, changes: 1 } };
          }

          if (normalized.startsWith("UPDATE installations SET")) {
            const id = call.bound[call.bound.length - 2];
            const tenantId = call.bound[call.bound.length - 1];
            const row = state.installations.find(
              (item) =>
                String(item.id) === String(id) &&
                (!normalized.includes("AND tenant_id = ?") ||
                  String(item.tenant_id ?? "default") === String(tenantId ?? "default")),
            );
            if (row) {
              let bindingIndex = 0;
              if (normalized.includes("notes = ?")) {
                row.notes = call.bound[bindingIndex++];
              }
              if (normalized.includes("installation_time_seconds = ?")) {
                row.installation_time_seconds = call.bound[bindingIndex++];
              }
              if (normalized.includes("site_lat = ?, site_lng = ?, site_radius_m = ?")) {
                row.site_lat = call.bound[bindingIndex++];
                row.site_lng = call.bound[bindingIndex++];
                row.site_radius_m = call.bound[bindingIndex++];
              }
            }
            return { success: true, meta: { changes: row ? 1 : 0 } };
          }

          if (
            normalized.startsWith(
              "UPDATE incidents SET checklist_json = ?, evidence_note = ? WHERE id = ? AND tenant_id = ?",
            )
          ) {
            const [checklistJson, evidenceNote, incidentId, tenantId] = call.bound;
            const row = state.incidents.find(
              (item) =>
                String(item.id) === String(incidentId) &&
                String(item.tenant_id ?? "default") === String(tenantId ?? "default"),
            );
            if (row) {
              row.checklist_json = checklistJson;
              row.evidence_note = evidenceNote;
            }
            return { success: true, meta: { changes: row ? 1 : 0 } };
          }

          if (
            normalized.startsWith(
              "UPDATE incidents SET target_lat = ?, target_lng = ?, target_label = ?, target_source = ?, target_updated_at = ?, target_updated_by = ?, dispatch_required = ?, dispatch_place_name = ?, dispatch_address = ?, dispatch_reference = ?, dispatch_contact_name = ?, dispatch_contact_phone = ?, dispatch_notes = ? WHERE id = ? AND tenant_id = ?",
            )
          ) {
            const [
              targetLat,
              targetLng,
              targetLabel,
              targetSource,
              targetUpdatedAt,
              targetUpdatedBy,
              dispatchRequired,
              dispatchPlaceName,
              dispatchAddress,
              dispatchReference,
              dispatchContactName,
              dispatchContactPhone,
              dispatchNotes,
              incidentId,
              tenantId,
            ] = call.bound;
            const row = state.incidents.find(
              (item) =>
                String(item.id) === String(incidentId) &&
                String(item.tenant_id ?? "default") === String(tenantId ?? "default"),
            );
            if (row) {
              row.target_lat = targetLat;
              row.target_lng = targetLng;
              row.target_label = targetLabel;
              row.target_source = targetSource;
              row.target_updated_at = targetUpdatedAt;
              row.target_updated_by = targetUpdatedBy;
              row.dispatch_required = dispatchRequired;
              row.dispatch_place_name = dispatchPlaceName;
              row.dispatch_address = dispatchAddress;
              row.dispatch_reference = dispatchReference;
              row.dispatch_contact_name = dispatchContactName;
              row.dispatch_contact_phone = dispatchContactPhone;
              row.dispatch_notes = dispatchNotes;
            }
            return { success: true, meta: { changes: row ? 1 : 0 } };
          }

          if (
            normalized.startsWith(
              "UPDATE incidents SET deleted_at = ?, deleted_by = ?, deletion_reason = ?, status_updated_at = ?, status_updated_by = ? WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL",
            )
          ) {
            const [deletedAt, deletedBy, deletionReason, statusUpdatedAt, statusUpdatedBy, incidentId, tenantId] =
              call.bound;
            const row = state.incidents.find(
              (item) =>
                String(item.id) === String(incidentId) &&
                String(item.tenant_id ?? "default") === String(tenantId ?? "default") &&
                !item.deleted_at,
            );
            if (row) {
              row.deleted_at = deletedAt;
              row.deleted_by = deletedBy;
              row.deletion_reason = deletionReason;
              row.status_updated_at = statusUpdatedAt;
              row.status_updated_by = statusUpdatedBy;
            }
            return { success: true, meta: { changes: row ? 1 : 0 } };
          }

          if (
            normalized.startsWith(
              "UPDATE incidents SET incident_status = ?, status_updated_at = ?, status_updated_by = ?, resolved_at = ?, resolved_by = ?, resolution_note = ?, work_started_at = ?, work_ended_at = ?, actual_duration_seconds = ? WHERE id = ? AND tenant_id = ?",
            )
          ) {
            const [
              incidentStatus,
              statusUpdatedAt,
              statusUpdatedBy,
              resolvedAt,
              resolvedBy,
              resolutionNote,
              workStartedAt,
              workEndedAt,
              actualDurationSeconds,
              incidentId,
              tenantId,
            ] = call.bound;
            if (state.failIncidentStatusUpdateWithConstraint && String(incidentStatus) === "paused") {
              throw new Error("D1_ERROR: CHECK constraint failed: incident_status");
            }
            const row = state.incidents.find(
              (item) =>
                String(item.id) === String(incidentId) &&
                String(item.tenant_id ?? "default") === String(tenantId ?? "default"),
            );
            if (row) {
              row.incident_status = incidentStatus;
              row.status_updated_at = statusUpdatedAt;
              row.status_updated_by = statusUpdatedBy;
              row.resolved_at = resolvedAt;
              row.resolved_by = resolvedBy;
              row.resolution_note = resolutionNote;
              row.work_started_at = workStartedAt ?? null;
              row.work_ended_at = workEndedAt ?? null;
              row.actual_duration_seconds = actualDurationSeconds ?? null;
            }
            return { success: true, meta: { changes: row ? 1 : 0 } };
          }

          if (
            normalized.startsWith(
              "UPDATE incidents SET incident_status = ?, status_updated_at = ?, status_updated_by = ?, resolved_at = ?, resolved_by = ?, resolution_note = ? WHERE id = ? AND tenant_id = ?",
            )
          ) {
            const [
              incidentStatus,
              statusUpdatedAt,
              statusUpdatedBy,
              resolvedAt,
              resolvedBy,
              resolutionNote,
              incidentId,
              tenantId,
            ] = call.bound;
            if (state.failIncidentStatusUpdateWithConstraint && String(incidentStatus) === "paused") {
              throw new Error("D1_ERROR: CHECK constraint failed: incident_status");
            }
            const row = state.incidents.find(
              (item) =>
                String(item.id) === String(incidentId) &&
                String(item.tenant_id ?? "default") === String(tenantId ?? "default"),
            );
            if (row) {
              row.incident_status = incidentStatus;
              row.status_updated_at = statusUpdatedAt;
              row.status_updated_by = statusUpdatedBy;
              row.resolved_at = resolvedAt;
              row.resolved_by = resolvedBy;
              row.resolution_note = resolutionNote;
            }
            return { success: true, meta: { changes: row ? 1 : 0 } };
          }

          if (
            normalized ===
            "DELETE FROM incident_photos WHERE incident_id IN ( SELECT id FROM incidents WHERE installation_id = ? AND tenant_id = ? )"
          ) {
            const [installationId, tenantId] = call.bound;
            const incidentIds = new Set(
              state.incidents
                .filter(
                  (item) =>
                    String(item.installation_id) === String(installationId) &&
                    String(item.tenant_id ?? "default") === String(tenantId ?? "default"),
                )
                .map((item) => Number(item.id)),
            );
            state.incidentPhotos = state.incidentPhotos.filter(
              (item) => !incidentIds.has(Number(item.incident_id)),
            );
            return { success: true };
          }

          if (
            normalized ===
            "DELETE FROM incident_photos WHERE incident_id IN ( SELECT id FROM incidents WHERE installation_id = ? )"
          ) {
            const [installationId] = call.bound;
            const incidentIds = new Set(
              state.incidents
                .filter((item) => String(item.installation_id) === String(installationId))
                .map((item) => Number(item.id)),
            );
            state.incidentPhotos = state.incidentPhotos.filter(
              (item) => !incidentIds.has(Number(item.incident_id)),
            );
            return { success: true };
          }

          if (normalized === "DELETE FROM incidents WHERE installation_id = ? AND tenant_id = ?") {
            const [installationId, tenantId] = call.bound;
            state.incidents = state.incidents.filter(
              (item) =>
                !(
                  String(item.installation_id) === String(installationId) &&
                  String(item.tenant_id ?? "default") === String(tenantId ?? "default")
                ),
            );
            return { success: true };
          }

          if (normalized === "DELETE FROM incidents WHERE installation_id = ?") {
            const [installationId] = call.bound;
            state.incidents = state.incidents.filter(
              (item) => String(item.installation_id) !== String(installationId),
            );
            return { success: true };
          }

          if (normalized === "DELETE FROM incident_photos WHERE id = ? AND tenant_id = ?") {
            const [photoId, tenantId] = call.bound;
            state.incidentPhotos = state.incidentPhotos.filter(
              (item) =>
                !(
                  String(item.id) === String(photoId) &&
                  String(item.tenant_id ?? "default") === String(tenantId ?? "default")
                ),
            );
            return { success: true };
          }

          if (normalized === "DELETE FROM incident_photos WHERE id = ?") {
            const [photoId] = call.bound;
            state.incidentPhotos = state.incidentPhotos.filter(
              (item) => String(item.id) !== String(photoId),
            );
            return { success: true };
          }

          if (normalized === "DELETE FROM incidents WHERE id = ? AND tenant_id = ?") {
            const [incidentId, tenantId] = call.bound;
            state.incidents = state.incidents.filter(
              (item) =>
                !(
                  String(item.id) === String(incidentId) &&
                  String(item.tenant_id ?? "default") === String(tenantId ?? "default")
                ),
            );
            return { success: true };
          }

          if (normalized === "DELETE FROM incidents WHERE id = ?") {
            const [incidentId] = call.bound;
            state.incidents = state.incidents.filter(
              (item) => String(item.id) !== String(incidentId),
            );
            return { success: true };
          }

          if (normalized === "DELETE FROM installations WHERE id = ? AND tenant_id = ?") {
            const [id, tenantId] = call.bound;
            state.installations = state.installations.filter(
              (item) =>
                !(
                  String(item.id) === String(id) &&
                  String(item.tenant_id ?? "default") === String(tenantId ?? "default")
                ),
            );
            return { success: true };
          }

          if (normalized === "DELETE FROM installations WHERE id = ?") {
            const [id] = call.bound;
            state.installations = state.installations.filter((item) => String(item.id) !== String(id));
            return { success: true };
          }

          if (normalized.startsWith("INSERT INTO incidents")) {
            const id = nextIncidentId++;
            const values = call.bound;
            let incidentRow = {
              id,
              tenant_id: "default",
              deleted_at: null,
              deleted_by: null,
              deletion_reason: null,
              asset_id: null,
              estimated_duration_seconds: null,
              incident_status: "open",
              status_updated_at: null,
              status_updated_by: null,
              work_started_at: null,
              work_ended_at: null,
              actual_duration_seconds: null,
              resolved_at: null,
              resolved_by: null,
              resolution_note: null,
              checklist_json: null,
              evidence_note: null,
              ...withDefaultGeofence({}),
              ...withDefaultGps({}),
            };

            if (values.length === 30) {
              const [
                installationId,
                assetId,
                tenantId,
                reporterUsername,
                note,
                timeAdjustmentSeconds,
                estimatedDurationSeconds,
                severity,
                source,
                createdAt,
                incidentStatus,
                statusUpdatedAt,
                statusUpdatedBy,
                workStartedAt,
                workEndedAt,
                actualDurationSeconds,
                geofenceDistanceM,
                geofenceRadiusM,
                geofenceResult,
                geofenceCheckedAt,
                geofenceOverrideNote,
                geofenceOverrideBy,
                geofenceOverrideAt,
                gpsLat,
                gpsLng,
                gpsAccuracy,
                gpsCapturedAt,
                gpsSource,
                gpsStatus,
                gpsNote,
              ] = values;
              incidentRow = {
                ...incidentRow,
                installation_id: installationId,
                asset_id: assetId,
                tenant_id: tenantId || "default",
                reporter_username: reporterUsername,
                note,
                time_adjustment_seconds: timeAdjustmentSeconds,
                estimated_duration_seconds: estimatedDurationSeconds,
                severity,
                source,
                created_at: createdAt,
                incident_status: incidentStatus,
                status_updated_at: statusUpdatedAt,
                status_updated_by: statusUpdatedBy,
                work_started_at: workStartedAt,
                work_ended_at: workEndedAt,
                actual_duration_seconds: actualDurationSeconds,
                geofence_distance_m: geofenceDistanceM,
                geofence_radius_m: geofenceRadiusM,
                geofence_result: geofenceResult,
                geofence_checked_at: geofenceCheckedAt,
                geofence_override_note: geofenceOverrideNote,
                geofence_override_by: geofenceOverrideBy,
                geofence_override_at: geofenceOverrideAt,
                gps_lat: gpsLat,
                gps_lng: gpsLng,
                gps_accuracy_m: gpsAccuracy,
                gps_captured_at: gpsCapturedAt,
                gps_capture_source: gpsSource,
                gps_capture_status: gpsStatus,
                gps_capture_note: gpsNote,
              };
            } else if (values.length === 27) {
              const [
                installationId,
                assetId,
                tenantId,
                reporterUsername,
                note,
                timeAdjustmentSeconds,
                estimatedDurationSeconds,
                severity,
                source,
                createdAt,
                incidentStatus,
                statusUpdatedAt,
                statusUpdatedBy,
                workStartedAt,
                workEndedAt,
                actualDurationSeconds,
                geofenceDistanceM,
                geofenceRadiusM,
                geofenceResult,
                geofenceCheckedAt,
                gpsLat,
                gpsLng,
                gpsAccuracy,
                gpsCapturedAt,
                gpsSource,
                gpsStatus,
                gpsNote,
              ] = values;
              incidentRow = {
                ...incidentRow,
                installation_id: installationId,
                asset_id: assetId,
                tenant_id: tenantId || "default",
                reporter_username: reporterUsername,
                note,
                time_adjustment_seconds: timeAdjustmentSeconds,
                estimated_duration_seconds: estimatedDurationSeconds,
                severity,
                source,
                created_at: createdAt,
                incident_status: incidentStatus,
                status_updated_at: statusUpdatedAt,
                status_updated_by: statusUpdatedBy,
                work_started_at: workStartedAt,
                work_ended_at: workEndedAt,
                actual_duration_seconds: actualDurationSeconds,
                geofence_distance_m: geofenceDistanceM,
                geofence_radius_m: geofenceRadiusM,
                geofence_result: geofenceResult,
                geofence_checked_at: geofenceCheckedAt,
                gps_lat: gpsLat,
                gps_lng: gpsLng,
                gps_accuracy_m: gpsAccuracy,
                gps_captured_at: gpsCapturedAt,
                gps_capture_source: gpsSource,
                gps_capture_status: gpsStatus,
                gps_capture_note: gpsNote,
              };
            } else if (values.length === 26) {
              const [
                installationId,
                assetId,
                tenantId,
                reporterUsername,
                note,
                timeAdjustmentSeconds,
                severity,
                source,
                createdAt,
                incidentStatus,
                statusUpdatedAt,
                statusUpdatedBy,
                geofenceDistanceM,
                geofenceRadiusM,
                geofenceResult,
                geofenceCheckedAt,
                geofenceOverrideNote,
                geofenceOverrideBy,
                geofenceOverrideAt,
                gpsLat,
                gpsLng,
                gpsAccuracy,
                gpsCapturedAt,
                gpsSource,
                gpsStatus,
                gpsNote,
              ] = values;
              incidentRow = {
                ...incidentRow,
                installation_id: installationId,
                asset_id: assetId,
                tenant_id: tenantId || "default",
                reporter_username: reporterUsername,
                note,
                time_adjustment_seconds: timeAdjustmentSeconds,
                severity,
                source,
                created_at: createdAt,
                incident_status: incidentStatus,
                status_updated_at: statusUpdatedAt,
                status_updated_by: statusUpdatedBy,
                geofence_distance_m: geofenceDistanceM,
                geofence_radius_m: geofenceRadiusM,
                geofence_result: geofenceResult,
                geofence_checked_at: geofenceCheckedAt,
                geofence_override_note: geofenceOverrideNote,
                geofence_override_by: geofenceOverrideBy,
                geofence_override_at: geofenceOverrideAt,
                gps_lat: gpsLat,
                gps_lng: gpsLng,
                gps_accuracy_m: gpsAccuracy,
                gps_captured_at: gpsCapturedAt,
                gps_capture_source: gpsSource,
                gps_capture_status: gpsStatus,
                gps_capture_note: gpsNote,
              };
            } else if (values.length === 23) {
              const [
                installationId,
                assetId,
                tenantId,
                reporterUsername,
                note,
                timeAdjustmentSeconds,
                estimatedDurationSeconds,
                severity,
                source,
                createdAt,
                incidentStatus,
                statusUpdatedAt,
                statusUpdatedBy,
                workStartedAt,
                workEndedAt,
                actualDurationSeconds,
                gpsLat,
                gpsLng,
                gpsAccuracy,
                gpsCapturedAt,
                gpsSource,
                gpsStatus,
                gpsNote,
              ] = values;
              incidentRow = {
                ...incidentRow,
                installation_id: installationId,
                asset_id: assetId,
                tenant_id: tenantId || "default",
                reporter_username: reporterUsername,
                note,
                time_adjustment_seconds: timeAdjustmentSeconds,
                estimated_duration_seconds: estimatedDurationSeconds,
                severity,
                source,
                created_at: createdAt,
                incident_status: incidentStatus,
                status_updated_at: statusUpdatedAt,
                status_updated_by: statusUpdatedBy,
                work_started_at: workStartedAt,
                work_ended_at: workEndedAt,
                actual_duration_seconds: actualDurationSeconds,
                gps_lat: gpsLat,
                gps_lng: gpsLng,
                gps_accuracy_m: gpsAccuracy,
                gps_captured_at: gpsCapturedAt,
                gps_capture_source: gpsSource,
                gps_capture_status: gpsStatus,
                gps_capture_note: gpsNote,
              };
            } else if (values.length === 19) {
              const [
                installationId,
                assetId,
                tenantId,
                reporterUsername,
                note,
                timeAdjustmentSeconds,
                severity,
                source,
                createdAt,
                incidentStatus,
                statusUpdatedAt,
                statusUpdatedBy,
                gpsLat,
                gpsLng,
                gpsAccuracy,
                gpsCapturedAt,
                gpsSource,
                gpsStatus,
                gpsNote,
              ] = values;
              incidentRow = {
                ...incidentRow,
                installation_id: installationId,
                asset_id: assetId,
                tenant_id: tenantId || "default",
                reporter_username: reporterUsername,
                note,
                time_adjustment_seconds: timeAdjustmentSeconds,
                severity,
                source,
                created_at: createdAt,
                incident_status: incidentStatus,
                status_updated_at: statusUpdatedAt,
                status_updated_by: statusUpdatedBy,
                gps_lat: gpsLat,
                gps_lng: gpsLng,
                gps_accuracy_m: gpsAccuracy,
                gps_captured_at: gpsCapturedAt,
                gps_capture_source: gpsSource,
                gps_capture_status: gpsStatus,
                gps_capture_note: gpsNote,
              };
            } else if (values.length === 25) {
              const [
                installationId,
                tenantId,
                reporterUsername,
                note,
                timeAdjustmentSeconds,
                severity,
                source,
                createdAt,
                incidentStatus,
                statusUpdatedAt,
                statusUpdatedBy,
                geofenceDistanceM,
                geofenceRadiusM,
                geofenceResult,
                geofenceCheckedAt,
                geofenceOverrideNote,
                geofenceOverrideBy,
                geofenceOverrideAt,
                gpsLat,
                gpsLng,
                gpsAccuracy,
                gpsCapturedAt,
                gpsSource,
                gpsStatus,
                gpsNote,
              ] = values;
              incidentRow = {
                ...incidentRow,
                installation_id: installationId,
                tenant_id: tenantId || "default",
                reporter_username: reporterUsername,
                note,
                time_adjustment_seconds: timeAdjustmentSeconds,
                severity,
                source,
                created_at: createdAt,
                incident_status: incidentStatus,
                status_updated_at: statusUpdatedAt,
                status_updated_by: statusUpdatedBy,
                geofence_distance_m: geofenceDistanceM,
                geofence_radius_m: geofenceRadiusM,
                geofence_result: geofenceResult,
                geofence_checked_at: geofenceCheckedAt,
                geofence_override_note: geofenceOverrideNote,
                geofence_override_by: geofenceOverrideBy,
                geofence_override_at: geofenceOverrideAt,
                gps_lat: gpsLat,
                gps_lng: gpsLng,
                gps_accuracy_m: gpsAccuracy,
                gps_captured_at: gpsCapturedAt,
                gps_capture_source: gpsSource,
                gps_capture_status: gpsStatus,
                gps_capture_note: gpsNote,
              };
            } else if (values.length === 22) {
              const [
                installationId,
                tenantId,
                reporterUsername,
                note,
                timeAdjustmentSeconds,
                severity,
                source,
                createdAt,
                incidentStatus,
                statusUpdatedAt,
                statusUpdatedBy,
                geofenceDistanceM,
                geofenceRadiusM,
                geofenceResult,
                geofenceCheckedAt,
                gpsLat,
                gpsLng,
                gpsAccuracy,
                gpsCapturedAt,
                gpsSource,
                gpsStatus,
                gpsNote,
              ] = values;
              incidentRow = {
                ...incidentRow,
                installation_id: installationId,
                tenant_id: tenantId || "default",
                reporter_username: reporterUsername,
                note,
                time_adjustment_seconds: timeAdjustmentSeconds,
                severity,
                source,
                created_at: createdAt,
                incident_status: incidentStatus,
                status_updated_at: statusUpdatedAt,
                status_updated_by: statusUpdatedBy,
                geofence_distance_m: geofenceDistanceM,
                geofence_radius_m: geofenceRadiusM,
                geofence_result: geofenceResult,
                geofence_checked_at: geofenceCheckedAt,
                gps_lat: gpsLat,
                gps_lng: gpsLng,
                gps_accuracy_m: gpsAccuracy,
                gps_captured_at: gpsCapturedAt,
                gps_capture_source: gpsSource,
                gps_capture_status: gpsStatus,
                gps_capture_note: gpsNote,
              };
            } else if (values.length === 18) {
              const [
                installationId,
                tenantId,
                reporterUsername,
                note,
                timeAdjustmentSeconds,
                severity,
                source,
                createdAt,
                incidentStatus,
                statusUpdatedAt,
                statusUpdatedBy,
                gpsLat,
                gpsLng,
                gpsAccuracy,
                gpsCapturedAt,
                gpsSource,
                gpsStatus,
                gpsNote,
              ] = values;
              incidentRow = {
                ...incidentRow,
                installation_id: installationId,
                tenant_id: tenantId || "default",
                reporter_username: reporterUsername,
                note,
                time_adjustment_seconds: timeAdjustmentSeconds,
                severity,
                source,
                created_at: createdAt,
                incident_status: incidentStatus,
                status_updated_at: statusUpdatedAt,
                status_updated_by: statusUpdatedBy,
                gps_lat: gpsLat,
                gps_lng: gpsLng,
                gps_accuracy_m: gpsAccuracy,
                gps_captured_at: gpsCapturedAt,
                gps_capture_source: gpsSource,
                gps_capture_status: gpsStatus,
                gps_capture_note: gpsNote,
              };
            } else {
              const [installationId, reporterUsername, note, timeAdjustmentSeconds, severity, source, createdAt] =
                values;
              incidentRow = {
                ...incidentRow,
                installation_id: installationId,
                reporter_username: reporterUsername,
                note,
                time_adjustment_seconds: timeAdjustmentSeconds,
                severity,
                source,
                created_at: createdAt,
              };
            }

            state.incidents.push(incidentRow);
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
              "INSERT INTO web_users (username, password_hash, password_hash_type, role, tenant_id, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?)",
            )
          ) {
            const id = nextWebUserId++;
            const [username, passwordHash, passwordHashType, role, tenantId, createdAt, updatedAt] = call.bound;
            state.webUsers.push({
              id,
              username,
              password_hash: passwordHash,
              password_hash_type: passwordHashType,
              role,
              tenant_id: tenantId,
              is_active: 1,
              created_at: createdAt,
              updated_at: updatedAt,
              last_login_at: null,
            });
            return { success: true, meta: { last_row_id: id } };
          }

          if (
            normalized.startsWith(
              "INSERT INTO web_users (username, password_hash, password_hash_type, role, tenant_id, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            )
          ) {
            const id = nextWebUserId++;
            const [username, passwordHash, passwordHashType, role, tenantId, isActive, createdAt, updatedAt] = call.bound;
            state.webUsers.push({
              id,
              username,
              password_hash: passwordHash,
              password_hash_type: passwordHashType,
              role,
              tenant_id: tenantId,
              is_active: isActive,
              created_at: createdAt,
              updated_at: updatedAt,
              last_login_at: null,
            });
            return { success: true, meta: { last_row_id: id } };
          }

          if (
            normalized.startsWith(
              "UPDATE web_users SET password_hash = ?, password_hash_type = ?, role = ?, tenant_id = ?, is_active = ?, updated_at = ? WHERE id = ?",
            )
          ) {
            const [passwordHash, passwordHashType, role, tenantId, isActive, updatedAt, id] = call.bound;
            const row = state.webUsers.find((item) => Number(item.id) === Number(id));
            if (row) {
              row.password_hash = passwordHash;
              row.password_hash_type = passwordHashType;
              row.role = role;
              row.tenant_id = tenantId;
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
              "UPDATE asset_loans SET returned_at = ?, returned_by_username = ?, return_notes = ?, status = 'returned' WHERE id = ? AND tenant_id = ?",
            )
          ) {
            const [returnedAt, returnedByUsername, returnNotes, loanId, tenantId] = call.bound || [];
            const row = state.assetLoans.find(
              (item) =>
                Number(item.id) === Number(loanId) &&
                String(item.tenant_id ?? "default") === String(tenantId ?? "default"),
            );
            if (row) {
              row.returned_at = String(returnedAt ?? "");
              row.returned_by_username = String(returnedByUsername ?? "");
              row.return_notes = String(returnNotes ?? "");
              row.status = "returned";
            }
            return { success: true, meta: { changes: row ? 1 : 0 } };
          }

          if (
            normalized.startsWith(
              "UPDATE asset_loans SET due_soon_reminded_at = ? WHERE id = ? AND tenant_id = ?",
            )
          ) {
            const [sentAt, loanId, tenantId] = call.bound || [];
            const row = state.assetLoans.find(
              (item) =>
                Number(item.id) === Number(loanId) &&
                String(item.tenant_id ?? "default") === String(tenantId ?? "default"),
            );
            if (row) {
              row.due_soon_reminded_at = sentAt || null;
            }
            return { success: true, meta: { changes: row ? 1 : 0 } };
          }

          if (
            normalized.startsWith(
              "UPDATE asset_loans SET overdue_reminded_at = ? WHERE id = ? AND tenant_id = ?",
            )
          ) {
            const [sentAt, loanId, tenantId] = call.bound || [];
            const row = state.assetLoans.find(
              (item) =>
                Number(item.id) === Number(loanId) &&
                String(item.tenant_id ?? "default") === String(tenantId ?? "default"),
            );
            if (row) {
              row.overdue_reminded_at = sentAt || null;
            }
            return { success: true, meta: { changes: row ? 1 : 0 } };
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

          if (
            normalized.startsWith(
              "INSERT INTO device_tokens ( tenant_id, user_id, fcm_token, device_model, app_version, platform, registered_at, updated_at )",
            )
          ) {
            const [
              tenantId,
              userId,
              fcmToken,
              deviceModel,
              appVersion,
              platform,
              registeredAt,
              updatedAt,
            ] = call.bound;
            const existing = state.deviceTokens.find(
              (item) => String(item.fcm_token) === String(fcmToken),
            );

            if (existing) {
              existing.tenant_id = tenantId || "default";
              existing.user_id = userId;
              existing.device_model = deviceModel;
              existing.app_version = appVersion;
              existing.platform = platform;
              existing.registered_at = registeredAt;
              existing.updated_at = updatedAt;
              return { success: true, meta: { last_row_id: existing.id, changes: 1 } };
            }

            const id = nextDeviceTokenId++;
            state.deviceTokens.push({
              id,
              tenant_id: tenantId || "default",
              user_id: userId,
              fcm_token: fcmToken,
              device_model: deviceModel,
              app_version: appVersion,
              platform,
              registered_at: registeredAt,
              updated_at: updatedAt,
            });
            return { success: true, meta: { last_row_id: id, changes: 1 } };
          }

          if (
            normalized.startsWith(
              "INSERT INTO device_tokens (user_id, fcm_token, device_model, app_version, platform, registered_at, updated_at)",
            )
          ) {
            const [userId, fcmToken, deviceModel, appVersion, platform, registeredAt, updatedAt] =
              call.bound;
            const existing = state.deviceTokens.find(
              (item) => String(item.fcm_token) === String(fcmToken),
            );

            if (existing) {
              existing.user_id = userId;
              existing.device_model = deviceModel;
              existing.app_version = appVersion;
              existing.platform = platform;
              existing.registered_at = registeredAt;
              existing.updated_at = updatedAt;
              return { success: true, meta: { last_row_id: existing.id, changes: 1 } };
            }

            const id = nextDeviceTokenId++;
            state.deviceTokens.push({
              id,
              user_id: userId,
              fcm_token: fcmToken,
              device_model: deviceModel,
              app_version: appVersion,
              platform,
              registered_at: registeredAt,
              updated_at: updatedAt,
            });
            return { success: true, meta: { last_row_id: id, changes: 1 } };
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

function createMockR2Bucket(initialEntries = {}) {
  const objects = new Map();

  for (const [key, entry] of Object.entries(initialEntries)) {
    objects.set(String(key), {
      body: entry?.body ?? "",
      httpMetadata: entry?.httpMetadata ?? {},
    });
  }

  return {
    async get(key) {
      const normalizedKey = String(key);
      const entry = objects.get(normalizedKey);
      if (!entry) return null;

      const bodyBuffer =
        typeof entry.body === "string"
          ? Buffer.from(entry.body)
          : Buffer.isBuffer(entry.body)
            ? entry.body
            : Buffer.from(entry.body);

      return {
        body: bodyBuffer,
        httpMetadata: entry.httpMetadata || {},
        async text() {
          return bodyBuffer.toString("utf8");
        },
      };
    },
    async put(key, value, options = {}) {
      const normalizedKey = String(key);
      let normalizedBody = value;

      if (value && typeof value.getReader === "function") {
        normalizedBody = Buffer.from(await new Response(value).arrayBuffer());
      } else if (value instanceof Uint8Array && !Buffer.isBuffer(value)) {
        normalizedBody = Buffer.from(value);
      }

      objects.set(normalizedKey, {
        body: normalizedBody,
        httpMetadata: options.httpMetadata || {},
      });
    },
    async delete(key) {
      objects.delete(String(key));
    },
  };
}

function ensureDefaultSecurityStores(env) {
  if (!env || typeof env !== "object" || env.__skipDefaultSecurityStores) {
    return;
  }

  const db = env.DB;
  if (db && typeof db === "object") {
    if (!db.__testSecurityStores) {
      Object.defineProperty(db, "__testSecurityStores", {
        value: {
          RATE_LIMIT_KV: createMockKV(),
          WEB_SESSION_KV: createMockKV(),
        },
        configurable: true,
        enumerable: false,
        writable: false,
      });
    }
    if (!env.RATE_LIMIT_KV) {
      env.RATE_LIMIT_KV = db.__testSecurityStores.RATE_LIMIT_KV;
    }
    if (!env.WEB_SESSION_KV) {
      env.WEB_SESSION_KV = db.__testSecurityStores.WEB_SESSION_KV;
    }
    return;
  }

  if (!env.RATE_LIMIT_KV) {
    env.RATE_LIMIT_KV = createMockKV();
  }
  if (!env.WEB_SESSION_KV) {
    env.WEB_SESSION_KV = createMockKV();
  }
}

test("OPTIONS returns CORS headers only for allowed origins", async () => {
  const request = new Request("https://worker.example/installations", {
    method: "OPTIONS",
    headers: {
      Origin: "https://dashboard.driver-manager.app",
    },
  });
  const response = await workerFetch(request, {});

  assert.equal(response.status, 204);
  assert.equal(
    response.headers.get("Access-Control-Allow-Origin"),
    "https://dashboard.driver-manager.app",
  );
  assert.match(response.headers.get("Access-Control-Allow-Methods"), /GET/);
  assert.match(response.headers.get("Access-Control-Allow-Methods"), /POST/);
  assert.match(response.headers.get("Access-Control-Allow-Methods"), /OPTIONS/);
  assert.match(response.headers.get("Access-Control-Allow-Headers"), /X-API-Token/);
  assert.match(response.headers.get("Access-Control-Allow-Headers"), /X-Request-Signature/);
  assert.match(response.headers.get("Access-Control-Allow-Headers"), /X-Request-Nonce/);
  assert.match(response.headers.get("Access-Control-Allow-Headers"), /X-Body-SHA256/);
  assert.match(response.headers.get("Access-Control-Allow-Headers"), /Content-Type/);
});

test("OPTIONS rejects not allowed origins with 403", async () => {
  const request = new Request("https://worker.example/installations", {
    method: "OPTIONS",
    headers: {
      Origin: "https://evil.example",
    },
  });
  const response = await workerFetch(request, {});

  assert.equal(response.status, 403);
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), null);
});

test("OPTIONS does not implicitly allow worker request origin", async () => {
  const request = new Request("https://worker.example/installations", {
    method: "OPTIONS",
    headers: {
      Origin: "https://worker.example",
    },
  });
  const response = await workerFetch(request, {});

  assert.equal(response.status, 403);
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), null);
});

test("OPTIONS rejects localhost origins in preflight by default", async () => {
  const request = new Request("https://worker.example/web/auth/login", {
    method: "OPTIONS",
    headers: {
      Origin: "http://localhost:19006",
    },
  });
  const response = await workerFetch(request, {});

  assert.equal(response.status, 403);
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), null);
});

test("OPTIONS allows localhost origins in preflight when explicitly enabled", async () => {
  const request = new Request("https://worker.example/web/auth/login", {
    method: "OPTIONS",
    headers: {
      Origin: "http://localhost:19006",
    },
  });
  const response = await workerFetch(request, { ALLOW_LOCALHOST_CORS: "true" });

  assert.equal(response.status, 204);
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), "http://localhost:19006");
});

test("CORS response headers are omitted for disallowed origins", async () => {
  const request = new Request("https://worker.example/health", {
    method: "GET",
    headers: {
      Origin: "https://evil.example",
    },
  });
  const response = await workerFetch(request, {});

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), null);
});

test("CORS methods and headers are route-specific in preflight", async () => {
  const request = new Request("https://worker.example/web/incidents/10/photos", {
    method: "OPTIONS",
    headers: {
      Origin: "https://mobile.driver-manager.app",
    },
  });
  const response = await workerFetch(request, {});

  assert.equal(response.status, 204);
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), "https://mobile.driver-manager.app");
  assert.equal(response.headers.get("Access-Control-Allow-Methods"), "OPTIONS, GET, POST, PATCH");
  assert.match(response.headers.get("Access-Control-Allow-Headers"), /Authorization/);
  assert.match(response.headers.get("Access-Control-Allow-Headers"), /Content-Type/);
  assert.match(response.headers.get("Access-Control-Allow-Headers"), /X-File-Name/);
  assert.equal(response.headers.get("Access-Control-Allow-Headers").includes("X-API-Token"), false);
});



test("Dashboard assets include hardened security headers", async () => {
  const routes = [
    "https://worker.example/web/dashboard",
    "https://worker.example/web/dashboard.css",
    "https://worker.example/web/chart.umd.js",
    "https://worker.example/web/dashboard-qr.js",
    "https://worker.example/web/dashboard-api.js",
    "https://worker.example/web/dashboard-geolocation.js",
    "https://worker.example/web/dashboard-modals.js",
    "https://worker.example/web/dashboard-incidents.js",
    "https://worker.example/web/dashboard-assets.js",
    "https://worker.example/web/dashboard-drivers.js",
    "https://worker.example/web/dashboard-audit.js",
    "https://worker.example/web/dashboard-overview.js",
    "https://worker.example/web/dashboard-realtime.js",
    "https://worker.example/web/dashboard-auth.js",
    "https://worker.example/web/dashboard-navigation.js",
    "https://worker.example/web/dashboard-bootstrap.js",
    "https://worker.example/web/dashboard.js",
    "https://worker.example/web/dashboard-pwa.js",
    "https://worker.example/web/public-tracking.js",
    "https://worker.example/web/public-tracking.css",
    "https://worker.example/web/manifest.json",
  ];

  for (const url of routes) {
    const response = await workerFetch(new Request(url, { method: "GET" }), {});
    assert.equal(response.status, 200, `Expected 200 for ${url}`);
    assert.equal(response.headers.get("X-Frame-Options"), "DENY");
    assert.equal(response.headers.get("Referrer-Policy"), "no-referrer");
    assert.equal(response.headers.get("Permissions-Policy"), "geolocation=(self), microphone=(), camera=(self)");
    assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");

    const csp = response.headers.get("Content-Security-Policy") || "";
    assert.match(csp, /script-src 'self'/);
    assert.match(csp, /style-src 'self'/);
    assert.match(csp, /frame-ancestors 'none'/);

    if (
      url.endsWith("/web/dashboard.css") ||
      url.endsWith("/web/chart.umd.js") ||
      url.endsWith("/web/dashboard-qr.js") ||
      url.endsWith("/web/dashboard-api.js") ||
      url.endsWith("/web/dashboard-geolocation.js") ||
      url.endsWith("/web/dashboard-modals.js") ||
      url.endsWith("/web/dashboard-incidents.js") ||
      url.endsWith("/web/dashboard-assets.js") ||
      url.endsWith("/web/dashboard-drivers.js") ||
      url.endsWith("/web/dashboard-audit.js") ||
      url.endsWith("/web/dashboard-overview.js") ||
      url.endsWith("/web/dashboard-realtime.js") ||
      url.endsWith("/web/dashboard-auth.js") ||
      url.endsWith("/web/dashboard-navigation.js") ||
      url.endsWith("/web/dashboard-bootstrap.js") ||
      url.endsWith("/web/dashboard.js") ||
      url.endsWith("/web/public-tracking.js") ||
      url.endsWith("/web/public-tracking.css")
    ) {
      const bodyText = await response.text();
      assert.ok(bodyText.length > 0, `Expected non-empty content for ${url}`);
    }
  }
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
  assert.deepEqual(body, [
    {
      id: 1,
      driver_brand: "Zebra",
      status: "success",
      gps_lat: null,
      gps_lng: null,
      gps_accuracy_m: null,
      gps_captured_at: null,
      gps_capture_source: "none",
      gps_capture_status: "pending",
      gps_capture_note: "",
      site_lat: null,
      site_lng: null,
      site_radius_m: null,
      tenant_id: "default",
      incident_open_count: 0,
      incident_in_progress_count: 0,
      incident_paused_count: 0,
      incident_resolved_count: 0,
      incident_active_count: 0,
      incident_critical_active_count: 0,
      incident_estimated_duration_seconds_total: 0,
      incident_estimated_duration_count: 0,
      incident_actual_duration_seconds_total: 0,
      incident_actual_duration_count: 0,
      attention_state: "clear",
    },
  ]);
  assert.equal(db.calls.length, 2);
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

test("GET /installations paginates using cursor header", async () => {
  const db = createMockDB({
    installations: [
      { id: 3, timestamp: "2026-08-03T10:00:00.000Z", driver_brand: "A" },
      { id: 2, timestamp: "2026-08-02T10:00:00.000Z", driver_brand: "B" },
      { id: 1, timestamp: "2026-08-01T10:00:00.000Z", driver_brand: "C" },
    ],
  });

  const page1 = await workerFetch(
    new Request("https://worker.example/installations?limit=2", { method: "GET" }),
    { DB: db },
  );
  const page1Body = await page1.json();

  assert.equal(page1.status, 200);
  assert.equal(page1Body.length, 2);
  assert.deepEqual(
    page1Body.map((row) => row.id),
    [3, 2],
  );
  const nextCursor = page1.headers.get("X-Next-Cursor");
  assert.ok(nextCursor);

  const page2 = await workerFetch(
    new Request(
      `https://worker.example/installations?limit=2&cursor=${encodeURIComponent(nextCursor)}`,
      { method: "GET" },
    ),
    { DB: db },
  );
  const page2Body = await page2.json();
  assert.equal(page2.status, 200);
  assert.deepEqual(
    page2Body.map((row) => row.id),
    [1],
  );
  assert.equal(page2.headers.get("X-Next-Cursor"), null);
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
  assert.equal(insertCall.bound.length, 10);
  assert.equal(insertCall.bound[1], "Magicard");
  assert.equal(insertCall.bound[2], "2.0.0");
  assert.equal(insertCall.bound[3], "unknown");
  assert.equal(insertCall.bound[6], 0);
  assert.equal(insertCall.bound[9], "default");
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
  assert.equal(insertCall.bound[9], "default");
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

test("POST /records accepts captured gps payload and returns gps fields", async () => {
  const db = createMockDB();
  const request = new Request("https://worker.example/records", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_name: "Cliente GPS",
      gps: {
        lat: -34.9011,
        lng: -56.1645,
        accuracy_m: 18,
        captured_at: "2026-03-25T22:00:00.000Z",
        source: "browser",
        status: "captured",
        note: "",
      },
    }),
  });

  const response = await workerFetch(request, { DB: db });
  const body = await response.json();

  assert.equal(response.status, 201);
  assert.equal(body.record.gps_capture_status, "captured");
  assert.equal(body.record.gps_capture_source, "browser");
  assert.equal(body.record.gps_lat, -34.9011);
  assert.equal(body.record.gps_lng, -56.1645);
  assert.equal(db.state.installations[0].gps_capture_status, "captured");
});

test("POST /records ignores deprecated site reference payload fields", async () => {
  const db = createMockDB();
  const request = new Request("https://worker.example/records", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_name: "Cliente GPS",
      site_lat: -34.9011,
      site_lng: -56.1645,
      site_radius_m: 60,
      gps: {
        lat: -34.9011,
        lng: -56.1645,
        accuracy_m: 18,
        captured_at: "2026-03-25T22:00:00.000Z",
        source: "browser",
        status: "captured",
        note: "",
      },
    }),
  });

  const response = await workerFetch(request, { DB: db });
  const body = await response.json();

  assert.equal(response.status, 201);
  assert.equal(body.record.site_lat, undefined);
  assert.equal(body.record.site_lng, undefined);
  assert.equal(body.record.site_radius_m, undefined);
  assert.equal(db.state.installations[0].site_lat, null);
  assert.equal(db.state.installations[0].site_lng, null);
  assert.equal(db.state.installations[0].site_radius_m, null);
});

test("POST /records rejects gps payload with invalid latitude", async () => {
  const db = createMockDB();
  const request = new Request("https://worker.example/records", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      gps: {
        lat: -190,
        lng: -56.1645,
        accuracy_m: 18,
        captured_at: "2026-03-25T22:00:00.000Z",
        source: "browser",
        status: "captured",
        note: "",
      },
    }),
  });

  const response = await workerFetch(request, { DB: db });
  const body = await response.json();

  assert.equal(response.status, 400);
  assert.match(String(body?.error?.message || ""), /gps\.lat/i);
});

test("PUT /installations/:id updates notes and installation time", async () => {
  const db = createMockDB({
    installations: [{ id: 42, notes: "", installation_time_seconds: 0 }],
  });
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
  assert.deepEqual(body, {
    success: true,
    updated: "42",
    installation: {
      id: 42,
      notes: "Actualizado",
      installation_time_seconds: 150,
      gps_lat: null,
      gps_lng: null,
      gps_accuracy_m: null,
      gps_captured_at: null,
      gps_capture_source: "none",
      gps_capture_status: "pending",
      gps_capture_note: "",
      site_lat: null,
      site_lng: null,
      site_radius_m: null,
      tenant_id: "default",
      incident_open_count: 0,
      incident_in_progress_count: 0,
      incident_paused_count: 0,
      incident_resolved_count: 0,
      incident_active_count: 0,
      incident_critical_active_count: 0,
      incident_estimated_duration_seconds_total: 0,
      incident_estimated_duration_count: 0,
      incident_actual_duration_seconds_total: 0,
      incident_actual_duration_count: 0,
      attention_state: "clear",
    },
  });

  const updateCall = db.calls.find((c) => c.sql.startsWith("UPDATE installations"));
  assert.ok(updateCall);
  assert.deepEqual(updateCall.bound, ["Actualizado", 150, 42, "default"]);
});

test("PUT /installations/:id with missing fields returns 400", async () => {
  const db = createMockDB({
    installations: [{ id: 77, notes: "", installation_time_seconds: 0 }],
  });
  const request = new Request("https://worker.example/installations/77", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });

  const response = await workerFetch(request, { DB: db });
  const body = await response.json();

  assert.equal(response.status, 400);
  assert.match(String(body?.error?.message || ""), /no hay campos validos para actualizar/i);

  const updateCall = db.calls.find((c) => c.sql.startsWith("UPDATE installations"));
  assert.equal(updateCall, undefined);
});

test("PUT /installations/:id rejects invalid installation id", async () => {
  const db = createMockDB();
  const request = new Request("https://worker.example/installations/not-a-number", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ notes: "x" }),
  });

  const response = await workerFetch(request, { DB: db });
  const body = await response.json();

  assert.equal(response.status, 400);
  assert.equal(body.success, false);
  assert.match(body.error.message, /id/i);
});

test("PUT /installations/:id rejects invalid notes type", async () => {
  const db = createMockDB();
  const request = new Request("https://worker.example/installations/77", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ notes: 1234 }),
  });

  const response = await workerFetch(request, { DB: db });
  const body = await response.json();

  assert.equal(response.status, 400);
  assert.equal(body.success, false);
  assert.match(body.error.message, /notes/i);
});

test("PUT /installations/:id rejects invalid installation_time_seconds", async () => {
  const db = createMockDB();
  const request = new Request("https://worker.example/installations/77", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ installation_time_seconds: -1 }),
  });

  const response = await workerFetch(request, { DB: db });
  const body = await response.json();

  assert.equal(response.status, 400);
  assert.equal(body.success, false);
  assert.match(body.error.message, /installation_time_seconds/i);
});

test("DELETE /installations/:id deletes record and returns message", async () => {
  const db = createMockDB({
    installations: [{ id: 10, tenant_id: "default" }],
    incidents: [
      { id: 501, installation_id: 10, tenant_id: "default" },
      { id: 777, installation_id: 55, tenant_id: "default" },
    ],
    incidentPhotos: [
      { id: 900, incident_id: 501, r2_key: "incidents/10/501/photo-a.jpg" },
      { id: 901, incident_id: 777, r2_key: "incidents/55/777/photo-b.jpg" },
    ],
  });
  const deletedR2Keys = [];
  const bucket = {
    async delete(key) {
      deletedR2Keys.push(String(key));
    },
  };
  const request = new Request("https://worker.example/installations/10", {
    method: "DELETE",
  });

  const response = await workerFetch(request, { DB: db, INCIDENTS_BUCKET: bucket });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.message, "Registro 10 eliminado.");

  const deletePhotosCall = db.calls.find(
    (c) =>
      c.sql ===
      "DELETE FROM incident_photos WHERE incident_id IN ( SELECT id FROM incidents WHERE installation_id = ? AND tenant_id = ? )",
  );
  assert.ok(deletePhotosCall);
  assert.deepEqual(deletePhotosCall.bound, [10, "default"]);

  const deleteIncidentsCall = db.calls.find(
    (c) => c.sql === "DELETE FROM incidents WHERE installation_id = ? AND tenant_id = ?",
  );
  assert.ok(deleteIncidentsCall);
  assert.deepEqual(deleteIncidentsCall.bound, [10, "default"]);

  const deleteInstallationCall = db.calls.find(
    (c) => c.sql === "DELETE FROM installations WHERE id = ? AND tenant_id = ?",
  );
  assert.ok(deleteInstallationCall);
  assert.deepEqual(deleteInstallationCall.bound, [10, "default"]);

  assert.deepEqual(deletedR2Keys, ["incidents/10/501/photo-a.jpg"]);
  assert.equal(db.state.installations.some((row) => Number(row.id) === 10), false);
  assert.equal(db.state.incidents.some((row) => Number(row.installation_id) === 10), false);
  assert.equal(db.state.incidentPhotos.some((row) => Number(row.incident_id) === 501), false);
  assert.equal(db.state.incidentPhotos.some((row) => Number(row.id) === 901), true);
});

test("POST /maintenance/cleanup-orphans deletes orphan incidents/photos and R2 objects for tenant", async () => {
  const db = createMockDB({
    installations: [
      { id: 1, tenant_id: "default" },
      { id: 2, tenant_id: "other" },
    ],
    incidents: [
      { id: 10, installation_id: 1, tenant_id: "default" },
      { id: 11, installation_id: 999, tenant_id: "default" },
      { id: 12, installation_id: 2, tenant_id: "other" },
    ],
    incidentPhotos: [
      { id: 100, incident_id: 10, tenant_id: "default", r2_key: "incidents/1/10/ok.jpg" },
      { id: 101, incident_id: 11, tenant_id: "default", r2_key: "incidents/999/11/orphan-installation.jpg" },
      { id: 102, incident_id: 9999, tenant_id: "default", r2_key: "incidents/ghost/orphan-incident.jpg" },
      { id: 103, incident_id: 12, tenant_id: "other", r2_key: "incidents/2/12/ok-other.jpg" },
    ],
  });

  const deletedR2Keys = [];
  const bucket = {
    async delete(key) {
      deletedR2Keys.push(String(key));
    },
  };

  const request = new Request("https://worker.example/maintenance/cleanup-orphans", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Tenant-Id": "default",
    },
    body: JSON.stringify({}),
  });
  const response = await workerFetch(request, {
    DB: db,
    INCIDENTS_BUCKET: bucket,
  });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.success, true);
  assert.equal(body.tenant_id, "default");
  assert.equal(body.dry_run, false);
  assert.equal(body.summary.scanned_orphan_photo_rows, 2);
  assert.equal(body.summary.scanned_orphan_incidents, 1);
  assert.equal(body.summary.deleted_photo_rows, 2);
  assert.equal(body.summary.deleted_incidents, 1);
  assert.equal(body.summary.r2_deleted, 2);
  assert.equal(body.summary.r2_errors, 0);

  assert.deepEqual(
    new Set(deletedR2Keys),
    new Set(["incidents/999/11/orphan-installation.jpg", "incidents/ghost/orphan-incident.jpg"]),
  );
  assert.equal(db.state.incidents.some((row) => Number(row.id) === 11), false);
  assert.equal(db.state.incidents.some((row) => Number(row.id) === 10), true);
  assert.equal(db.state.incidents.some((row) => Number(row.id) === 12), true);
  assert.equal(db.state.incidentPhotos.some((row) => Number(row.id) === 101), false);
  assert.equal(db.state.incidentPhotos.some((row) => Number(row.id) === 102), false);
  assert.equal(db.state.incidentPhotos.some((row) => Number(row.id) === 100), true);
  assert.equal(db.state.incidentPhotos.some((row) => Number(row.id) === 103), true);
});

test("POST /maintenance/cleanup-orphans with dry_run reports without deleting", async () => {
  const db = createMockDB({
    installations: [{ id: 1, tenant_id: "default" }],
    incidents: [{ id: 10, installation_id: 999, tenant_id: "default" }],
    incidentPhotos: [{ id: 100, incident_id: 10, tenant_id: "default", r2_key: "incidents/999/10/orphan.jpg" }],
  });

  const deletedR2Keys = [];
  const bucket = {
    async delete(key) {
      deletedR2Keys.push(String(key));
    },
  };

  const request = new Request("https://worker.example/maintenance/cleanup-orphans", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Tenant-Id": "default",
    },
    body: JSON.stringify({ dry_run: true }),
  });
  const response = await workerFetch(request, {
    DB: db,
    INCIDENTS_BUCKET: bucket,
  });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.success, true);
  assert.equal(body.dry_run, true);
  assert.equal(body.summary.scanned_orphan_photo_rows, 1);
  assert.equal(body.summary.scanned_orphan_incidents, 1);
  assert.equal(body.summary.deleted_photo_rows, 0);
  assert.equal(body.summary.deleted_incidents, 0);
  assert.equal(body.summary.r2_attempted, 1);
  assert.deepEqual(deletedR2Keys, []);
  assert.equal(db.state.incidents.some((row) => Number(row.id) === 10), true);
  assert.equal(db.state.incidentPhotos.some((row) => Number(row.id) === 100), true);
});

test("POST /installations/:id/incidents creates incident and can apply installation update", async () => {
  const db = createMockDB({
    installations: [{ id: 45, notes: "nota inicial", installation_time_seconds: 120 }],
  });
  const request = new Request("https://worker.example/installations/45/incidents", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      note: "Fallo de instalaciÃ³n en paso final",
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
  assert.equal(body.incident.note, "Fallo de instalaciÃ³n en paso final");
  assert.equal(body.incident.time_adjustment_seconds, 30);

  const incidentInsert = db.calls.find((c) => c.sql.startsWith("INSERT INTO incidents"));
  assert.ok(incidentInsert);

  const installationUpdate = db.calls.find(
    (c) =>
      c.sql.includes("UPDATE installations") &&
      c.sql.includes("SET notes = ?, installation_time_seconds = ?") &&
      c.sql.includes("WHERE id = ?") &&
      c.sql.includes("AND tenant_id = ?"),
  );
  assert.ok(installationUpdate);
  assert.equal(installationUpdate.bound[2], 45);
});

test("POST /installations/:id/incidents ignores deprecated geofence hard policy flags", async () => {
  const db = createMockDB({
    installations: [{
      id: 45,
      notes: "",
      installation_time_seconds: 0,
      site_lat: -34.9011,
      site_lng: -56.1645,
      site_radius_m: 50,
    }],
  });
  const request = new Request("https://worker.example/installations/45/incidents", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      note: "Fuera de radio sin excepcion",
      severity: "high",
      source: "mobile",
      reporter_username: "ops-admin",
      gps: {
        lat: -34.89,
        lng: -56.15,
        accuracy_m: 12,
        captured_at: "2026-03-26T12:00:00.000Z",
        source: "browser",
        status: "captured",
        note: "",
      },
    }),
  });

  const response = await workerFetch(request, {
    DB: db,
    GEOFENCE_HARD_ENABLED: "true",
    GEOFENCE_HARD_FLOWS: "incidents",
  });
  const body = await response.json();

  assert.equal(response.status, 201);
  assert.equal(body.incident.geofence_result, undefined);
  assert.equal(db.state.incidents.length, 1);
});

test("POST /installations/:id/incidents ignores deprecated geofence override notes", async () => {
  const db = createMockDB({
    installations: [{
      id: 45,
      notes: "",
      installation_time_seconds: 0,
      site_lat: -34.9011,
      site_lng: -56.1645,
      site_radius_m: 50,
    }],
  });
  const request = new Request("https://worker.example/installations/45/incidents", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      note: "Fuera de radio con excepcion",
      severity: "high",
      source: "mobile",
      reporter_username: "ops-admin",
      geofence_override_note: "Acceso temporal desde la vereda por restriccion del cliente.",
      gps: {
        lat: -34.89,
        lng: -56.15,
        accuracy_m: 12,
        captured_at: "2026-03-26T12:05:00.000Z",
        source: "browser",
        status: "captured",
        note: "",
      },
    }),
  });

  const response = await workerFetch(request, {
    DB: db,
    GEOFENCE_HARD_ENABLED: "true",
    GEOFENCE_HARD_FLOWS: "incidents",
  });
  const body = await response.json();

  assert.equal(response.status, 201);
  assert.equal(body.incident.geofence_result, undefined);
  assert.equal(body.incident.geofence_override_note, undefined);
  assert.equal(db.state.incidents[0].geofence_override_note, "");
  assert.equal(
    db.state.auditLogs.some((entry) => entry.action === "override_incident_geofence"),
    false,
  );
});

test("POST /installations/:id/incidents with severity critical sends FCM push to admin devices", async () => {
  const db = createMockDB({
    installations: [{ id: 45, notes: "", installation_time_seconds: 0 }],
    webUsers: [
      { id: 10, username: "admin_root", role: "admin", is_active: 1 },
      { id: 11, username: "viewer_1", role: "viewer", is_active: 1 },
    ],
    deviceTokens: [
      {
        id: 1,
        user_id: 10,
        fcm_token: "admin-token-1",
        device_model: "Pixel 8",
        app_version: "1.0.0",
        platform: "android",
        registered_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:00.000Z",
      },
      {
        id: 2,
        user_id: 11,
        fcm_token: "viewer-token-1",
        device_model: "Moto G",
        app_version: "1.0.0",
        platform: "android",
        registered_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:00.000Z",
      },
    ],
  });

  const originalFetch = globalThis.fetch;
  const pushCalls = [];
  const tokenCalls = [];
  const projectId = "driver-manager-fcm-test";
  globalThis.fetch = async (url, init = {}) => {
    if (String(url) === "https://oauth2.googleapis.com/token") {
      tokenCalls.push({ url: String(url), init });
      return new Response(
        JSON.stringify({
          access_token: "test-fcm-access-token",
          expires_in: 3600,
          token_type: "Bearer",
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    }
    if (String(url) === `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`) {
      pushCalls.push({ url: String(url), init });
      return new Response(JSON.stringify({ success: 1, failure: 0 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    return originalFetch(url, init);
  };

  try {
    const request = new Request("https://worker.example/installations/45/incidents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        note: "Incidencia critica en campo",
        severity: "critical",
      }),
    });

    const response = await workerFetch(request, {
      DB: db,
      FCM_SERVICE_ACCOUNT_JSON: createTestFcmServiceAccountJson(projectId),
    });
    const body = await response.json();

    assert.equal(response.status, 201);
    assert.equal(body.success, true);
    assert.equal(tokenCalls.length, 1);
    assert.equal(pushCalls.length, 1);

    const pushRequest = pushCalls[0];
    const headers = new Headers(pushRequest.init.headers || {});
    assert.equal(headers.get("Authorization"), "Bearer test-fcm-access-token");

    const payload = JSON.parse(String(pushRequest.init.body || "{}"));
    assert.equal(payload.message.token, "admin-token-1");
    assert.equal(payload.message.notification.title, "Incidencia critica");
    assert.match(payload.message.notification.body, /#45/);
    assert.equal(payload.message.android.priority, "HIGH");
  } finally {
    globalThis.fetch = originalFetch;
  }
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

test("GET /installations/:id/incidents returns actionable error when GPS migrations are missing", async () => {
  const db = {
    prepare(sql) {
      const normalized = normalizeSql(sql);
      return {
        bind() {
          return this;
        },
        async all() {
          if (normalized.includes("gps_lat")) {
            throw new Error("no such column: gps_lat");
          }
          return { results: [] };
        },
      };
    },
  };

  const response = await workerFetch(
    new Request("https://worker.example/installations/45/incidents", {
      method: "GET",
    }),
    { DB: db },
  );
  const body = await response.json();

  assert.equal(response.status, 500);
  assert.match(String(body?.error?.message || ""), /0017_geolocation_capture\.sql/i);
});

test("PATCH /incidents/:id/evidence updates checklist_items and evidence_note", async () => {
  const db = createMockDB({
    installations: [{ id: 45 }],
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
        incident_status: "open",
        checklist_json: JSON.stringify(["Item inicial"]),
        evidence_note: "nota anterior",
      },
    ],
  });

  const request = new Request("https://worker.example/incidents/11/evidence", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      checklist_items: ["Verificado", "Sellado", "Verificado"],
      evidence_note: "Evidencia actualizada",
    }),
  });

  const response = await workerFetch(request, { DB: db });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.success, true);
  assert.deepEqual(body.incident.checklist_items, ["Verificado", "Sellado"]);
  assert.equal(body.incident.evidence_note, "Evidencia actualizada");

  const updatedIncident = db.state.incidents.find((row) => Number(row.id) === 11);
  assert.equal(updatedIncident.checklist_json, JSON.stringify(["Verificado", "Sellado"]));
  assert.equal(updatedIncident.evidence_note, "Evidencia actualizada");

  const auditEvent = db.state.auditLogs.find((row) => row.action === "update_incident_evidence");
  assert.ok(auditEvent);
});

test("PATCH /incidents/:id/status updates incident status and resolution fields", async () => {
  const db = createMockDB({
    installations: [{ id: 45 }],
    incidents: [
      {
        id: 11,
        installation_id: 45,
        reporter_username: "admin",
        note: "Incidencia A",
        time_adjustment_seconds: 10,
        severity: "high",
        source: "mobile",
        created_at: "2026-02-15T10:00:00Z",
        incident_status: "open",
        checklist_json: JSON.stringify(["Item inicial"]),
        evidence_note: "nota",
      },
    ],
  });

  const request = new Request("https://worker.example/incidents/11/status", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      incident_status: "resolved",
      resolution_note: "Resuelto en sitio",
      reporter_username: "tech_user",
    }),
  });

  const response = await workerFetch(request, { DB: db });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.success, true);
  assert.equal(body.incident.incident_status, "resolved");
  assert.equal(body.incident.resolution_note, "Resuelto en sitio");
  assert.equal(body.incident.resolved_by, "tech_user");
  assert.equal(body.incident.status_updated_by, "tech_user");
  assert.equal(typeof body.incident.resolved_at, "string");
  assert.ok(body.incident.resolved_at.length > 0);

  const updatedIncident = db.state.incidents.find((row) => Number(row.id) === 11);
  assert.equal(updatedIncident.incident_status, "resolved");
  assert.equal(updatedIncident.resolution_note, "Resuelto en sitio");
  assert.equal(updatedIncident.resolved_by, "tech_user");
  assert.equal(updatedIncident.status_updated_by, "tech_user");

  const auditEvent = db.state.auditLogs.find((row) => row.action === "update_incident_status");
  assert.ok(auditEvent);
});

test("PATCH /incidents/:id/status supports paused and keeps accumulated runtime", async () => {
  const db = createMockDB({
    installations: [{ id: 45 }],
    incidents: [
      {
        id: 11,
        installation_id: 45,
        reporter_username: "admin",
        note: "Incidencia A",
        time_adjustment_seconds: 10,
        severity: "high",
        source: "mobile",
        created_at: "2026-02-15T10:00:00Z",
        incident_status: "in_progress",
        status_updated_at: "2026-02-15T10:03:00Z",
        work_started_at: "2026-02-15T10:03:00Z",
        actual_duration_seconds: 120,
      },
    ],
  });

  const request = new Request("https://worker.example/incidents/11/status", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      incident_status: "paused",
      reporter_username: "tech_user",
    }),
  });

  const response = await workerFetch(request, { DB: db });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.success, true);
  assert.equal(body.incident.incident_status, "paused");
  assert.equal(body.incident.status_updated_by, "tech_user");
  assert.equal(body.incident.resolved_at, null);
  assert.equal(body.incident.work_started_at, null);
  assert.equal(typeof body.incident.work_ended_at, "string");
  const expectedPausedDurationSeconds = 120 + Math.floor(
    (Date.parse(body.incident.work_ended_at) - Date.parse("2026-02-15T10:03:00Z")) / 1000,
  );
  assert.equal(body.incident.actual_duration_seconds, expectedPausedDurationSeconds);

  const updatedIncident = db.state.incidents.find((row) => Number(row.id) === 11);
  assert.equal(updatedIncident.incident_status, "paused");
  assert.equal(updatedIncident.status_updated_by, "tech_user");
  assert.equal(updatedIncident.work_started_at, null);
  assert.equal(updatedIncident.actual_duration_seconds, expectedPausedDurationSeconds);
});

test("DELETE /web/incidents/:id soft deletes incident for super_admin and hides it from lists", async () => {
  const db = createMockDB({
    installations: [{ id: 45 }],
    incidents: [
      {
        id: 11,
        installation_id: 45,
        reporter_username: "admin_root",
        note: "Incidencia A",
        time_adjustment_seconds: 10,
        severity: "high",
        source: "web",
        created_at: "2026-02-15T10:00:00Z",
        incident_status: "open",
      },
    ],
  });
  const env = {
    DB: db,
    WEB_LOGIN_PASSWORD: "web-pass",
    WEB_SESSION_SECRET: "web-session-secret",
  };

  const bootstrapResponse = await workerFetch(
    new Request("https://worker.example/web/auth/bootstrap", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        bootstrap_password: "web-pass",
        username: "admin_root",
        password: "StrongPass#2026",
        role: "super_admin",
      }),
    }),
    env,
  );
  assert.equal(bootstrapResponse.status, 201);

  const deleteResponse = await workerFetch(
    new Request("https://worker.example/web/incidents/11", {
      method: "DELETE",
      headers: webSessionHeadersFromResponse(bootstrapResponse),
    }),
    env,
  );
  const deleteBody = await deleteResponse.json();

  assert.equal(deleteResponse.status, 200);
  assert.equal(deleteBody.success, true);
  assert.equal(deleteBody.incident_id, 11);
  assert.equal(typeof deleteBody.deleted_at, "string");

  const softDeletedIncident = db.state.incidents.find((row) => Number(row.id) === 11);
  assert.equal(typeof softDeletedIncident?.deleted_at, "string");
  assert.equal(softDeletedIncident?.deleted_by, "admin_root");
  assert.equal(softDeletedIncident?.deletion_reason, "soft_delete_super_admin");

  const listResponse = await workerFetch(
    new Request("https://worker.example/web/installations/45/incidents", {
      method: "GET",
      headers: webSessionHeadersFromResponse(bootstrapResponse),
    }),
    env,
  );
  const listBody = await listResponse.json();
  assert.equal(listResponse.status, 200);
  assert.equal(listBody.incidents.length, 0);

  const auditEvent = db.state.auditLogs.find((row) => row.action === "soft_delete_incident");
  assert.ok(auditEvent);
});

test("DELETE /web/incidents/:id rejects admin role", async () => {
  const db = createMockDB({
    installations: [{ id: 45 }],
    incidents: [
      {
        id: 11,
        installation_id: 45,
        reporter_username: "admin_user",
        note: "Incidencia A",
        time_adjustment_seconds: 10,
        severity: "high",
        source: "web",
        created_at: "2026-02-15T10:00:00Z",
        incident_status: "open",
      },
    ],
  });
  const env = {
    DB: db,
    WEB_LOGIN_PASSWORD: "web-pass",
    WEB_SESSION_SECRET: "web-session-secret",
  };

  const bootstrapResponse = await workerFetch(
    new Request("https://worker.example/web/auth/bootstrap", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        bootstrap_password: "web-pass",
        username: "admin_user",
        password: "StrongPass#2026",
        role: "admin",
      }),
    }),
    env,
  );
  assert.equal(bootstrapResponse.status, 201);

  const deleteResponse = await workerFetch(
    new Request("https://worker.example/web/incidents/11", {
      method: "DELETE",
      headers: webSessionHeadersFromResponse(bootstrapResponse),
    }),
    env,
  );
  const deleteBody = await deleteResponse.json();

  assert.equal(deleteResponse.status, 403);
  assert.match(deleteBody.error.message, /super_admin/i);
  assert.equal(db.state.incidents.find((row) => Number(row.id) === 11)?.deleted_at, null);
});

test("PATCH /web/incidents/:id/dispatch-target updates operational destination fields", async () => {
  const db = createMockDB({
    installations: [{ id: 45 }],
    incidents: [
      {
        id: 11,
        installation_id: 45,
        reporter_username: "admin_user",
        note: "Incidencia A",
        time_adjustment_seconds: 10,
        severity: "high",
        source: "web",
        created_at: "2026-02-15T10:00:00Z",
        incident_status: "open",
      },
    ],
  });
  const env = {
    DB: db,
    WEB_LOGIN_PASSWORD: "web-pass",
    WEB_SESSION_SECRET: "web-session-secret",
  };

  const bootstrapResponse = await workerFetch(
    new Request("https://worker.example/web/auth/bootstrap", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        bootstrap_password: "web-pass",
        username: "admin_user",
        password: "StrongPass#2026",
        role: "admin",
      }),
    }),
    env,
  );
  assert.equal(bootstrapResponse.status, 201);

  const patchResponse = await workerFetch(
    new Request("https://worker.example/web/incidents/11/dispatch-target", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        ...webSessionHeadersFromResponse(bootstrapResponse),
      },
      body: JSON.stringify({
        target_lat: -34.9011,
        target_lng: -56.1645,
        target_label: "ATM-009 acceso principal",
        target_source: "manual_map",
        dispatch_place_name: "ATM-009",
        dispatch_address: "Av. Italia 2456",
        dispatch_reference: "Hall principal, acceso lateral",
        dispatch_contact_name: "Marta Perez",
        dispatch_contact_phone: "+59899111222",
        dispatch_notes: "Coordinar ingreso antes de manipular el equipo",
      }),
    }),
    env,
  );
  const patchBody = await patchResponse.json();

  assert.equal(patchResponse.status, 200);
  assert.equal(patchBody.success, true);
  assert.equal(patchBody.incident.dispatch_required, true);
  assert.equal(patchBody.incident.target_lat, -34.9011);
  assert.equal(patchBody.incident.target_lng, -56.1645);
  assert.equal(patchBody.incident.target_label, "ATM-009 acceso principal");
  assert.equal(patchBody.incident.target_source, "manual_map");
  assert.equal(patchBody.incident.dispatch_place_name, "ATM-009");
  assert.equal(patchBody.incident.dispatch_address, "Av. Italia 2456");
  assert.equal(patchBody.incident.dispatch_reference, "Hall principal, acceso lateral");
  assert.equal(patchBody.incident.dispatch_contact_name, "Marta Perez");
  assert.equal(patchBody.incident.dispatch_contact_phone, "+59899111222");
  assert.equal(
    patchBody.incident.dispatch_notes,
    "Coordinar ingreso antes de manipular el equipo",
  );
  assert.equal(patchBody.incident.target_updated_by, "admin_user");
  assert.equal(typeof patchBody.incident.target_updated_at, "string");

  const updatedIncident = db.state.incidents.find((row) => Number(row.id) === 11);
  assert.equal(updatedIncident?.dispatch_required, 1);
  assert.equal(updatedIncident?.dispatch_place_name, "ATM-009");
  assert.equal(updatedIncident?.dispatch_address, "Av. Italia 2456");
  assert.equal(updatedIncident?.target_source, "manual_map");

  const auditEvent = db.state.auditLogs.find(
    (row) => row.action === "update_incident_dispatch_target",
  );
  assert.ok(auditEvent);
});

test("PATCH /web/incidents/:id/dispatch-target can disable visit data and clears dispatch fields", async () => {
  const db = createMockDB({
    installations: [{ id: 45 }],
    incidents: [
      {
        id: 11,
        installation_id: 45,
        reporter_username: "admin_user",
        note: "Incidencia A",
        time_adjustment_seconds: 10,
        severity: "high",
        source: "web",
        created_at: "2026-02-15T10:00:00Z",
        incident_status: "open",
        dispatch_required: 1,
        target_lat: -34.9011,
        target_lng: -56.1645,
        target_label: "ATM-009 acceso principal",
        target_source: "manual_map",
        dispatch_place_name: "ATM-009",
        dispatch_address: "Av. Italia 2456",
        dispatch_reference: "Hall principal, acceso lateral",
        dispatch_contact_name: "Marta Perez",
        dispatch_contact_phone: "+59899111222",
        dispatch_notes: "Coordinar ingreso antes de manipular el equipo",
      },
    ],
  });
  const env = {
    DB: db,
    WEB_LOGIN_PASSWORD: "web-pass",
    WEB_SESSION_SECRET: "web-session-secret",
  };

  const bootstrapResponse = await workerFetch(
    new Request("https://worker.example/web/auth/bootstrap", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        bootstrap_password: "web-pass",
        username: "admin_user",
        password: "StrongPass#2026",
        role: "admin",
      }),
    }),
    env,
  );
  assert.equal(bootstrapResponse.status, 201);

  const patchResponse = await workerFetch(
    new Request("https://worker.example/web/incidents/11/dispatch-target", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        ...webSessionHeadersFromResponse(bootstrapResponse),
      },
      body: JSON.stringify({
        dispatch_required: false,
      }),
    }),
    env,
  );
  const patchBody = await patchResponse.json();

  assert.equal(patchResponse.status, 200);
  assert.equal(patchBody.success, true);
  assert.equal(patchBody.incident.dispatch_required, false);
  assert.equal(patchBody.incident.target_lat, null);
  assert.equal(patchBody.incident.target_lng, null);
  assert.equal(patchBody.incident.target_label, null);
  assert.equal(patchBody.incident.target_source, null);
  assert.equal(patchBody.incident.dispatch_place_name, null);
  assert.equal(patchBody.incident.dispatch_address, null);
  assert.equal(patchBody.incident.dispatch_reference, null);
  assert.equal(patchBody.incident.dispatch_contact_name, null);
  assert.equal(patchBody.incident.dispatch_contact_phone, null);
  assert.equal(patchBody.incident.dispatch_notes, null);

  const updatedIncident = db.state.incidents.find((row) => Number(row.id) === 11);
  assert.equal(updatedIncident?.dispatch_required, 0);
  assert.equal(updatedIncident?.target_lat, null);
  assert.equal(updatedIncident?.target_lng, null);
  assert.equal(updatedIncident?.dispatch_address, null);

  const auditEvent = db.state.auditLogs.find(
    (row) => row.action === "update_incident_dispatch_target",
  );
  assert.ok(auditEvent);
  const auditDetails =
    typeof auditEvent?.details === "string"
      ? JSON.parse(auditEvent.details)
      : auditEvent?.details ?? {};
  assert.equal(auditDetails.dispatch_required, false);
  assert.equal(auditDetails.has_target_coordinates, false);
});

test("PATCH /incidents/:id/status returns clear error when DB schema still rejects paused", async () => {
  const db = createMockDB({
    installations: [{ id: 45 }],
    incidents: [
      {
        id: 11,
        installation_id: 45,
        reporter_username: "admin",
        note: "Incidencia A",
        time_adjustment_seconds: 10,
        severity: "high",
        source: "mobile",
        created_at: "2026-02-15T10:00:00Z",
        incident_status: "in_progress",
        status_updated_at: "2026-02-15T10:03:00Z",
        work_started_at: "2026-02-15T10:03:00Z",
        actual_duration_seconds: 120,
      },
    ],
  });
  db.state.failIncidentStatusUpdateWithConstraint = true;

  const request = new Request("https://worker.example/incidents/11/status", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      incident_status: "paused",
      reporter_username: "tech_user",
    }),
  });

  const response = await workerFetch(request, { DB: db });
  const body = await response.json();

  assert.equal(response.status, 409);
  assert.equal(body.success, false);
  assert.match(body.error.message, /migraciones pendientes|base no soporta/i);
});

test("PATCH /installations/:id/incidents/:id/status validates installation ownership", async () => {
  const db = createMockDB({
    installations: [{ id: 45 }, { id: 99 }],
    incidents: [
      {
        id: 11,
        installation_id: 45,
        reporter_username: "admin",
        note: "Incidencia A",
        time_adjustment_seconds: 10,
        severity: "high",
        source: "mobile",
        created_at: "2026-02-15T10:00:00Z",
        incident_status: "open",
      },
    ],
  });

  const request = new Request("https://worker.example/installations/99/incidents/11/status", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      incident_status: "in_progress",
      reporter_username: "tech_user",
    }),
  });

  const response = await workerFetch(request, { DB: db });
  const body = await response.json();

  assert.equal(response.status, 404);
  assert.equal(body.success, false);
  assert.equal(body.error.code, "NOT_FOUND");
});

test("PATCH /incidents/:id/evidence rejects non-PATCH method", async () => {
  const db = createMockDB();
  const request = new Request("https://worker.example/incidents/11/evidence", {
    method: "GET",
  });

  const response = await workerFetch(request, { DB: db });
  const body = await response.json();

  assert.equal(response.status, 405);
  assert.equal(body.success, false);
  assert.equal(body.error.code, "METHOD_NOT_ALLOWED");
});

test("PATCH /incidents/:id/evidence rejects payload without evidence fields", async () => {
  const db = createMockDB();
  const request = new Request("https://worker.example/incidents/11/evidence", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });

  const response = await workerFetch(request, { DB: db });
  const body = await response.json();

  assert.equal(response.status, 400);
  assert.equal(body.success, false);
  assert.match(body.error.message, /checklist_items|evidence_note/i);
});

test("PATCH /incidents/:id/status rejects invalid status value", async () => {
  const db = createMockDB();
  const request = new Request("https://worker.example/incidents/11/status", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      incident_status: "unknown_status",
    }),
  });

  const response = await workerFetch(request, { DB: db });
  const body = await response.json();

  assert.equal(response.status, 400);
  assert.equal(body.success, false);
  assert.match(body.error.message, /incident_status|status/i);
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
  assert.match(body.photo.file_name, /^inst-45_inc-11_cliente-/);
  assert.equal(uploaded.length, 1);
  assert.match(uploaded[0].key, /^incidents\/45\/11\//);
  assert.match(uploaded[0].key, /inst-45-inc-11/);
  assert.equal(uploaded[0].options.httpMetadata.contentType, "image/png");
});

test("POST /incidents/:id/photos requires X-Body-SHA256 for legacy HMAC auth", async () => {
  const db = createMockDB({
    incidents: [{ id: 11, installation_id: 45 }],
  });
  const payload = new Uint8Array(1500);
  payload.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const nonce = "nonce-test-photos-required";
  const signature = signRequest({
    method: "POST",
    path: "/incidents/11/photos",
    timestamp,
    bodyBuffer: Buffer.from(payload),
    secret: DEFAULT_API_SECRET,
    nonce,
  });

  const request = new Request("https://worker.example/incidents/11/photos", {
    method: "POST",
    headers: {
      "Content-Type": "image/png",
      "X-File-Name": "evidencia.png",
      "X-API-Token": DEFAULT_API_TOKEN,
      "X-Request-Timestamp": timestamp,
      "X-Request-Signature": signature,
      "X-Request-Nonce": nonce,
    },
    body: payload,
  });

  const response = await workerFetch(request, {
    DB: db,
    INCIDENTS_BUCKET: {
      async put() {},
    },
  });
  const body = await response.json();

  assert.equal(response.status, 401);
  assert.equal(body.success, false);
  assert.match(body.error.message, /X-Body-SHA256/i);
});

test("POST /incidents/:id/photos rejects legacy request when signed body hash does not match uploaded bytes", async () => {
  const db = createMockDB({
    incidents: [{ id: 11, installation_id: 45 }],
  });

  let uploaded = false;
  const bucket = {
    async put() {
      uploaded = true;
    },
  };

  const payload = new Uint8Array(1500);
  payload.set([0xff, 0xd8, 0xff], 0);
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const nonce = "nonce-test-photos-mismatch";
  const forgedBodyHash = "0".repeat(64);
  const canonical = `POST|/incidents/11/photos|${timestamp}|${forgedBodyHash}|${nonce}`;
  const signature = crypto
    .createHmac("sha256", DEFAULT_API_SECRET)
    .update(canonical)
    .digest("hex");

  const request = new Request("https://worker.example/incidents/11/photos", {
    method: "POST",
    headers: {
      "Content-Type": "image/jpeg",
      "X-API-Token": DEFAULT_API_TOKEN,
      "X-Request-Timestamp": timestamp,
      "X-Request-Signature": signature,
      "X-Request-Nonce": nonce,
      "X-Body-SHA256": forgedBodyHash,
    },
    body: payload,
  });

  const response = await workerFetch(request, {
    DB: db,
    INCIDENTS_BUCKET: bucket,
  });
  const body = await response.json();

  assert.equal(response.status, 401);
  assert.equal(body.success, false);
  assert.equal(body.error.code, "UNAUTHORIZED");
  assert.match(body.error.message, /integridad|X-Body-SHA256/i);
  assert.equal(uploaded, false);
});

test("GET /photos/:id returns binary content from R2", async () => {
  const db = createMockDB({
    incidents: [{ id: 11, installation_id: 45 }],
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

test("GET /web/photos/:id returns binary content with web Bearer session", async () => {
  const db = createMockDB({
    incidents: [{ id: 11, installation_id: 45 }],
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
    INCIDENTS_BUCKET: bucket,
    WEB_LOGIN_PASSWORD: "web-pass",
    WEB_SESSION_SECRET: "web-session-secret",
  });
  const bootstrapBody = await bootstrapResponse.json();
  assert.equal(bootstrapResponse.status, 201);
  assertWebSessionAuthBody(bootstrapBody, {
    username: "admin_root",
    role: "admin",
    bootstrapped: true,
  });

  const request = new Request("https://worker.example/web/photos/21", {
    method: "GET",
    headers: {
      ...webSessionHeadersFromResponse(bootstrapResponse),
    },
  });

  const response = await workerFetch(request, {
    DB: db,
    INCIDENTS_BUCKET: bucket,
    WEB_LOGIN_PASSWORD: "web-pass",
    WEB_SESSION_SECRET: "web-session-secret",
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
  assert.equal(body.success, false);
  assert.equal(body.error.code, "INTERNAL_ERROR");
  assert.match(body.error.message, /error interno del servidor/i);
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
        gps_capture_status: "captured",
        gps_accuracy_m: 8,
      },
      {
        id: 2,
        timestamp: "2026-07-11T10:00:00.000Z",
        driver_brand: "Magicard",
        driver_version: "2.0",
        status: "failed",
        client_name: "BETA",
        installation_time_seconds: 60,
        gps_capture_status: "denied",
      },
      {
        id: 3,
        timestamp: "2026-08-01T00:00:00.000Z",
        driver_brand: "Zebra",
        driver_version: "1.0",
        status: "success",
        client_name: "ACME",
        installation_time_seconds: 180,
        gps_capture_status: "captured",
        gps_accuracy_m: 14,
      },
    ],
    incidents: [
      {
        id: 10,
        installation_id: 1,
        tenant_id: "default",
        created_at: "2026-02-15T09:00:00.000Z",
        incident_status: "paused",
        severity: "critical",
      },
      {
        id: 11,
        installation_id: 1,
        tenant_id: "default",
        created_at: "2026-07-12T09:00:00.000Z",
        incident_status: "open",
        severity: "medium",
        gps_capture_status: "captured",
        gps_accuracy_m: 12,
      },
      {
        id: 12,
        installation_id: 2,
        tenant_id: "default",
        created_at: "2026-07-12T12:00:00.000Z",
        incident_status: "resolved",
        severity: "low",
        gps_capture_status: "timeout",
      },
    ],
    auditLogs: [
      {
        id: 1,
        timestamp: "2026-07-12T13:00:00.000Z",
        action: "incident_geofence_warning",
      },
      {
        id: 2,
        timestamp: "2026-07-12T13:02:00.000Z",
        action: "override_incident_geofence",
      },
      {
        id: 3,
        timestamp: "2026-07-13T13:02:00.000Z",
        action: "override_installation_conformity_gps",
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
  assert.equal(body.incident_in_progress_count, 0);
  assert.equal(body.incident_critical_active_count, 1);
  assert.equal(body.incident_outside_sla_count, 1);
  assert.deepEqual(body.by_brand, { Zebra: 1, Magicard: 1 });
  assert.equal(body.gps_observability.installations.captured_count, 1);
  assert.equal(body.gps_observability.installations.denied_count, 1);
  assert.equal(body.gps_observability.installations.capture_success_rate, 50);
  assert.equal(body.gps_observability.installations.p95_accuracy_m, 8);
  assert.equal(body.gps_observability.incidents.captured_count, 1);
  assert.equal(body.gps_observability.incidents.timeout_count, 1);
  assert.equal(body.gps_observability.warnings, undefined);
  assert.equal(body.gps_observability.overrides.total_override_count, 1);
});

test("GET /statistics/trend returns daily buckets with zero-filled gaps", async () => {
  const db = createMockDB({
    installations: [
      {
        id: 1,
        timestamp: "2026-02-01T10:00:00.000Z",
        status: "success",
      },
      {
        id: 2,
        timestamp: "2026-02-01T18:00:00.000Z",
        status: "failed",
      },
      {
        id: 3,
        timestamp: "2026-02-03T07:00:00.000Z",
        status: "success",
      },
      {
        id: 4,
        timestamp: "2026-02-05T07:00:00.000Z",
        status: "success",
      },
    ],
  });
  const request = new Request(
    "https://worker.example/statistics/trend?start_date=2026-02-01&end_date=2026-02-04",
    { method: "GET" },
  );

  const response = await workerFetch(request, { DB: db });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(Array.isArray(body.points), true);
  assert.equal(body.points.length, 3);

  assert.deepEqual(body.points[0], {
    date: "2026-02-01",
    total_installations: 2,
    successful_installations: 1,
    failed_installations: 1,
  });
  assert.deepEqual(body.points[1], {
    date: "2026-02-02",
    total_installations: 0,
    successful_installations: 0,
    failed_installations: 0,
  });
  assert.deepEqual(body.points[2], {
    date: "2026-02-03",
    total_installations: 1,
    successful_installations: 1,
    failed_installations: 0,
  });
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
  assert.equal(
    db.calls.some((call) => call.sql.toLowerCase().includes("tenant_audit_events")),
    false,
  );
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

test("GET /audit-logs supports cursor pagination", async () => {
  const db = createMockDB({
    auditLogs: [
      { id: 3, timestamp: "2026-08-03T10:00:00.000Z", action: "c", username: "u3", success: 1, details: "{}" },
      { id: 2, timestamp: "2026-08-02T10:00:00.000Z", action: "b", username: "u2", success: 1, details: "{}" },
      { id: 1, timestamp: "2026-08-01T10:00:00.000Z", action: "a", username: "u1", success: 1, details: "{}" },
    ],
  });

  const page1 = await workerFetch(
    new Request("https://worker.example/audit-logs?limit=2", { method: "GET" }),
    { DB: db },
  );
  const page1Body = await page1.json();
  assert.equal(page1.status, 200);
  assert.deepEqual(
    page1Body.map((row) => row.id),
    [3, 2],
  );
  const nextCursor = page1.headers.get("X-Next-Cursor");
  assert.ok(nextCursor);

  const page2 = await workerFetch(
    new Request(
      `https://worker.example/audit-logs?limit=2&cursor=${encodeURIComponent(nextCursor)}`,
      { method: "GET" },
    ),
    { DB: db },
  );
  const page2Body = await page2.json();
  assert.equal(page2.status, 200);
  assert.deepEqual(
    page2Body.map((row) => row.id),
    [1],
  );
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
  assert.equal(body.error.code, "NOT_FOUND");
  assert.match(body.error.message, /registro no encontrado/i);
});

test("invalid JSON payload returns 400 for POST /installations", async () => {
  const db = createMockDB();
  const request = new Request("https://worker.example/installations", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{invalid json",
  });

  const response = await workerFetch(request, { DB: db });
  const body = await response.json();

  assert.equal(response.status, 400);
  assert.equal(body.success, false);
  assert.equal(body.error.code, "INVALID_REQUEST");
  assert.match(body.error.message, /payload invalido/i);
});

test("invalid JSON payload returns 400 for POST /records", async () => {
  const db = createMockDB();
  const request = new Request("https://worker.example/records", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{invalid json",
  });

  const response = await workerFetch(request, { DB: db });
  const body = await response.json();

  assert.equal(response.status, 400);
  assert.equal(body.success, false);
  assert.match(body.error.message, /payload invalido/i);
});

test("invalid JSON payload returns 400 for POST /installations/:id/incidents", async () => {
  const db = createMockDB();
  const request = new Request("https://worker.example/installations/45/incidents", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{invalid json",
  });

  const response = await workerFetch(request, { DB: db });
  const body = await response.json();

  assert.equal(response.status, 400);
  assert.equal(body.success, false);
  assert.match(body.error.message, /payload invalido/i);
});

test("invalid JSON payload returns 400 for PUT /installations/:id", async () => {
  const db = createMockDB();
  const request = new Request("https://worker.example/installations/45", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: "{invalid json",
  });

  const response = await workerFetch(request, { DB: db });
  const body = await response.json();

  assert.equal(response.status, 400);
  assert.equal(body.success, false);
  assert.match(body.error.message, /payload invalido/i);
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
  assert.equal(body.success, false);
  assert.equal(body.error.code, "INTERNAL_ERROR");
  assert.match(body.error.message, /error interno del servidor/i);
});

test("returns 503 when API auth secrets are missing", async () => {
  const db = createMockDB();
  const request = new Request("https://worker.example/installations", { method: "GET" });

  const response = await worker.fetch(request, {
    DB: db,
    DRIVER_MANAGER_API_TENANT_ID: "default",
  });
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
    DRIVER_MANAGER_API_TENANT_ID: "default",
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
      "X-Request-Nonce": "nonce-test-invalid-token",
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
      "X-Request-Nonce": "nonce-test-old-timestamp",
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
      "X-Request-Nonce": "nonce-test-invalid-signature",
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

test("returns 401 when signed HMAC request reuses the same nonce", async () => {
  const db = createMockDB({
    installations: [{ id: 1, driver_brand: "Zebra", status: "success" }],
  });
  const nonceStore = createMockKV();
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const nonce = "nonce-replay-test-000001";
  const signature = signRequest({
    method: "GET",
    path: "/installations",
    timestamp,
    bodyBuffer: Buffer.alloc(0),
    secret: "secret-abc",
    nonce,
  });
  const headers = {
    "X-API-Token": "token-123",
    "X-Request-Timestamp": timestamp,
    "X-Request-Signature": signature,
    "X-Request-Nonce": nonce,
  };

  const firstResponse = await workerFetch(
    new Request("https://worker.example/installations", {
      method: "GET",
      headers,
    }),
    {
      DB: db,
      API_TOKEN: "token-123",
      API_SECRET: "secret-abc",
      RATE_LIMIT_KV: nonceStore,
    },
  );
  assert.equal(firstResponse.status, 200);

  const replayResponse = await workerFetch(
    new Request("https://worker.example/installations", {
      method: "GET",
      headers,
    }),
    {
      DB: db,
      API_TOKEN: "token-123",
      API_SECRET: "secret-abc",
      RATE_LIMIT_KV: nonceStore,
    },
  );
  const replayBody = await replayResponse.json();

  assert.equal(replayResponse.status, 401);
  assert.equal(replayBody.success, false);
  assert.match(replayBody.error.message, /nonce/i);
});

test("GET /health returns OK without DB/auth", async () => {
  const request = new Request("https://worker.example/health", { method: "GET" });
  const response = await workerFetch(request, {});
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(typeof body.now, "string");
});

test("POST /web/auth/login creates cookie session for web routes", async () => {
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
  assertWebSessionAuthBody(loginBody, {
    username: "admin_root",
    role: "admin",
  });

  const listRequest = new Request("https://worker.example/web/installations", {
    method: "GET",
    headers: {
      ...webSessionHeadersFromResponse(loginResponse),
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
  assert.deepEqual(listBody, [
    {
      id: 1,
      driver_brand: "Zebra",
      status: "success",
      gps_lat: null,
      gps_lng: null,
      gps_accuracy_m: null,
      gps_captured_at: null,
      gps_capture_source: "none",
      gps_capture_status: "pending",
      gps_capture_note: "",
      site_lat: null,
      site_lng: null,
      site_radius_m: null,
      tenant_id: "default",
      incident_open_count: 0,
      incident_in_progress_count: 0,
      incident_paused_count: 0,
      incident_resolved_count: 0,
      incident_active_count: 0,
      incident_critical_active_count: 0,
      incident_estimated_duration_seconds_total: 0,
      incident_estimated_duration_count: 0,
      incident_actual_duration_seconds_total: 0,
      incident_actual_duration_count: 0,
      attention_state: "clear",
    },
  ]);
});

test("viewer role cannot mutate records on /web routes", async () => {
  const db = createMockDB();
  const env = {
    DB: db,
    API_TOKEN: "token-123",
    API_SECRET: "secret-abc",
    WEB_LOGIN_PASSWORD: "web-pass",
    WEB_SESSION_SECRET: "web-session-secret",
  };

  const bootstrapResponse = await workerFetch(
    new Request("https://worker.example/web/auth/bootstrap", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        bootstrap_password: "web-pass",
        username: "admin_root",
        password: "StrongPass#2026",
      }),
    }),
    env,
  );
  assert.equal(bootstrapResponse.status, 201);
  const bootstrapBody = await bootstrapResponse.json();

  const createViewerResponse = await workerFetch(
    new Request("https://worker.example/web/auth/users", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...webSessionHeadersFromResponse(bootstrapResponse),
      },
      body: JSON.stringify({
        username: "viewer_1",
        password: "StrongPass#2027",
        role: "viewer",
      }),
    }),
    env,
  );
  assert.equal(createViewerResponse.status, 201);

  const loginViewerResponse = await workerFetch(
    new Request("https://worker.example/web/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: "viewer_1",
        password: "StrongPass#2027",
      }),
    }),
    env,
  );
  assert.equal(loginViewerResponse.status, 200);
  const loginViewerBody = await loginViewerResponse.json();

  const createRecordResponse = await workerFetch(
    new Request("https://worker.example/web/records", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...webSessionHeadersFromResponse(loginViewerResponse),
      },
      body: JSON.stringify({
        notes: "viewer should not create records",
      }),
    }),
    env,
  );
  const createRecordBody = await createRecordResponse.json();

  assert.equal(createRecordResponse.status, 403);
  assert.equal(createRecordBody.success, false);
  assert.match(createRecordBody.error.message, /permisos/i);
});

test("viewer role cannot patch incident status on /web routes", async () => {
  const db = createMockDB();
  const env = {
    DB: db,
    API_TOKEN: "token-123",
    API_SECRET: "secret-abc",
    WEB_LOGIN_PASSWORD: "web-pass",
    WEB_SESSION_SECRET: "web-session-secret",
  };

  const bootstrapResponse = await workerFetch(
    new Request("https://worker.example/web/auth/bootstrap", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        bootstrap_password: "web-pass",
        username: "admin_root",
        password: "StrongPass#2026",
      }),
    }),
    env,
  );
  assert.equal(bootstrapResponse.status, 201);
  const bootstrapBody = await bootstrapResponse.json();

  const createViewerResponse = await workerFetch(
    new Request("https://worker.example/web/auth/users", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...webSessionHeadersFromResponse(bootstrapResponse),
      },
      body: JSON.stringify({
        username: "viewer_2",
        password: "StrongPass#2028",
        role: "viewer",
      }),
    }),
    env,
  );
  assert.equal(createViewerResponse.status, 201);

  const loginViewerResponse = await workerFetch(
    new Request("https://worker.example/web/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: "viewer_2",
        password: "StrongPass#2028",
      }),
    }),
    env,
  );
  assert.equal(loginViewerResponse.status, 200);
  const loginViewerBody = await loginViewerResponse.json();

  const patchStatusResponse = await workerFetch(
    new Request("https://worker.example/web/incidents/11/status", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        ...webSessionHeadersFromResponse(loginViewerResponse),
      },
      body: JSON.stringify({
        incident_status: "resolved",
      }),
    }),
    env,
  );
  const patchStatusBody = await patchStatusResponse.json();

  assert.equal(patchStatusResponse.status, 403);
  assert.equal(patchStatusBody.success, false);
  assert.match(String(patchStatusBody?.error?.message || ""), /permisos/i);
});

test("web JSON responses include no-store headers", async () => {
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
  assert.equal(bootstrapResponse.headers.get("cache-control"), "no-store");
  assert.equal(bootstrapResponse.headers.get("pragma"), "no-cache");
});

test("POST /web/auth/login rejects oversized JSON payload without content-length", async () => {
  const db = createMockDB();
  const oversizedPayload = JSON.stringify({
    username: "u".repeat(70 * 1024),
    password: "StrongPass#2026",
  });
  const oversizedStream = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(oversizedPayload));
      controller.close();
    },
  });

  const request = new Request("https://worker.example/web/auth/login", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: oversizedStream,
    duplex: "half",
  });

  const response = await workerFetch(request, {
    DB: db,
    WEB_LOGIN_PASSWORD: "web-pass",
    WEB_SESSION_SECRET: "web-session-secret",
  });
  const body = await response.json();

  assert.equal(response.status, 413);
  assert.equal(body.success, false);
  assert.equal(body.error.code, "PAYLOAD_TOO_LARGE");
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
  assertWebSessionAuthBody(body, {
    username: "admin_root",
    role: "admin",
    bootstrapped: true,
  });
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
  assertWebSessionAuthBody(loginBody, {
    username: "admin_root",
    role: "admin",
  });

  const meRequest = new Request("https://worker.example/web/auth/me", {
    method: "GET",
    headers: webAuthorizationHeadersFromBody(loginBody),
  });
  const meResponse = await workerFetch(meRequest, {
    DB: db,
    WEB_LOGIN_PASSWORD: "web-pass",
    WEB_SESSION_SECRET: "web-session-secret",
  });
  const meBody = await meResponse.json();

  assert.equal(meResponse.status, 200);
  assertWebSessionStatusBody(meBody, {
    username: "admin_root",
    role: "admin",
  });
});

test("POST /web/auth/logout invalidates bearer session and clears cookie", async () => {
  const db = createMockDB();
  const sessionKv = createMockKV();
  const env = {
    DB: db,
    WEB_LOGIN_PASSWORD: "web-pass",
    WEB_SESSION_SECRET: "web-session-secret",
    WEB_SESSION_KV: sessionKv,
  };

  const bootstrapResponse = await workerFetch(
    new Request("https://worker.example/web/auth/bootstrap", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        bootstrap_password: "web-pass",
        username: "admin_root",
        password: "StrongPass#2026",
      }),
    }),
    env,
  );
  assert.equal(bootstrapResponse.status, 201);

  const loginResponse = await workerFetch(
    new Request("https://worker.example/web/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: "admin_root",
        password: "StrongPass#2026",
      }),
    }),
    env,
  );
  const loginBody = await loginResponse.json();

  assert.equal(loginResponse.status, 200);
  assertWebSessionAuthBody(loginBody, {
    username: "admin_root",
    role: "admin",
  });

  const logoutResponse = await workerFetch(
    new Request("https://worker.example/web/auth/logout", {
      method: "POST",
      headers: webAuthorizationHeadersFromBody(loginBody),
    }),
    env,
  );
  const logoutBody = await logoutResponse.json();

  assert.equal(logoutResponse.status, 200);
  assert.equal(logoutBody.success, true);
  assert.equal(logoutBody.authenticated, false);
  assert.equal(logoutBody.logged_out, true);
  assert.match(String(logoutResponse.headers.get("set-cookie") || ""), /Max-Age=0/);

  const meResponse = await workerFetch(
    new Request("https://worker.example/web/auth/me", {
      method: "GET",
      headers: webAuthorizationHeadersFromBody(loginBody),
    }),
    env,
  );
  const meBody = await meResponse.json();

  assert.equal(meResponse.status, 401);
  assert.equal(meBody.success, false);
});

test("POST /web/auth/bootstrap returns 503 when WEB_SESSION_KV is missing", async () => {
  const db = createMockDB();
  const response = await workerFetch(
    new Request("https://worker.example/web/auth/bootstrap", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        bootstrap_password: "web-pass",
        username: "admin_root",
        password: "StrongPass#2026",
      }),
    }),
    {
      __skipDefaultSecurityStores: true,
      DB: db,
      WEB_LOGIN_PASSWORD: "web-pass",
      WEB_SESSION_SECRET: "web-session-secret",
      RATE_LIMIT_KV: createMockKV(),
    },
  );
  const body = await response.json();

  assert.equal(response.status, 503);
  assert.equal(body.success, false);
  assert.match(String(body?.error?.message || ""), /WEB_SESSION_KV/);
});

test("POST/GET/DELETE /web/drivers smoke flow uploads, lists and deletes a driver", async () => {
  const db = createMockDB();
  const bucket = createMockR2Bucket();
  const env = {
    DB: db,
    DRIVERS_BUCKET: bucket,
    WEB_LOGIN_PASSWORD: "web-pass",
    WEB_SESSION_SECRET: "web-session-secret",
    WEB_SESSION_KV: createMockKV(),
  };

  const bootstrapResponse = await workerFetch(
    new Request("https://worker.example/web/auth/bootstrap", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        bootstrap_password: "web-pass",
        username: "driver_admin",
        password: "StrongPass#2026",
      }),
    }),
    env,
  );
  assert.equal(bootstrapResponse.status, 201);

  const loginResponse = await workerFetch(
    new Request("https://worker.example/web/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: "driver_admin",
        password: "StrongPass#2026",
      }),
    }),
    env,
  );
  const loginBody = await loginResponse.json();
  assert.equal(loginResponse.status, 200);

  const uploadForm = new FormData();
  uploadForm.append("brand", "Zebra");
  uploadForm.append("version", "7.4.1");
  uploadForm.append("description", "Driver QA");
  uploadForm.append(
    "file",
    new Blob([Buffer.from("driver-binary-smoke")], { type: "application/octet-stream" }),
    "zebra.exe",
  );

  const uploadResponse = await workerFetch(
    new Request("https://worker.example/web/drivers", {
      method: "POST",
      headers: webAuthorizationHeadersFromBody(loginBody),
      body: uploadForm,
    }),
    env,
  );
  const uploadBody = await uploadResponse.json();

  assert.equal(uploadResponse.status, 201);
  assert.equal(uploadBody.success, true);
  assert.equal(uploadBody.driver.brand, "Zebra");
  assert.equal(uploadBody.driver.version, "7.4.1");
  assert.equal(uploadBody.driver.filename, "zebra.exe");

  const listResponse = await workerFetch(
    new Request("https://worker.example/web/drivers", {
      method: "GET",
      headers: webAuthorizationHeadersFromBody(loginBody),
    }),
    env,
  );
  const listBody = await listResponse.json();

  assert.equal(listResponse.status, 200);
  assert.equal(listBody.success, true);
  assert.equal(listBody.total, 1);
  assert.equal(listBody.items.length, 1);
  assert.equal(listBody.items[0].key, uploadBody.driver.key);

  const deleteResponse = await workerFetch(
    new Request(
      `https://worker.example/web/drivers?key=${encodeURIComponent(uploadBody.driver.key)}`,
      {
        method: "DELETE",
        headers: webAuthorizationHeadersFromBody(loginBody),
      },
    ),
    env,
  );
  const deleteBody = await deleteResponse.json();

  assert.equal(deleteResponse.status, 200);
  assert.equal(deleteBody.success, true);
  assert.equal(deleteBody.deleted_key, uploadBody.driver.key);

  const listAfterDeleteResponse = await workerFetch(
    new Request("https://worker.example/web/drivers", {
      method: "GET",
      headers: webAuthorizationHeadersFromBody(loginBody),
    }),
    env,
  );
  const listAfterDeleteBody = await listAfterDeleteResponse.json();

  assert.equal(listAfterDeleteResponse.status, 200);
  assert.equal(listAfterDeleteBody.total, 0);
  assert.equal(listAfterDeleteBody.items.length, 0);

  const manifestObject = await bucket.get("manifest.json");
  assert.ok(manifestObject);
  const manifest = JSON.parse(await manifestObject.text());
  assert.deepEqual(manifest.drivers, []);
});

test("asset loans flow creates, lists and returns a loan", async () => {
  const db = createMockDB({
    assets: [{
      id: 91,
      tenant_id: "default",
      external_code: "EQ-091",
      brand: "Zebra",
      model: "TC52",
      client_name: "Cliente Original",
    }],
  });
  const env = {
    DB: db,
    WEB_LOGIN_PASSWORD: "web-pass",
    WEB_SESSION_SECRET: "web-session-secret",
    WEB_SESSION_KV: createMockKV(),
  };

  const bootstrapResponse = await workerFetch(
    new Request("https://worker.example/web/auth/bootstrap", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        bootstrap_password: "web-pass",
        username: "asset_admin",
        password: "StrongPass#2026",
      }),
    }),
    env,
  );
  assert.equal(bootstrapResponse.status, 201);

  const loginResponse = await workerFetch(
    new Request("https://worker.example/web/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: "asset_admin",
        password: "StrongPass#2026",
      }),
    }),
    env,
  );
  const loginBody = await loginResponse.json();
  assert.equal(loginResponse.status, 200);

  const expectedReturnAt = "2099-02-01T10:00:00.000Z";
  const createResponse = await workerFetch(
    new Request("https://worker.example/web/assets/91/loans", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...webAuthorizationHeadersFromBody(loginBody),
      },
      body: JSON.stringify({
        borrowing_client: "Cliente Prestado",
        expected_return_at: expectedReturnAt,
        notes: "Prestamo temporal",
      }),
    }),
    env,
  );
  const createBody = await createResponse.json();

  assert.equal(createResponse.status, 201);
  assert.equal(createBody.success, true);
  assert.equal(createBody.loan.asset_id, 91);
  assert.equal(createBody.loan.original_client, "Cliente Original");
  assert.equal(createBody.loan.borrowing_client, "Cliente Prestado");
  assert.equal(createBody.loan.status, "active");

  const listResponse = await workerFetch(
    new Request("https://worker.example/web/loans?status=active", {
      method: "GET",
      headers: webAuthorizationHeadersFromBody(loginBody),
    }),
    env,
  );
  const listBody = await listResponse.json();
  assert.equal(listResponse.status, 200);
  assert.equal(listBody.success, true);
  assert.equal(listBody.items.length, 1);
  assert.equal(listBody.items[0].asset_external_code, "EQ-091");

  const assetHistoryResponse = await workerFetch(
    new Request("https://worker.example/web/assets/91/loans", {
      method: "GET",
      headers: webAuthorizationHeadersFromBody(loginBody),
    }),
    env,
  );
  const assetHistoryBody = await assetHistoryResponse.json();
  assert.equal(assetHistoryResponse.status, 200);
  assert.equal(assetHistoryBody.items.length, 1);
  assert.equal(assetHistoryBody.active_count, 1);
  assert.equal(assetHistoryBody.overdue_count, 0);

  const returnResponse = await workerFetch(
    new Request(`https://worker.example/web/loans/${createBody.loan.id}/return`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        ...webAuthorizationHeadersFromBody(loginBody),
      },
      body: JSON.stringify({
        return_notes: "Devuelto sin novedad",
      }),
    }),
    env,
  );
  const returnBody = await returnResponse.json();

  assert.equal(returnResponse.status, 200);
  assert.equal(returnBody.success, true);
  assert.equal(returnBody.loan.status, "returned");
  assert.equal(returnBody.loan.return_notes, "Devuelto sin novedad");

  const returnedListResponse = await workerFetch(
    new Request("https://worker.example/web/loans?status=returned", {
      method: "GET",
      headers: webAuthorizationHeadersFromBody(loginBody),
    }),
    env,
  );
  const returnedListBody = await returnedListResponse.json();
  assert.equal(returnedListResponse.status, 200);
  assert.equal(returnedListBody.items.length, 1);
  assert.equal(returnedListBody.items[0].status, "returned");
  assert.equal(db.state.assetLoans[0].returned_by_username, "asset_admin");
});

test("scheduled asset loan reminders deliver email and persist reminder timestamps", async () => {
  const now = Date.now();
  const dueSoonIso = new Date(now + 24 * 60 * 60 * 1000).toISOString();
  const overdueIso = new Date(now - 6 * 60 * 60 * 1000).toISOString();
  const db = createMockDB({
    assets: [
      {
        id: 91,
        tenant_id: "default",
        external_code: "EQ-091",
        brand: "Zebra",
        model: "TC52",
      },
      {
        id: 92,
        tenant_id: "default",
        external_code: "EQ-092",
        brand: "Entrust",
        model: "Sigma",
      },
    ],
    assetLoans: [
      {
        id: 7001,
        tenant_id: "default",
        asset_id: 91,
        original_client: "Cliente Base",
        borrowing_client: "Cliente Prestado",
        loaned_at: new Date(now - 2 * 24 * 60 * 60 * 1000).toISOString(),
        expected_return_at: dueSoonIso,
      },
      {
        id: 7002,
        tenant_id: "default",
        asset_id: 92,
        original_client: "Cliente Base 2",
        borrowing_client: "Cliente Prestado 2",
        loaned_at: new Date(now - 3 * 24 * 60 * 60 * 1000).toISOString(),
        expected_return_at: overdueIso,
      },
    ],
  });

  const originalFetch = globalThis.fetch;
  const resendCalls = [];
  globalThis.fetch = async (url, init = {}) => {
    if (String(url) === "https://api.resend.com/emails") {
      resendCalls.push({
        url: String(url),
        body: JSON.parse(String(init.body || "{}")),
      });
      return new Response(JSON.stringify({ id: "email_123" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    return originalFetch(url, init);
  };

  try {
    const summary = await worker.scheduled(
      { cron: "0 * * * *" },
      {
        DB: db,
        RESEND_API_KEY: "resend-test",
        RESEND_FROM_EMAIL: "SiteOps <alerts@example.com>",
        LOAN_REMINDER_EMAIL_TO: "ops@example.com",
      },
      {
        waitUntil() {},
      },
    );

    assert.equal(summary.processed, true);
    assert.equal(summary.due_soon_count, 1);
    assert.equal(summary.overdue_count, 1);
    assert.equal(summary.tenants_notified, 1);
    assert.equal(resendCalls.length, 1);
    assert.match(resendCalls[0].body.subject, /Prestamos 1 vencido \| 1 por vencer/i);
    assert.match(resendCalls[0].body.text, /EQ-091/);
    assert.match(resendCalls[0].body.text, /EQ-092/);
    assert.ok(db.state.assetLoans.find((loan) => loan.id === 7001)?.due_soon_reminded_at);
    assert.ok(db.state.assetLoans.find((loan) => loan.id === 7002)?.overdue_reminded_at);
    assert.equal(
      db.state.auditLogs.some((entry) => entry.action === "asset_loan_due_soon_reminder_sent"),
      true,
    );
    assert.equal(
      db.state.auditLogs.some((entry) => entry.action === "asset_loan_overdue_reminder_sent"),
      true,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("web statistics includes due soon and overdue asset loans", async () => {
  const now = Date.now();
  const db = createMockDB({
    assetLoans: [
      {
        id: 7101,
        asset_id: 90,
        borrowing_client: "Cliente Uno",
        loaned_at: new Date(now - 24 * 60 * 60 * 1000).toISOString(),
        expected_return_at: new Date(now + 12 * 60 * 60 * 1000).toISOString(),
      },
      {
        id: 7102,
        asset_id: 91,
        borrowing_client: "Cliente Dos",
        loaned_at: new Date(now - 24 * 60 * 60 * 1000).toISOString(),
        expected_return_at: new Date(now - 12 * 60 * 60 * 1000).toISOString(),
      },
      {
        id: 7103,
        asset_id: 92,
        borrowing_client: "Cliente Tres",
        loaned_at: new Date(now - 24 * 60 * 60 * 1000).toISOString(),
        expected_return_at: new Date(now + 7 * 24 * 60 * 60 * 1000).toISOString(),
      },
    ],
  });
  const env = {
    DB: db,
    WEB_LOGIN_PASSWORD: "web-pass",
    WEB_SESSION_SECRET: "web-session-secret",
    WEB_SESSION_KV: createMockKV(),
  };

  const bootstrapResponse = await workerFetch(
    new Request("https://worker.example/web/auth/bootstrap", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        bootstrap_password: "web-pass",
        username: "stats_admin",
        password: "StrongPass#2026",
      }),
    }),
    env,
  );
  assert.equal(bootstrapResponse.status, 201);

  const loginResponse = await workerFetch(
    new Request("https://worker.example/web/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: "stats_admin",
        password: "StrongPass#2026",
      }),
    }),
    env,
  );
  const loginBody = await loginResponse.json();
  assert.equal(loginResponse.status, 200);

  const response = await workerFetch(
    new Request("https://worker.example/web/statistics", {
      method: "GET",
      headers: webAuthorizationHeadersFromBody(loginBody),
    }),
    env,
  );
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.loan_due_soon_count, 1);
  assert.equal(body.loan_overdue_count, 1);
});

test("POST /web/auth/verify-password validates current user password without re-login", async () => {
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

  const verifyRequest = new Request("https://worker.example/web/auth/verify-password", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...webSessionHeadersFromResponse(bootstrapResponse),
    },
    body: JSON.stringify({
      password: "StrongPass#2026",
    }),
  });

  const verifyResponse = await workerFetch(verifyRequest, {
    DB: db,
    WEB_LOGIN_PASSWORD: "web-pass",
    WEB_SESSION_SECRET: "web-session-secret",
  });
  const verifyBody = await verifyResponse.json();

  assert.equal(verifyResponse.status, 200);
  assert.equal(verifyBody.success, true);
  assert.equal(verifyBody.verified, true);
});

test("POST /web/auth/verify-password rejects wrong password", async () => {
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

  const verifyRequest = new Request("https://worker.example/web/auth/verify-password", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...webSessionHeadersFromResponse(bootstrapResponse),
    },
    body: JSON.stringify({
      password: "WrongPass#2026",
    }),
  });

  const verifyResponse = await workerFetch(verifyRequest, {
    DB: db,
    WEB_LOGIN_PASSWORD: "web-pass",
    WEB_SESSION_SECRET: "web-session-secret",
  });
  const verifyBody = await verifyResponse.json();

  assert.equal(verifyResponse.status, 401);
  assert.equal(verifyBody.success, false);
  assert.match(String(verifyBody?.error?.message || ""), /contrasena/i);
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
      ...webSessionHeadersFromResponse(bootstrapResponse),
    },
    body: JSON.stringify({
      note: "Incidencia creada desde web",
      gps: {
        lat: -34.9011,
        lng: -56.1645,
        accuracy_m: 12,
        captured_at: "2026-03-25T22:15:00.000Z",
        source: "browser",
        status: "captured",
        note: "",
      },
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
  assert.equal(createIncidentBody.incident.gps_capture_status, "captured");
  assert.equal(createIncidentBody.incident.gps_lat, -34.9011);
});

test("public tracking link can be issued from web and consumed without DB reads", async () => {
  const db = createMockDB({
    installations: [
      {
        id: 45,
        timestamp: "2026-03-26T10:00:00.000Z",
        client_name: "Acme Norte",
      },
    ],
    incidents: [
      {
        id: 91,
        installation_id: 45,
        incident_status: "open",
        created_at: "2026-03-26T10:05:00.000Z",
        status_updated_at: "2026-03-26T10:05:00.000Z",
      },
    ],
  });
  const publicTrackingKv = createMockKV();
  const env = {
    DB: db,
    PUBLIC_TRACKING_KV: publicTrackingKv,
    PUBLIC_TRACKING_SECRET: "public-tracking-secret",
    PUBLIC_TRACKING_BASE_URL: "https://estado.example.com",
    WEB_LOGIN_PASSWORD: "web-pass",
    WEB_SESSION_SECRET: "web-session-secret",
  };

  const bootstrapResponse = await workerFetch(
    new Request("https://worker.example/web/auth/bootstrap", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        bootstrap_password: "web-pass",
        username: "admin_root",
        password: "StrongPass#2026",
      }),
    }),
    env,
  );
  assert.equal(bootstrapResponse.status, 201);

  const createResponse = await workerFetch(
    new Request("https://worker.example/web/installations/45/public-tracking-link", {
      method: "POST",
      headers: {
        ...webSessionHeadersFromResponse(bootstrapResponse),
      },
    }),
    env,
  );
  const createBody = await createResponse.json();

  assert.equal(createResponse.status, 201);
  assert.equal(createBody.success, true);
  assert.equal(createBody.link.active, true);
  assert.equal(createBody.link.snapshot.public_status, "pendiente");
  assert.match(createBody.link.tracking_url, /^https:\/\/estado\.example\.com\/track\//);
  assert.equal(typeof createBody.link.short_code, "string");
  assert.ok(createBody.link.short_code.length >= 6);
  assert.equal("long_tracking_url" in createBody.link, false);

  const shortCode = decodeURIComponent(new URL(createBody.link.tracking_url).pathname.split("/").pop() || "");
  assert.equal(shortCode, createBody.link.short_code);

  const dbCallsBeforePublicRead = db.calls.length;
  const publicStateResponse = await workerFetch(
    new Request(`https://worker.example/track/${encodeURIComponent(shortCode)}/state`, {
      method: "GET",
    }),
    {
      PUBLIC_TRACKING_KV: publicTrackingKv,
      PUBLIC_TRACKING_SECRET: "public-tracking-secret",
    },
  );
  const publicStateBody = await publicStateResponse.json();

  assert.equal(publicStateResponse.status, 200);
  assert.equal(publicStateBody.success, true);
  assert.equal(publicStateBody.tracking.installation_id, 45);
  assert.equal(publicStateBody.tracking.public_status, "pendiente");
  assert.equal(db.calls.length, dbCallsBeforePublicRead);
});

test("public tracking html accepts manual theme override via query string", async () => {
  const db = createMockDB({
    installations: [
      {
        id: 45,
        timestamp: "2026-03-26T10:00:00.000Z",
      },
    ],
    incidents: [
      {
        id: 91,
        installation_id: 45,
        incident_status: "open",
        created_at: "2026-03-26T10:05:00.000Z",
        status_updated_at: "2026-03-26T10:05:00.000Z",
      },
    ],
  });
  const publicTrackingKv = createMockKV();
  const env = {
    DB: db,
    PUBLIC_TRACKING_KV: publicTrackingKv,
    PUBLIC_TRACKING_SECRET: "public-tracking-secret",
    PUBLIC_TRACKING_BASE_URL: "https://estado.example.com",
    WEB_LOGIN_PASSWORD: "web-pass",
    WEB_SESSION_SECRET: "web-session-secret",
  };

  const bootstrapResponse = await workerFetch(
    new Request("https://worker.example/web/auth/bootstrap", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        bootstrap_password: "web-pass",
        username: "admin_root",
        password: "StrongPass#2026",
      }),
    }),
    env,
  );
  assert.equal(bootstrapResponse.status, 201);

  const createResponse = await workerFetch(
    new Request("https://worker.example/web/installations/45/public-tracking-link", {
      method: "POST",
      headers: {
        ...webSessionHeadersFromResponse(bootstrapResponse),
      },
    }),
    env,
  );
  const createBody = await createResponse.json();
  const shortCode = decodeURIComponent(new URL(createBody.link.tracking_url).pathname.split("/").pop() || "");

  const publicViewEnv = {
    PUBLIC_TRACKING_KV: publicTrackingKv,
    PUBLIC_TRACKING_SECRET: "public-tracking-secret",
    RATE_LIMIT_KV: createMockKV(),
  };
  const darkResponse = await workerFetch(
    new Request(`https://worker.example/track/${encodeURIComponent(shortCode)}?theme=dark`, {
      method: "GET",
    }),
    publicViewEnv,
  );
  const darkHtml = await darkResponse.text();
  assert.equal(darkResponse.status, 200);
  assert.match(darkHtml, /<html lang="es" data-theme="dark">/);
  assert.match(darkHtml, /id="publicTrackingThemeToggleBtn"/);
  assert.match(darkHtml, /\?theme=light/);

  const lightResponse = await workerFetch(
    new Request(`https://worker.example/track/${encodeURIComponent(shortCode)}?theme=light`, {
      method: "GET",
    }),
    publicViewEnv,
  );
  const lightHtml = await lightResponse.text();
  assert.equal(lightResponse.status, 200);
  assert.match(lightHtml, /<html lang="es" data-theme="light">/);
  assert.match(lightHtml, /\?theme=dark/);
});

test("public tracking link can be listed and revoked from web", async () => {
  const db = createMockDB({
    installations: [
      {
        id: 45,
        timestamp: "2026-03-26T10:00:00.000Z",
      },
    ],
    incidents: [
      {
        id: 95,
        installation_id: 45,
        incident_status: "in_progress",
        created_at: "2026-03-26T10:05:00.000Z",
        status_updated_at: "2026-03-26T10:08:00.000Z",
      },
    ],
  });
  const publicTrackingKv = createMockKV();
  const env = {
    DB: db,
    PUBLIC_TRACKING_KV: publicTrackingKv,
    PUBLIC_TRACKING_SECRET: "public-tracking-secret",
    PUBLIC_TRACKING_BASE_URL: "https://estado.example.com",
    WEB_LOGIN_PASSWORD: "web-pass",
    WEB_SESSION_SECRET: "web-session-secret",
  };

  const bootstrapResponse = await workerFetch(
    new Request("https://worker.example/web/auth/bootstrap", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        bootstrap_password: "web-pass",
        username: "admin_root",
        password: "StrongPass#2026",
      }),
    }),
    env,
  );
  assert.equal(bootstrapResponse.status, 201);

  const createResponse = await workerFetch(
    new Request("https://worker.example/web/installations/45/public-tracking-link", {
      method: "POST",
      headers: {
        ...webSessionHeadersFromResponse(bootstrapResponse),
      },
    }),
    env,
  );
  const createBody = await createResponse.json();
  const shortCode = decodeURIComponent(new URL(createBody.link.tracking_url).pathname.split("/").pop() || "");

  const getResponse = await workerFetch(
    new Request("https://worker.example/web/installations/45/public-tracking-link", {
      method: "GET",
      headers: {
        ...webSessionHeadersFromResponse(bootstrapResponse),
      },
    }),
    env,
  );
  const getBody = await getResponse.json();

  assert.equal(getResponse.status, 200);
  assert.equal(getBody.link.active, true);
  assert.equal(getBody.link.snapshot.public_status, "en_progreso");
  assert.match(getBody.link.tracking_url, /^https:\/\/estado\.example\.com\/track\//);
  assert.equal(getBody.link.short_code, shortCode);
  assert.equal("long_tracking_url" in getBody.link, false);

  const revokeResponse = await workerFetch(
    new Request("https://worker.example/web/installations/45/public-tracking-link", {
      method: "DELETE",
      headers: {
        ...webSessionHeadersFromResponse(bootstrapResponse),
      },
    }),
    env,
  );
  const revokeBody = await revokeResponse.json();

  assert.equal(revokeResponse.status, 200);
  assert.equal(revokeBody.success, true);
  assert.equal(revokeBody.revoked, true);

  const revokedPublicResponse = await workerFetch(
    new Request(`https://worker.example/track/${encodeURIComponent(shortCode)}/state`, {
      method: "GET",
    }),
    {
      PUBLIC_TRACKING_KV: publicTrackingKv,
      PUBLIC_TRACKING_SECRET: "public-tracking-secret",
    },
  );
  const revokedPublicBody = await revokedPublicResponse.json();

  assert.equal(revokedPublicResponse.status, 410);
  assert.equal(revokedPublicBody.success, false);
  assert.match(String(revokedPublicBody.error?.message || ""), /disponible/i);
});

test("public tracking snapshot refreshes after incident creation and status changes", async () => {
  const db = createMockDB({
    installations: [
      {
        id: 45,
        timestamp: "2026-03-26T10:00:00.000Z",
      },
    ],
  });
  const publicTrackingKv = createMockKV();
  const env = {
    DB: db,
    PUBLIC_TRACKING_KV: publicTrackingKv,
    PUBLIC_TRACKING_SECRET: "public-tracking-secret",
    WEB_LOGIN_PASSWORD: "web-pass",
    WEB_SESSION_SECRET: "web-session-secret",
  };

  const bootstrapResponse = await workerFetch(
    new Request("https://worker.example/web/auth/bootstrap", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        bootstrap_password: "web-pass",
        username: "admin_root",
        password: "StrongPass#2026",
      }),
    }),
    env,
  );
  assert.equal(bootstrapResponse.status, 201);

  const createLinkResponse = await workerFetch(
    new Request("https://worker.example/web/installations/45/public-tracking-link", {
      method: "POST",
      headers: {
        ...webSessionHeadersFromResponse(bootstrapResponse),
      },
    }),
    env,
  );
  const createLinkBody = await createLinkResponse.json();
  const shortCode = decodeURIComponent(new URL(createLinkBody.link.tracking_url).pathname.split("/").pop() || "");

  assert.equal(createLinkBody.link.snapshot.public_status, "registrado");
  assert.equal(createLinkBody.link.short_code, shortCode);

  const createIncidentResponse = await workerFetch(
    new Request("https://worker.example/web/installations/45/incidents", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...webSessionHeadersFromResponse(bootstrapResponse),
      },
      body: JSON.stringify({
        note: "Seguimiento en curso",
        severity: "medium",
      }),
    }),
    env,
  );
  assert.equal(createIncidentResponse.status, 201);

  const pendingStateResponse = await workerFetch(
    new Request(`https://worker.example/track/${encodeURIComponent(shortCode)}/state`, {
      method: "GET",
    }),
    {
      PUBLIC_TRACKING_KV: publicTrackingKv,
      PUBLIC_TRACKING_SECRET: "public-tracking-secret",
    },
  );
  const pendingStateBody = await pendingStateResponse.json();
  assert.equal(pendingStateResponse.status, 200);
  assert.equal(pendingStateBody.tracking.public_status, "pendiente");

  const createdIncidentId = Number(db.state.incidents[0]?.id);
  assert.ok(Number.isInteger(createdIncidentId) && createdIncidentId > 0);

  const patchStatusResponse = await workerFetch(
    new Request(`https://worker.example/web/incidents/${createdIncidentId}/status`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        ...webSessionHeadersFromResponse(bootstrapResponse),
      },
      body: JSON.stringify({
        incident_status: "in_progress",
      }),
    }),
    env,
  );
  assert.equal(patchStatusResponse.status, 200);

  const inProgressStateResponse = await workerFetch(
    new Request(`https://worker.example/track/${encodeURIComponent(shortCode)}/state`, {
      method: "GET",
    }),
    {
      PUBLIC_TRACKING_KV: publicTrackingKv,
      PUBLIC_TRACKING_SECRET: "public-tracking-secret",
    },
  );
  const inProgressStateBody = await inProgressStateResponse.json();
  assert.equal(inProgressStateResponse.status, 200);
  assert.equal(inProgressStateBody.tracking.public_status, "en_progreso");
});

test("public tracking events stream emits connected payload for a valid link", async () => {
  const db = createMockDB({
    installations: [
      {
        id: 45,
        timestamp: "2026-03-26T10:00:00.000Z",
      },
    ],
    incidents: [
      {
        id: 91,
        installation_id: 45,
        incident_status: "open",
        created_at: "2026-03-26T10:05:00.000Z",
        status_updated_at: "2026-03-26T10:05:00.000Z",
      },
    ],
  });
  const publicTrackingKv = createMockKV();
  const env = {
    DB: db,
    PUBLIC_TRACKING_KV: publicTrackingKv,
    PUBLIC_TRACKING_SECRET: "public-tracking-secret",
    PUBLIC_TRACKING_BASE_URL: "https://estado.example.com",
    WEB_LOGIN_PASSWORD: "web-pass",
    WEB_SESSION_SECRET: "web-session-secret",
  };

  const bootstrapResponse = await workerFetch(
    new Request("https://worker.example/web/auth/bootstrap", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        bootstrap_password: "web-pass",
        username: "admin_root",
        password: "StrongPass#2026",
      }),
    }),
    env,
  );
  assert.equal(bootstrapResponse.status, 201);

  const createResponse = await workerFetch(
    new Request("https://worker.example/web/installations/45/public-tracking-link", {
      method: "POST",
      headers: {
        ...webSessionHeadersFromResponse(bootstrapResponse),
      },
    }),
    env,
  );
  const createBody = await createResponse.json();
  const shortCode = decodeURIComponent(new URL(createBody.link.tracking_url).pathname.split("/").pop() || "");

  const eventsResponse = await workerFetch(
    new Request(`https://worker.example/track/${encodeURIComponent(shortCode)}/events`, {
      method: "GET",
    }),
    {
      PUBLIC_TRACKING_KV: publicTrackingKv,
      PUBLIC_TRACKING_SECRET: "public-tracking-secret",
    },
  );

  assert.equal(eventsResponse.status, 200);
  assert.equal(eventsResponse.headers.get("Content-Type"), "text/event-stream");

  const reader = eventsResponse.body.getReader();
  const firstChunk = await reader.read();
  await reader.cancel();
  const firstText = new TextDecoder().decode(firstChunk.value || new Uint8Array());

  assert.match(firstText, /"type":"connected"/);
  assert.match(firstText, /"public_status":"pendiente"/);
});

test("public tracking state rate limits repeated anonymous reads when RATE_LIMIT_KV is configured", async () => {
  const db = createMockDB({
    installations: [
      {
        id: 45,
        timestamp: "2026-03-26T10:00:00.000Z",
      },
    ],
  });
  const publicTrackingKv = createMockKV();
  const env = {
    DB: db,
    PUBLIC_TRACKING_KV: publicTrackingKv,
    PUBLIC_TRACKING_SECRET: "public-tracking-secret",
    PUBLIC_TRACKING_BASE_URL: "https://estado.example.com",
    RATE_LIMIT_KV: createMockKV(),
    WEB_LOGIN_PASSWORD: "web-pass",
    WEB_SESSION_SECRET: "web-session-secret",
  };

  const bootstrapResponse = await workerFetch(
    new Request("https://worker.example/web/auth/bootstrap", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        bootstrap_password: "web-pass",
        username: "admin_root",
        password: "StrongPass#2026",
      }),
    }),
    env,
  );
  assert.equal(bootstrapResponse.status, 201);

  const createResponse = await workerFetch(
    new Request("https://worker.example/web/installations/45/public-tracking-link", {
      method: "POST",
      headers: {
        ...webSessionHeadersFromResponse(bootstrapResponse),
      },
    }),
    env,
  );
  const createBody = await createResponse.json();
  const shortCode = decodeURIComponent(new URL(createBody.link.tracking_url).pathname.split("/").pop() || "");

  let blockedResponse = null;
  for (let attempt = 0; attempt < 121; attempt += 1) {
    blockedResponse = await workerFetch(
      new Request(`https://worker.example/track/${encodeURIComponent(shortCode)}/state`, {
        method: "GET",
        headers: {
          "CF-Connecting-IP": "198.51.100.10",
        },
      }),
      {
        PUBLIC_TRACKING_KV: publicTrackingKv,
        PUBLIC_TRACKING_SECRET: "public-tracking-secret",
        RATE_LIMIT_KV: env.RATE_LIMIT_KV,
      },
    );
  }

  assert.equal(blockedResponse.status, 429);
});

test("public tracking events rate limits repeated stream opens when RATE_LIMIT_KV is configured", async () => {
  const db = createMockDB({
    installations: [
      {
        id: 45,
        timestamp: "2026-03-26T10:00:00.000Z",
      },
    ],
  });
  const publicTrackingKv = createMockKV();
  const env = {
    DB: db,
    PUBLIC_TRACKING_KV: publicTrackingKv,
    PUBLIC_TRACKING_SECRET: "public-tracking-secret",
    PUBLIC_TRACKING_BASE_URL: "https://estado.example.com",
    RATE_LIMIT_KV: createMockKV(),
    WEB_LOGIN_PASSWORD: "web-pass",
    WEB_SESSION_SECRET: "web-session-secret",
  };

  const bootstrapResponse = await workerFetch(
    new Request("https://worker.example/web/auth/bootstrap", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        bootstrap_password: "web-pass",
        username: "admin_root",
        password: "StrongPass#2026",
      }),
    }),
    env,
  );
  assert.equal(bootstrapResponse.status, 201);

  const createResponse = await workerFetch(
    new Request("https://worker.example/web/installations/45/public-tracking-link", {
      method: "POST",
      headers: {
        ...webSessionHeadersFromResponse(bootstrapResponse),
      },
    }),
    env,
  );
  const createBody = await createResponse.json();
  const shortCode = decodeURIComponent(new URL(createBody.link.tracking_url).pathname.split("/").pop() || "");

  let blockedResponse = null;
  for (let attempt = 0; attempt < 13; attempt += 1) {
    blockedResponse = await workerFetch(
      new Request(`https://worker.example/track/${encodeURIComponent(shortCode)}/events`, {
        method: "GET",
        headers: {
          "CF-Connecting-IP": "198.51.100.20",
        },
      }),
      {
        PUBLIC_TRACKING_KV: publicTrackingKv,
        PUBLIC_TRACKING_SECRET: "public-tracking-secret",
        RATE_LIMIT_KV: env.RATE_LIMIT_KV,
      },
    );
    if (blockedResponse?.status === 200 && blockedResponse.body) {
      const reader = blockedResponse.body.getReader();
      await reader.cancel();
    }
  }

  assert.equal(blockedResponse.status, 429);
});

test("POST /assets/:id/incidents auto-creates installation context and copies gps snapshot", async () => {
  const baseDb = createMockDB();
  const assetLinks = [];
  const assets = [
    {
      id: 9,
      tenant_id: "default",
      external_code: "ATM-009",
      brand: "Entrust",
      serial_number: "SN-009",
      model: "Sigma",
      client_name: "Cliente GPS",
      notes: "",
      status: "active",
      created_at: "2026-03-25T21:00:00.000Z",
      updated_at: "2026-03-25T21:00:00.000Z",
    },
  ];
  const db = {
    calls: baseDb.calls,
    state: baseDb.state,
    prepare(sql) {
      const normalized = normalizeSql(sql);

      if (normalized.startsWith("SELECT id, tenant_id, external_code, brand, serial_number, model, client_name, notes, status, created_at, updated_at FROM assets WHERE id = ? AND tenant_id = ? LIMIT 1")) {
        return {
          bind(...args) {
            this.args = args;
            return this;
          },
          async all() {
            const [assetId, tenantId] = this.args;
            return {
              results: assets.filter((asset) =>
                Number(asset.id) === Number(assetId) &&
                String(asset.tenant_id) === String(tenantId),
              ),
            };
          },
        };
      }

      if (normalized.startsWith("SELECT installation_id FROM asset_installation_links WHERE tenant_id = ? AND asset_id = ? AND unlinked_at IS NULL ORDER BY linked_at DESC, id DESC LIMIT 1")) {
        return {
          bind(...args) {
            this.args = args;
            return this;
          },
          async all() {
            const [tenantId, assetId] = this.args;
            const activeLink = assetLinks.find((link) =>
              String(link.tenant_id) === String(tenantId) &&
              Number(link.asset_id) === Number(assetId) &&
              !link.unlinked_at,
            );
            return {
              results: activeLink ? [{ installation_id: activeLink.installation_id }] : [],
            };
          },
        };
      }

      if (normalized.startsWith("UPDATE asset_installation_links SET unlinked_at = ? WHERE tenant_id = ? AND asset_id = ? AND unlinked_at IS NULL AND installation_id <> ?")) {
        return {
          bind(...args) {
            this.args = args;
            return this;
          },
          async run() {
            const [unlinkedAt, tenantId, assetId, installationId] = this.args;
            let changes = 0;
            assetLinks.forEach((link) => {
              if (
                String(link.tenant_id) === String(tenantId) &&
                Number(link.asset_id) === Number(assetId) &&
                !link.unlinked_at &&
                Number(link.installation_id) !== Number(installationId)
              ) {
                link.unlinked_at = unlinkedAt;
                changes += 1;
              }
            });
            return { meta: { changes } };
          },
        };
      }

      if (normalized.startsWith("SELECT id FROM asset_installation_links WHERE tenant_id = ? AND asset_id = ? AND installation_id = ? AND unlinked_at IS NULL LIMIT 1")) {
        return {
          bind(...args) {
            this.args = args;
            return this;
          },
          async all() {
            const [tenantId, assetId, installationId] = this.args;
            const activeLink = assetLinks.find((link) =>
              String(link.tenant_id) === String(tenantId) &&
              Number(link.asset_id) === Number(assetId) &&
              Number(link.installation_id) === Number(installationId) &&
              !link.unlinked_at,
            );
            return {
              results: activeLink ? [{ id: activeLink.id }] : [],
            };
          },
        };
      }

      if (normalized.startsWith("INSERT INTO asset_installation_links")) {
        return {
          bind(...args) {
            this.args = args;
            return this;
          },
          async run() {
            const [tenantId, assetId, installationId, linkedAt, linkedByUsername, notes] = this.args;
            assetLinks.push({
              id: assetLinks.length + 1,
              tenant_id: tenantId,
              asset_id: assetId,
              installation_id: installationId,
              linked_at: linkedAt,
              unlinked_at: null,
              linked_by_username: linkedByUsername,
              notes,
            });
            return { meta: { last_row_id: assetLinks.length, changes: 1 } };
          },
        };
      }

      return baseDb.prepare(sql);
    },
  };

  const request = new Request("https://worker.example/assets/9/incidents", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      note: "Contexto auto con GPS",
      gps: {
        lat: -34.9011,
        lng: -56.1645,
        accuracy_m: 14,
        captured_at: "2026-03-25T22:30:00.000Z",
        source: "browser",
        status: "captured",
        note: "",
      },
    }),
  });

  const response = await workerFetch(request, { DB: db });
  const body = await response.json();

  assert.equal(response.status, 201);
  assert.equal(body.context_record_created, true);
  assert.equal(body.incident.gps_capture_status, "captured");
  assert.equal(db.state.installations.length, 1);
  assert.equal(db.state.installations[0].gps_capture_status, "captured");
  assert.equal(db.state.installations[0].gps_lat, -34.9011);
  assert.equal(db.state.incidents[0].gps_capture_status, "captured");
  assert.equal(db.state.incidents[0].gps_lat, -34.9011);
});

test("POST /web/devices registers fcm token for authenticated web user", async () => {
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

  const registerDeviceRequest = new Request("https://worker.example/web/devices", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...webSessionHeadersFromResponse(bootstrapResponse),
    },
    body: JSON.stringify({
      fcm_token: "fcm-device-token-12345",
      device_model: "Pixel 8",
      app_version: "1.0.0",
      platform: "android",
    }),
  });

  const registerDeviceResponse = await workerFetch(registerDeviceRequest, {
    DB: db,
    WEB_LOGIN_PASSWORD: "web-pass",
    WEB_SESSION_SECRET: "web-session-secret",
  });
  const registerDeviceBody = await registerDeviceResponse.json();

  assert.equal(registerDeviceResponse.status, 200);
  assert.equal(registerDeviceBody.success, true);
  assert.equal(registerDeviceBody.registered, true);
  assert.equal(db.state.deviceTokens.length, 1);
  assert.equal(db.state.deviceTokens[0].user_id, 3000);
  assert.equal(db.state.deviceTokens[0].fcm_token, "fcm-device-token-12345");
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
      ...webSessionHeadersFromResponse(bootstrapResponse),
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
  assert.equal(createUserBody.user.role, "solo_lectura");
  assert.equal(db.state.webUsers.length, 2);
});

test("web auth preserves tenant_id in bootstrap, login and me", async () => {
  const db = createMockDB();

  const bootstrapRequest = new Request("https://worker.example/web/auth/bootstrap", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      bootstrap_password: "web-pass",
      username: "tenant_admin",
      password: "StrongPass#2026",
      tenant_id: "acme-logistics",
    }),
  });
  const bootstrapResponse = await workerFetch(bootstrapRequest, {
    DB: db,
    WEB_LOGIN_PASSWORD: "web-pass",
    WEB_SESSION_SECRET: "web-session-secret",
  });
  const bootstrapBody = await bootstrapResponse.json();

  assert.equal(bootstrapResponse.status, 201);
  assertWebSessionAuthBody(bootstrapBody, {
    username: "tenant_admin",
    role: "admin",
    tenantId: "acme-logistics",
    bootstrapped: true,
  });

  const loginRequest = new Request("https://worker.example/web/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username: "tenant_admin",
      password: "StrongPass#2026",
    }),
  });
  const loginResponse = await workerFetch(loginRequest, {
    DB: db,
    WEB_SESSION_SECRET: "web-session-secret",
  });
  const loginBody = await loginResponse.json();

  assert.equal(loginResponse.status, 200);
  assertWebSessionAuthBody(loginBody, {
    username: "tenant_admin",
    role: "admin",
    tenantId: "acme-logistics",
  });

  const meRequest = new Request("https://worker.example/web/auth/me", {
    method: "GET",
    headers: {
      ...webSessionHeadersFromResponse(loginResponse),
    },
  });
  const meResponse = await workerFetch(meRequest, {
    DB: db,
    WEB_SESSION_SECRET: "web-session-secret",
  });
  const meBody = await meResponse.json();

  assert.equal(meResponse.status, 200);
  assertWebSessionStatusBody(meBody, {
    username: "tenant_admin",
    role: "admin",
    tenantId: "acme-logistics",
  });
});

test("admin cannot create users in a different tenant", async () => {
  const db = createMockDB();

  const bootstrapRequest = new Request("https://worker.example/web/auth/bootstrap", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      bootstrap_password: "web-pass",
      username: "admin_root",
      password: "StrongPass#2026",
      tenant_id: "tenant-a",
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
      ...webSessionHeadersFromResponse(bootstrapResponse),
    },
    body: JSON.stringify({
      username: "viewer_other_tenant",
      password: "ViewerPass#2026",
      role: "viewer",
      tenant_id: "tenant-b",
    }),
  });
  const createUserResponse = await workerFetch(createUserRequest, {
    DB: db,
    WEB_SESSION_SECRET: "web-session-secret",
  });
  const createUserBody = await createUserResponse.json();

  assert.equal(createUserResponse.status, 403);
  assert.equal(createUserBody.success, false);
  assert.equal(createUserBody.error.code, "FORBIDDEN");
  assert.match(createUserBody.error.message, /otro tenant/i);
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
      ...webSessionHeadersFromResponse(bootstrapResponse),
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
      ...webSessionHeadersFromResponse(bootstrapResponse),
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
  assert.equal(listUsersBody.pagination.has_more, false);
});

test("GET /web/auth/users paginates with limit and cursor", async () => {
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

  for (const username of ["viewer_1", "viewer_2"]) {
    const createUserRequest = new Request("https://worker.example/web/auth/users", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...webSessionHeadersFromResponse(bootstrapResponse),
      },
      body: JSON.stringify({
        username,
        password: "ViewerPass#2026",
        role: "viewer",
      }),
    });
    const createUserResponse = await workerFetch(createUserRequest, {
      DB: db,
      WEB_SESSION_SECRET: "web-session-secret",
    });
    assert.equal(createUserResponse.status, 201);
  }

  const page1Response = await workerFetch(
    new Request("https://worker.example/web/auth/users?limit=2", {
      method: "GET",
      headers: {
        ...webSessionHeadersFromResponse(bootstrapResponse),
      },
    }),
    {
      DB: db,
      WEB_SESSION_SECRET: "web-session-secret",
    },
  );
  const page1Body = await page1Response.json();
  assert.equal(page1Response.status, 200);
  assert.equal(page1Body.users.length, 2);
  assert.equal(page1Body.pagination.has_more, true);
  assert.ok(page1Body.pagination.next_cursor);

  const page2Response = await workerFetch(
    new Request(
      `https://worker.example/web/auth/users?limit=2&cursor=${encodeURIComponent(page1Body.pagination.next_cursor)}`,
      {
        method: "GET",
        headers: {
          ...webSessionHeadersFromResponse(bootstrapResponse),
        },
      },
    ),
    {
      DB: db,
      WEB_SESSION_SECRET: "web-session-secret",
    },
  );
  const page2Body = await page2Response.json();
  assert.equal(page2Response.status, 200);
  assert.equal(page2Body.users.length, 1);
  assert.equal(page2Body.users[0].username, "viewer_2");
  assert.equal(page2Body.pagination.has_more, false);
});

test("PATCH /web/auth/users/:id updates role and active status", async () => {
  const db = createMockDB();
  const sessionKv = createMockKV();
  const env = {
    DB: db,
    WEB_LOGIN_PASSWORD: "web-pass",
    WEB_SESSION_SECRET: "web-session-secret",
    WEB_SESSION_KV: sessionKv,
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
  const bootstrapBody = await bootstrapResponse.json();
  assert.equal(bootstrapResponse.status, 201);

  const createUserRequest = new Request("https://worker.example/web/auth/users", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...webSessionHeadersFromResponse(bootstrapResponse),
    },
    body: JSON.stringify({
      username: "viewer_1",
      password: "ViewerPass#2026",
      role: "viewer",
    }),
  });
  const createUserResponse = await workerFetch(createUserRequest, env);
  const createUserBody = await createUserResponse.json();
  assert.equal(createUserResponse.status, 201);

  const viewerLoginRequest = new Request("https://worker.example/web/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username: "viewer_1",
      password: "ViewerPass#2026",
    }),
  });
  const viewerLoginResponse = await workerFetch(viewerLoginRequest, env);
  assert.equal(viewerLoginResponse.status, 200);

  const patchUserRequest = new Request(
    `https://worker.example/web/auth/users/${createUserBody.user.id}`,
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        ...webSessionHeadersFromResponse(bootstrapResponse),
      },
      body: JSON.stringify({
        role: "admin",
        is_active: false,
      }),
    },
  );
  const patchUserResponse = await workerFetch(patchUserRequest, env);
  const patchUserBody = await patchUserResponse.json();

  assert.equal(patchUserResponse.status, 200);
  assert.equal(patchUserBody.success, true);
  assert.equal(patchUserBody.user.role, "admin");
  assert.equal(patchUserBody.user.is_active, false);

  const revokedViewerSessionRequest = new Request("https://worker.example/web/auth/me", {
    method: "GET",
    headers: webSessionHeadersFromResponse(viewerLoginResponse),
  });
  const revokedViewerSessionResponse = await workerFetch(revokedViewerSessionRequest, env);
  assert.equal(revokedViewerSessionResponse.status, 401);
});

test("POST /web/auth/users/:id/force-password resets password and allows login", async () => {
  const db = createMockDB();
  const sessionKv = createMockKV();
  const env = {
    DB: db,
    WEB_LOGIN_PASSWORD: "web-pass",
    WEB_SESSION_SECRET: "web-session-secret",
    WEB_SESSION_KV: sessionKv,
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
  const bootstrapBody = await bootstrapResponse.json();
  assert.equal(bootstrapResponse.status, 201);

  const createUserRequest = new Request("https://worker.example/web/auth/users", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...webSessionHeadersFromResponse(bootstrapResponse),
    },
    body: JSON.stringify({
      username: "viewer_1",
      password: "ViewerPass#2026",
      role: "viewer",
    }),
  });
  const createUserResponse = await workerFetch(createUserRequest, env);
  const createUserBody = await createUserResponse.json();
  assert.equal(createUserResponse.status, 201);

  const viewerLoginRequest = new Request("https://worker.example/web/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username: "viewer_1",
      password: "ViewerPass#2026",
    }),
  });
  const viewerLoginResponse = await workerFetch(viewerLoginRequest, env);
  assert.equal(viewerLoginResponse.status, 200);

  const resetPasswordRequest = new Request(
    `https://worker.example/web/auth/users/${createUserBody.user.id}/force-password`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...webSessionHeadersFromResponse(bootstrapResponse),
      },
      body: JSON.stringify({
        new_password: "ViewerPass#2027",
      }),
    },
  );
  const resetPasswordResponse = await workerFetch(resetPasswordRequest, env);
  const resetPasswordBody = await resetPasswordResponse.json();
  assert.equal(resetPasswordResponse.status, 200);
  assert.equal(resetPasswordBody.success, true);

  const revokedViewerSessionRequest = new Request("https://worker.example/web/auth/me", {
    method: "GET",
    headers: webSessionHeadersFromResponse(viewerLoginResponse),
  });
  const revokedViewerSessionResponse = await workerFetch(revokedViewerSessionRequest, env);
  assert.equal(revokedViewerSessionResponse.status, 401);

  const oldLoginRequest = new Request("https://worker.example/web/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username: "viewer_1",
      password: "ViewerPass#2026",
    }),
  });
  const oldLoginResponse = await workerFetch(oldLoginRequest, env);
  assert.equal(oldLoginResponse.status, 401);

  const newLoginRequest = new Request("https://worker.example/web/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username: "viewer_1",
      password: "ViewerPass#2027",
    }),
  });
  const newLoginResponse = await workerFetch(newLoginRequest, env);
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
      ...webSessionHeadersFromResponse(bootstrapResponse),
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

test("GET /web/events rejects token in query string", async () => {
  const request = new Request("https://worker.example/web/events?token=leaked-token", {
    method: "GET",
  });

  const response = await workerFetch(request, {});
  const body = await response.json();

  assert.equal(response.status, 400);
  assert.equal(body.success, false);
  assert.match(body.error.message, /query string/i);
});

test("GET /web/events closes gracefully when broker stream hits SSE client write timeout", async () => {
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

  const encoder = new TextEncoder();
  const brokerResponse = new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode("data: {\"type\":\"connected\"}\n\n"));
      controller.error(new Error("SSE client write timeout"));
    },
  }), {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });

  const env = {
    DB: db,
    WEB_LOGIN_PASSWORD: "web-pass",
    WEB_SESSION_SECRET: "web-session-secret",
    REALTIME_EVENTS: {
      idFromName(name) {
        return name;
      },
      get() {
        return {
          fetch: async () => brokerResponse.clone(),
        };
      },
    },
  };

  const bootstrapResponse = await workerFetch(bootstrapRequest, env);
  assert.equal(bootstrapResponse.status, 201);

  const request = new Request("https://worker.example/web/events", {
    method: "GET",
    headers: webSessionHeadersFromResponse(bootstrapResponse),
  });

  const response = await workerFetch(request, env);
  await assert.doesNotReject(async () => {
    await response.text();
  });

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Content-Type"), "text/event-stream");
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

test("POST /web/auth/bootstrap rate limits repeated failed bootstrap_password attempts with RATE_LIMIT_KV", async () => {
  const db = createMockDB();
  const rateLimitKv = createMockKV();
  const env = {
    DB: db,
    WEB_LOGIN_PASSWORD: "web-pass",
    WEB_SESSION_SECRET: "web-session-secret",
    RATE_LIMIT_KV: rateLimitKv,
  };
  const requestHeaders = {
    "Content-Type": "application/json",
    "CF-Connecting-IP": "198.51.100.10",
  };
  const requestPayload = JSON.stringify({
    bootstrap_password: "wrong-pass",
    username: "admin_root",
    password: "StrongPass#2026",
    role: "admin",
  });

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const bootstrapRequest = new Request("https://worker.example/web/auth/bootstrap", {
      method: "POST",
      headers: requestHeaders,
      body: requestPayload,
    });
    const bootstrapResponse = await workerFetch(bootstrapRequest, env);
    assert.equal(bootstrapResponse.status, 401);
  }

  const blockedRequest = new Request("https://worker.example/web/auth/bootstrap", {
    method: "POST",
    headers: requestHeaders,
    body: requestPayload,
  });
  const blockedResponse = await workerFetch(blockedRequest, env);
  const blockedBody = await blockedResponse.json();

  assert.equal(blockedResponse.status, 429);
  assert.equal(blockedBody.success, false);
  assert.match(blockedBody.error.message, /demasiados intentos/i);
  assert.equal(
    await rateLimitKv.get("web_login_attempts:198.51.100.10:bootstrap"),
    "5",
  );

  const ttlCall = rateLimitKv.calls.find(
    (entry) => entry.op === "put" && entry.key === "web_login_attempts:198.51.100.10:bootstrap",
  );
  assert.equal(ttlCall?.options?.expirationTtl, 900);
});

test("POST /web/auth/bootstrap clears RATE_LIMIT_KV counter after successful bootstrap", async () => {
  const db = createMockDB();
  const rateLimitKv = createMockKV();
  const env = {
    DB: db,
    WEB_LOGIN_PASSWORD: "web-pass",
    WEB_SESSION_SECRET: "web-session-secret",
    RATE_LIMIT_KV: rateLimitKv,
  };

  const failedRequest = new Request("https://worker.example/web/auth/bootstrap", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "CF-Connecting-IP": "198.51.100.10",
    },
    body: JSON.stringify({
      bootstrap_password: "wrong-pass",
      username: "admin_root",
      password: "StrongPass#2026",
      role: "admin",
    }),
  });
  const failedResponse = await workerFetch(failedRequest, env);
  assert.equal(failedResponse.status, 401);
  assert.equal(
    await rateLimitKv.get("web_login_attempts:198.51.100.10:bootstrap"),
    "1",
  );

  const successfulRequest = new Request("https://worker.example/web/auth/bootstrap", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "CF-Connecting-IP": "198.51.100.10",
    },
    body: JSON.stringify({
      bootstrap_password: "web-pass",
      username: "admin_root",
      password: "StrongPass#2026",
      role: "admin",
    }),
  });
  const successfulResponse = await workerFetch(successfulRequest, env);
  assert.equal(successfulResponse.status, 201);
  assert.equal(
    await rateLimitKv.get("web_login_attempts:198.51.100.10:bootstrap"),
    null,
  );
  assert.equal(
    rateLimitKv.calls.some(
      (entry) => entry.op === "delete" && entry.key === "web_login_attempts:198.51.100.10:bootstrap",
    ),
    true,
  );
});

test("POST /web/auth/bootstrap returns conflict when bootstrap already executed", async () => {
  const db = createMockDB({
    webUsers: [
      {
        id: 1,
        username: "existing_admin",
        password_hash: "pbkdf2_sha256$100000$salt$hash",
        role: "admin",
      },
    ],
  });

  const request = new Request("https://worker.example/web/auth/bootstrap", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      bootstrap_password: "wrong-pass",
      username: "admin_root",
      password: "StrongPass#2026",
      role: "admin",
    }),
  });
  const response = await workerFetch(request, {
    DB: db,
    WEB_LOGIN_PASSWORD: "web-pass",
    WEB_SESSION_SECRET: "web-session-secret",
  });
  const body = await response.json();

  assert.equal(response.status, 409);
  assert.equal(body.success, false);
  assert.equal(body.error.code, "CONFLICT");
  assert.match(body.error.message, /bootstrap ya ejecutado/i);
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
      "X-Request-Nonce": "nonce-test-000000000001",
    },
  });

  const response = await workerFetch(request, {
    DB: db,
    API_TOKEN: "token-123",
    API_SECRET: "secret-abc",
  });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(body, [
    {
      id: 1,
      driver_brand: "Zebra",
      status: "success",
      gps_lat: null,
      gps_lng: null,
      gps_accuracy_m: null,
      gps_captured_at: null,
      gps_capture_source: "none",
      gps_capture_status: "pending",
      gps_capture_note: "",
      site_lat: null,
      site_lng: null,
      site_radius_m: null,
      tenant_id: "default",
      incident_open_count: 0,
      incident_in_progress_count: 0,
      incident_paused_count: 0,
      incident_resolved_count: 0,
      incident_active_count: 0,
      incident_critical_active_count: 0,
      incident_estimated_duration_seconds_total: 0,
      incident_estimated_duration_count: 0,
      incident_actual_duration_seconds_total: 0,
      incident_actual_duration_count: 0,
      attention_state: "clear",
    },
  ]);
});

test("rejects signed requests when X-Tenant-Id does not match configured legacy tenant", async () => {
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
      "X-Request-Nonce": "nonce-test-000000000001",
      "X-Tenant-Id": "tenant-b",
    },
  });

  const response = await workerFetch(request, {
    DB: db,
    API_TOKEN: "token-123",
    API_SECRET: "secret-abc",
    DRIVER_MANAGER_API_TENANT_ID: "tenant-a",
  });
  const body = await response.json();

  assert.equal(response.status, 403);
  assert.equal(body.success, false);
  assert.match(body.error.message, /tenant permitido/i);
});

test("rejects signed requests when legacy tenant binding is not configured", async () => {
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
      "X-Request-Nonce": "nonce-test-000000000001",
    },
  });

  const response = await workerFetch(request, {
    DB: db,
    API_TOKEN: "token-123",
    API_SECRET: "secret-abc",
    DRIVER_MANAGER_API_TENANT_ID: "",
    API_TENANT_ID: "",
  });
  const body = await response.json();

  assert.equal(response.status, 503);
  assert.equal(body.success, false);
  assert.match(body.error.message, /api legacy deshabilitada/i);
});


test("rejects signed auth for mobile platform header", async () => {
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
      "X-Request-Nonce": "nonce-test-000000000001",
      "X-Client-Platform": "mobile",
    },
  });

  const response = await workerFetch(request, {
    DB: db,
    API_TOKEN: "token-123",
    API_SECRET: "secret-abc",
  });
  const body = await response.json();

  assert.equal(response.status, 410);
  assert.match(body.error.message, /HMAC deshabilitada para clientes moviles/i);
});

