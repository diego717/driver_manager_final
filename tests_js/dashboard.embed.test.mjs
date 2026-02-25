import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";

import worker from "../worker.js";

function getInlineScripts(html) {
  const scripts = [];
  const regex = /<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = regex.exec(html)) !== null) {
    const body = match[1] || "";
    if (body.trim()) scripts.push(body);
  }
  return scripts;
}

test("GET /web/dashboard returns embebbed dashboard with syntactically valid inline scripts", async () => {
  const response = await worker.fetch(new Request("https://worker.example/web/dashboard"), {});
  const html = await response.text();

  assert.equal(response.status, 200);
  assert.match(response.headers.get("Content-Type") || "", /text\/html/i);
  assert.match(html, /\/web\/photos\//);
  assert.match(html, /instalaciones\.xls/);
  assert.match(html, /setupExportButtons\(\)/);

  const inlineScripts = getInlineScripts(html);
  assert.ok(inlineScripts.length >= 2, "Expected embedded dashboard JS and PWA scripts");

  for (const [index, code] of inlineScripts.entries()) {
    assert.doesNotThrow(
      () => new vm.Script(code, { filename: `embedded-dashboard-script-${index + 1}.js` }),
      `Inline script ${index + 1} should parse`,
    );
  }
});
