import test from "node:test";
import assert from "node:assert/strict";

import worker from "../worker.js";

function normalizeSql(sql) {
  return sql.replace(/\s+/g, " ").trim();
}

function createMockDB({ installations = [], byBrand = [] } = {}) {
  const calls = [];

  return {
    calls,
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
          if (normalized.startsWith("SELECT * FROM installations")) {
            return { results: installations };
          }
          if (normalized.startsWith("SELECT driver_brand, COUNT(*) as count FROM installations")) {
            return { results: byBrand };
          }
          throw new Error(`Unexpected query for .all(): ${normalized}`);
        },
        async run() {
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

test("GET /statistics returns grouped brands map", async () => {
  const db = createMockDB({
    byBrand: [
      { driver_brand: "Zebra", count: 2 },
      { driver_brand: "Magicard", count: 1 },
      { driver_brand: "", count: 4 },
    ],
  });
  const request = new Request("https://worker.example/statistics", { method: "GET" });

  const response = await worker.fetch(request, { DB: db });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(body, {
    by_brand: {
      Zebra: 2,
      Magicard: 1,
    },
  });
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
