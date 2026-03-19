#!/usr/bin/env node

const DEFAULT_WORKER_URL = "http://127.0.0.1:8787";
const DEFAULT_WAIT_MS = 8000;
const DEFAULT_PUBLISHER = "A";

function requiredEnv(name) {
  const value = String(process.env[name] || "").trim();
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

function optionalEnv(name, fallback = "") {
  const value = String(process.env[name] || "").trim();
  return value || fallback;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function login(baseUrl, username, password) {
  const response = await fetch(`${baseUrl}/web/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`Login failed for ${username}: ${data?.error?.message || response.status}`);
  }
  return {
    token: data.access_token,
    username: data?.user?.username || username,
    role: data?.user?.role || "",
    tenantId: data?.user?.tenant_id || data?.tenant_id || "default",
  };
}

async function openSseStream(baseUrl, token, label, onEvent, abortSignal) {
  const response = await fetch(`${baseUrl}/web/events`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "text/event-stream",
      "Cache-Control": "no-cache",
    },
    signal: abortSignal,
  });
  if (!response.ok || !response.body) {
    throw new Error(`[${label}] SSE failed: HTTP ${response.status}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const payloadText = trimmed.slice(5).trim();
      if (!payloadText) continue;
      try {
        const payload = JSON.parse(payloadText);
        onEvent(label, payload);
      } catch {
        // Ignore non-JSON chunks
      }
    }
  }
}

async function createProbeInstallation(baseUrl, token, marker) {
  const response = await fetch(`${baseUrl}/web/installations`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      timestamp: new Date().toISOString(),
      driver_brand: "SSE",
      driver_version: "tenant-probe",
      status: "success",
      client_name: "tenant-check",
      driver_description: "sse-tenant-isolation",
      installation_time_seconds: 1,
      os_info: "probe",
      notes: marker,
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`Failed to create probe installation: ${data?.error?.message || response.status}`);
  }
}

function isProbeEvent(payload, marker) {
  if (!payload || payload.type !== "installation_created") return false;
  const installation = payload.installation || {};
  return String(installation.notes || "") === marker;
}

async function main() {
  const baseUrl = optionalEnv(
    "WORKER_URL",
    optionalEnv("DRIVER_MANAGER_HISTORY_API_URL", DEFAULT_WORKER_URL),
  ).replace(/\/+$/, "");
  const waitMs = Number.parseInt(optionalEnv("WAIT_MS", String(DEFAULT_WAIT_MS)), 10);
  const publisher = optionalEnv("PUBLISH_WITH", DEFAULT_PUBLISHER).toUpperCase();

  if (!Number.isInteger(waitMs) || waitMs < 2000 || waitMs > 60000) {
    throw new Error("WAIT_MS must be an integer between 2000 and 60000");
  }
  if (!["A", "B"].includes(publisher)) {
    throw new Error("PUBLISH_WITH must be A or B");
  }

  const userA = requiredEnv("TENANT_A_USERNAME");
  const passA = requiredEnv("TENANT_A_PASSWORD");
  const userB = requiredEnv("TENANT_B_USERNAME");
  const passB = requiredEnv("TENANT_B_PASSWORD");

  console.log(`[INFO] Worker URL: ${baseUrl}`);
  console.log("[INFO] Logging in tenant A and tenant B...");
  const [sessionA, sessionB] = await Promise.all([
    login(baseUrl, userA, passA),
    login(baseUrl, userB, passB),
  ]);
  console.log(`[INFO] A => ${sessionA.username} (tenant=${sessionA.tenantId}, role=${sessionA.role})`);
  console.log(`[INFO] B => ${sessionB.username} (tenant=${sessionB.tenantId}, role=${sessionB.role})`);

  if (sessionA.tenantId === sessionB.tenantId) {
    throw new Error("Both users are in the same tenant. Use users from different tenants.");
  }

  const marker = `tenant-probe-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const events = { A: [], B: [] };
  const controllerA = new AbortController();
  const controllerB = new AbortController();

  const streamPromiseA = openSseStream(
    baseUrl,
    sessionA.token,
    "A",
    (label, payload) => events[label].push(payload),
    controllerA.signal,
  ).catch((error) => {
    if (controllerA.signal.aborted) return;
    throw error;
  });

  const streamPromiseB = openSseStream(
    baseUrl,
    sessionB.token,
    "B",
    (label, payload) => events[label].push(payload),
    controllerB.signal,
  ).catch((error) => {
    if (controllerB.signal.aborted) return;
    throw error;
  });

  console.log("[INFO] Waiting 1200ms for SSE connections...");
  await sleep(1200);

  const publisherSession = publisher === "A" ? sessionA : sessionB;
  console.log(`[INFO] Publishing probe installation with tenant ${publisherSession.tenantId}...`);
  await createProbeInstallation(baseUrl, publisherSession.token, marker);

  console.log(`[INFO] Collecting events for ${waitMs}ms...`);
  await sleep(waitMs);

  controllerA.abort();
  controllerB.abort();
  await Promise.allSettled([streamPromiseA, streamPromiseB]);

  const gotProbeA = events.A.some((event) => isProbeEvent(event, marker));
  const gotProbeB = events.B.some((event) => isProbeEvent(event, marker));
  const expectedA = publisher === "A";
  const expectedB = publisher === "B";

  console.log("");
  console.log("=== SSE Tenant Isolation Report ===");
  console.log(`Publisher tenant: ${publisherSession.tenantId} (${publisher})`);
  console.log(`Probe marker: ${marker}`);
  console.log(`A received probe: ${gotProbeA}`);
  console.log(`B received probe: ${gotProbeB}`);
  console.log(`Expected A: ${expectedA}`);
  console.log(`Expected B: ${expectedB}`);

  if (gotProbeA === expectedA && gotProbeB === expectedB) {
    console.log("[PASS] Tenant isolation is working for SSE events.");
    process.exit(0);
  }

  console.error("[FAIL] Tenant isolation mismatch detected.");
  process.exit(1);
}

main().catch((error) => {
  console.error(`[ERROR] ${error.message}`);
  process.exit(1);
});
