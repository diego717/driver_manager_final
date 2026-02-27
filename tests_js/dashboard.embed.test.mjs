import test from "node:test";
import assert from "node:assert/strict";

import worker from "../worker.js";

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

test("GET /web/dashboard returns embedded dashboard with CSP compatible with inline scripts and Chart.js CDN", async () => {
  const response = await worker.fetch(new Request("https://worker.example/web/dashboard"), {});
  const html = await response.text();

  assert.equal(response.status, 200);
  assert.match(response.headers.get("Content-Type") || "", /text\/html/i);

  const inlineScripts = extractInlineScripts(html);
  assert.ok(inlineScripts.length > 0, "Embedded dashboard should include inline scripts");

  const scripts = extractExternalScripts(html);
  assert.deepEqual(scripts, ["https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js"]);

  const csp = response.headers.get("Content-Security-Policy") || "";
  assert.match(csp, /script-src 'self' https:\/\/cdn\.jsdelivr\.net 'unsafe-inline'/);
  assert.match(csp, /style-src 'self' 'unsafe-inline'/);
  assert.match(csp, /object-src 'none'/);
  assert.match(csp, /frame-ancestors 'none'/);
});
