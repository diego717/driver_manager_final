import test from "node:test";
import assert from "node:assert/strict";

import worker from "../worker.js";
import { createDashboardAssetsBinding } from "./helpers/assets.mock.mjs";

function extractExternalScripts(html) {
  return [...html.matchAll(/<script\s+[^>]*src="([^"]+)"[^>]*><\/script>/gi)].map((match) => match[1]);
}

function extractInlineScripts(html) {
  const scripts = [];
  const regex = /<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = regex.exec(html)) !== null) {
    if ((match[1] || "").trim()) scripts.push(match[1]);
  }
  return scripts;
}

test("GET /web/dashboard serves static dashboard with strict CSP and external scripts", async () => {
  const response = await worker.fetch(new Request("https://worker.example/web/dashboard"), {
    ASSETS: createDashboardAssetsBinding(),
  });
  const html = await response.text();

  assert.equal(response.status, 200);
  assert.match(response.headers.get("Content-Type") || "", /text\/html/i);

  const inlineScripts = extractInlineScripts(html);
  assert.equal(inlineScripts.length, 0, "Dashboard should not include inline scripts");

  const scripts = extractExternalScripts(html);
  assert.deepEqual(scripts, [
    "https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js",
    "/dashboard.js",
    "/dashboard-pwa.js",
  ]);

  const csp = response.headers.get("Content-Security-Policy") || "";
  assert.match(csp, /script-src 'self' https:\/\/cdn\.jsdelivr\.net/);
  assert.match(csp, /style-src 'self'/);
  assert.match(csp, /object-src 'none'/);
  assert.match(csp, /frame-ancestors 'none'/);
});
