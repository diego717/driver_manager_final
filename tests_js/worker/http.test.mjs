import assert from "node:assert/strict";
import test from "node:test";

import {
  appendVaryHeader,
  applyNoStoreHeaders,
  buildCorsPolicy,
  corsHeaders,
  jsonResponse,
  setHeaderWithVaryMerge,
  textResponse,
} from "../../worker/lib/http.js";

test("http helpers build cors policy for incident photo uploads", () => {
  const policy = buildCorsPolicy(false, ["incidents", "55", "photos"]);

  assert.deepEqual(policy.methods.sort(), ["GET", "OPTIONS", "PATCH", "POST"]);
  assert.deepEqual(policy.headers.sort(), [
    "Content-Type",
    "X-API-Token",
    "X-Asset-Code",
    "X-Body-SHA256",
    "X-Client-Name",
    "X-File-Name",
    "X-Request-Nonce",
    "X-Request-Signature",
    "X-Request-Timestamp",
  ]);
});

test("http helpers resolve cors headers for configured and localhost origins", () => {
  const request = new Request("https://worker.example/installations", {
    headers: {
      Origin: "https://console.example.com",
    },
  });

  const configuredHeaders = corsHeaders(request, {
    CORS_ALLOWED_ORIGINS: "https://console.example.com",
  }, {
    methods: ["GET", "POST"],
    headers: ["Content-Type"],
  });

  assert.equal(configuredHeaders["Access-Control-Allow-Origin"], "https://console.example.com");
  assert.equal(configuredHeaders["Access-Control-Allow-Methods"], "GET, POST");

  const localhostHeaders = corsHeaders(
    new Request("https://worker.example/installations", {
      headers: {
        Origin: "http://localhost:3000",
      },
    }),
    {
      ALLOW_LOCALHOST_CORS: "true",
    },
    {
      methods: ["GET"],
      headers: [],
    },
  );

  assert.equal(localhostHeaders["Access-Control-Allow-Origin"], "http://localhost:3000");
});

test("http helpers merge vary headers without duplication", () => {
  const headers = new Headers({
    Vary: "Origin",
  });

  appendVaryHeader(headers, "Accept-Encoding");
  setHeaderWithVaryMerge(headers, "Vary", "Origin");

  assert.equal(headers.get("Vary"), "Origin, Accept-Encoding");
});

test("http helpers add no-store headers for web responses", async () => {
  const json = jsonResponse(
    new Request("https://worker.example/web/auth/login"),
    {},
    { methods: ["POST"], headers: ["Content-Type"] },
    { success: true },
  );
  const text = textResponse(
    new Request("https://worker.example/web/auth/logout"),
    {},
    { methods: ["POST"], headers: [] },
    "ok",
  );

  applyNoStoreHeaders(text);

  assert.equal(json.headers.get("Cache-Control"), "no-store");
  assert.equal(json.headers.get("Pragma"), "no-cache");
  assert.equal(json.headers.get("X-Content-Type-Options"), "nosniff");
  assert.equal(json.headers.get("Referrer-Policy"), "no-referrer");
  assert.equal(text.headers.get("Cache-Control"), "no-store");
  assert.equal(text.headers.get("X-Content-Type-Options"), "nosniff");
  assert.equal(text.headers.get("Referrer-Policy"), "no-referrer");
  assert.equal(await text.text(), "ok");
});
