import test from "node:test";
import assert from "node:assert/strict";

import worker from "../worker.js";
import { createAssetsBinding } from "./helpers/assets.mock.mjs";

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

test("GET /web/dashboard returns versioned static dashboard and strict CSP", async () => {
  const response = await worker.fetch(new Request("https://worker.example/web/dashboard"), {
    ASSETS: createAssetsBinding(),
  });
  const html = await response.text();

  assert.equal(response.status, 200);
  assert.match(response.headers.get("Content-Type") || "", /text\/html/i);

  const inlineScripts = extractInlineScripts(html);
  assert.equal(inlineScripts.length, 0, "Dashboard should not embed inline scripts");

  const scripts = extractExternalScripts(html);
  assert.ok(scripts.includes("https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js"));
  assert.ok(scripts.some((src) => /^\/dashboard\.js\?v=[a-f0-9]{10}$/.test(src)));
  assert.ok(scripts.some((src) => /^\/dashboard-pwa\.js\?v=[a-f0-9]{10}$/.test(src)));
  assert.match(html, /href="\/dashboard\.css\?v=[a-f0-9]{10}"/);
  assert.match(html, /href="\/manifest\.json\?v=[a-f0-9]{10}"/);

  const csp = response.headers.get("Content-Security-Policy") || "";
  assert.match(csp, /script-src 'self' https:\/\/cdn\.jsdelivr\.net/);
  assert.match(csp, /style-src 'self'/);
  assert.match(csp, /object-src 'none'/);
  assert.match(csp, /frame-ancestors 'none'/);
});
