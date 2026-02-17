import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

import worker from "../worker.js";

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
} = {}) {
  const calls = [];
  const state = {
    installations: installations.map((row) => ({ ...row })),
    byBrand: byBrand.map((row) => ({ ...row })),
    incidents: incidents.map((row) => ({ ...row })),
    incidentPhotos: incidentPhotos.map((row) => ({ ...row })),
  };

  let nextInstallationId = 100;
  let nextIncidentId = 1000;
  let nextPhotoId = 2000;

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

          throw new Error(`Unexpected query for .all(): ${normalized}`);
        },
        async run() {
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

          return { success: true };
        },
      };
    },
  };
}

test("OPTIONS request returns CORS headers", async () => {
  const request = new Request("https://worker.example/installations", { method: "OPTIONS" });
  const response = await worker.fetch(request, {});

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), "*");
  assert.match(response.headers.get("Access-Control-Allow-Methods"), /OPTIONS/);
});

test("GET /installations returns DB rows as JSON", async () => {
  const db = createMockDB({
    installations: [{ id: 1, driver_brand: "Zebra", status: "success" }],
  });
  const request = new Request("https://worker.example/installations", { method: "GET" });

  const response = await worker.fetch(request, { DB: db });
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

  const response = await worker.fetch(request, { DB: db });
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

  const response = await worker.fetch(request, { DB: db });
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

  const response = await worker.fetch(request, { DB: db });
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

  const response = await worker.fetch(request, { DB: db });
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

  const response = await worker.fetch(request, { DB: db });
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

  const response = await worker.fetch(request, { DB: db });
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

  const response = await worker.fetch(request, { DB: db });
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

  const response = await worker.fetch(request, { DB: db });
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

  const response = await worker.fetch(request, { DB: db });
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

  const response = await worker.fetch(request, { DB: db });
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

  const response = await worker.fetch(request, { DB: db });
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

  const response = await worker.fetch(request, { DB: db });
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

  const response = await worker.fetch(request, { DB: db });
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

  const response = await worker.fetch(request, { DB: db });
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

  const payload = new Uint8Array([1, 2, 3, 4, 5]);
  const request = new Request("https://worker.example/incidents/11/photos", {
    method: "POST",
    headers: {
      "Content-Type": "image/png",
      "X-File-Name": "evidencia.png",
    },
    body: payload,
  });

  const response = await worker.fetch(request, {
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
    body: new Uint8Array(8 * 1024 * 1024 + 1),
  });

  const response = await worker.fetch(request, {
    DB: db,
    INCIDENTS_BUCKET: bucket,
  });
  const body = await response.json();

  assert.equal(response.status, 413);
  assert.equal(body.success, false);
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

  const response = await worker.fetch(request, { DB: db });
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

  const response = await worker.fetch(request, {
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
  const request = new Request("https://worker.example/incidents/999/photos", {
    method: "POST",
    headers: { "Content-Type": "image/jpeg" },
    body: new Uint8Array([1, 2, 3]),
  });

  const response = await worker.fetch(request, {
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
  const request = new Request("https://worker.example/incidents/11/photos", {
    method: "POST",
    headers: { "Content-Type": "image/jpeg" },
    body: new Uint8Array([1, 2, 3]),
  });

  const response = await worker.fetch(request, { DB: db });
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

  const response = await worker.fetch(request, { DB: db });
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

  const response = await worker.fetch(request, { DB: db });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.total_installations, 2);
  assert.equal(body.successful_installations, 1);
  assert.equal(body.failed_installations, 1);
  assert.equal(body.unique_clients, 2);
  assert.deepEqual(body.by_brand, { Zebra: 1, Magicard: 1 });
});

test("unsupported method on /installations returns 404", async () => {
  const db = createMockDB();
  const request = new Request("https://worker.example/installations", {
    method: "PATCH",
  });

  const response = await worker.fetch(request, { DB: db });
  const text = await response.text();

  assert.equal(response.status, 404);
  assert.equal(text, "Ruta no encontrada.");
});

test("GET /installations/:id is currently unsupported and returns 404", async () => {
  const db = createMockDB();
  const request = new Request("https://worker.example/installations/99", {
    method: "GET",
  });

  const response = await worker.fetch(request, { DB: db });
  const text = await response.text();

  assert.equal(response.status, 404);
  assert.equal(text, "Ruta no encontrada.");
});

test("invalid JSON payload returns 500 with error body", async () => {
  const db = createMockDB();
  const request = new Request("https://worker.example/installations", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{invalid json",
  });

  const response = await worker.fetch(request, { DB: db });
  const body = await response.json();

  assert.equal(response.status, 500);
  assert.equal(typeof body.error, "string");
  assert.notEqual(body.error.length, 0);
});

test("unknown route returns 404", async () => {
  const db = createMockDB();
  const request = new Request("https://worker.example/unknown", { method: "GET" });

  const response = await worker.fetch(request, { DB: db });
  const text = await response.text();

  assert.equal(response.status, 404);
  assert.equal(text, "Ruta no encontrada.");
});

test("returns 500 when DB binding is missing", async () => {
  const request = new Request("https://worker.example/installations", { method: "GET" });

  const response = await worker.fetch(request, {});
  const body = await response.json();

  assert.equal(response.status, 500);
  assert.match(body.error, /D1/);
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

  const response = await worker.fetch(request, {
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

  const response = await worker.fetch(request, {
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

  const response = await worker.fetch(request, {
    DB: db,
    API_TOKEN: "token-123",
    API_SECRET: "secret-abc",
  });
  const body = await response.json();

  assert.equal(response.status, 401);
  assert.equal(body.success, false);
  assert.match(body.error.message, /firma/i);
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

  const response = await worker.fetch(request, {
    DB: db,
    API_TOKEN: "token-123",
    API_SECRET: "secret-abc",
  });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(body, [{ id: 1, driver_brand: "Zebra", status: "success" }]);
});
