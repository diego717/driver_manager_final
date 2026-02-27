import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

const baseUrl = (process.env.REMOTE_SMOKE_BASE_URL || "").trim().replace(/\/+$/, "");
const apiToken = (process.env.REMOTE_SMOKE_API_TOKEN || "").trim();
const apiSecret = (process.env.REMOTE_SMOKE_API_SECRET || "").trim();
const webUsername = (process.env.REMOTE_SMOKE_WEB_USERNAME || "").trim();
const webPassword = process.env.REMOTE_SMOKE_WEB_PASSWORD || "";

function sha256Hex(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function signRequest({ method, path, timestamp, bodyBuffer, secret }) {
  const bodyHash = sha256Hex(bodyBuffer || Buffer.alloc(0));
  const canonical = `${method.toUpperCase()}|${path}|${timestamp}|${bodyHash}`;
  return crypto.createHmac("sha256", secret).update(canonical).digest("hex");
}

function requireBaseUrl() {
  assert.ok(
    baseUrl.length > 0,
    "Set REMOTE_SMOKE_BASE_URL to run remote smoke tests.",
  );
}

async function signedFetch(pathname, { method = "GET", body = null, headers = {} } = {}) {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const bodyBuffer = body ? Buffer.from(body) : Buffer.alloc(0);
  const signature = signRequest({
    method,
    path: pathname,
    timestamp,
    bodyBuffer,
    secret: apiSecret,
  });

  const requestHeaders = {
    "X-API-Token": apiToken,
    "X-Request-Timestamp": timestamp,
    "X-Request-Signature": signature,
    ...headers,
  };

  return fetch(`${baseUrl}${pathname}`, {
    method,
    headers: requestHeaders,
    body: bodyBuffer.length > 0 ? bodyBuffer : undefined,
  });
}

test(
  "remote smoke: GET /health responds ok",
  {
    skip: !baseUrl,
  },
  async () => {
  requireBaseUrl();

  const response = await fetch(`${baseUrl}/health`);
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(typeof body.now, "string");
  },
);

test(
  "remote smoke: GET / responds with service metadata",
  {
    skip: !baseUrl,
  },
  async () => {
  requireBaseUrl();

  const response = await fetch(`${baseUrl}/`);
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.service, "driver-manager-api");
  assert.equal(body.status, "ok");
  assert.equal(typeof body.docs, "object");
  },
);

test(
  "remote smoke: signed GET /installations works with API token/signature",
  {
    skip: !(baseUrl && apiToken && apiSecret),
  },
  async () => {
    requireBaseUrl();

    const response = await signedFetch("/installations?limit=1");
    const contentType = response.headers.get("content-type") || "";
    const body = await response.json();

    assert.equal(response.status, 200, `Expected 200, got ${response.status}: ${JSON.stringify(body)}`);
    assert.match(contentType, /application\/json/i);
    assert.equal(Array.isArray(body), true);
  },
);

test(
  "remote smoke: web login + /web/installations works with Bearer token",
  {
    skip: !(baseUrl && webUsername && webPassword),
  },
  async () => {
    requireBaseUrl();

    const loginResponse = await fetch(`${baseUrl}/web/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: webUsername,
        password: webPassword,
      }),
    });
    const loginBody = await loginResponse.json();

    assert.equal(
      loginResponse.status,
      200,
      `Expected 200 on login, got ${loginResponse.status}: ${JSON.stringify(loginBody)}`,
    );
    assert.equal(loginBody.success, true);
    assert.equal(typeof loginBody.access_token, "string");

    const listResponse = await fetch(`${baseUrl}/web/installations?limit=1`, {
      headers: {
        Authorization: `Bearer ${loginBody.access_token}`,
      },
    });
    const listBody = await listResponse.json();

    assert.equal(
      listResponse.status,
      200,
      `Expected 200 on /web/installations, got ${listResponse.status}: ${JSON.stringify(listBody)}`,
    );
    assert.equal(Array.isArray(listBody), true);
  },
);
