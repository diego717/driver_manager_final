import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const rootDir = process.cwd();
const publicDir = path.join(rootDir, "public");

const sources = {
  html: path.join(rootDir, "dashboard.html"),
  css: path.join(rootDir, "dashboard.css"),
  qr: path.join(rootDir, "dashboard-qr.js"),
  js: path.join(rootDir, "dashboard.js"),
  pwa: path.join(rootDir, "dashboard-pwa.js"),
  manifest: path.join(rootDir, "manifest.json"),
  sw: path.join(rootDir, "sw.js"),
};

function readFile(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`No existe archivo requerido: ${filePath}`);
  }
  return fs.readFileSync(filePath, "utf8");
}

function hashOf(content) {
  return crypto.createHash("sha256").update(content).digest("hex").slice(0, 10);
}

function rewriteDashboardHtml(content, versions) {
  return content
    .replace(/href="\/dashboard\.css(?:\?v=[^"]+)?"/g, `href="/dashboard.css?v=${versions.css}"`)
    .replace(/href="\/manifest\.json(?:\?v=[^"]+)?"/g, `href="/manifest.json?v=${versions.manifest}"`)
    .replace(/src="\/dashboard-qr\.js(?:\?v=[^"]+)?"/g, `src="/dashboard-qr.js?v=${versions.qr}"`)
    .replace(/src="\/dashboard\.js(?:\?v=[^"]+)?"/g, `src="/dashboard.js?v=${versions.js}"`)
    .replace(/src="\/dashboard-pwa\.js(?:\?v=[^"]+)?"/g, `src="/dashboard-pwa.js?v=${versions.pwa}"`);
}

function rewriteDashboardPwa(content, versions) {
  return content.replace(/\/sw\.js/g, `/sw.js?v=${versions.sw}`);
}

function rewriteServiceWorker(content, versions) {
  const cacheName = `driver-manager-${versions.build}`;
  const staticAssets = [
    "/web/dashboard",
    `/dashboard.css?v=${versions.css}`,
    `/dashboard-qr.js?v=${versions.qr}`,
    `/dashboard.js?v=${versions.js}`,
    `/dashboard-pwa.js?v=${versions.pwa}`,
    `/manifest.json?v=${versions.manifest}`,
  ];

  const withCacheName = content.replace(
    /const CACHE_NAME = ['"][^'"]+['"];/,
    `const CACHE_NAME = '${cacheName}';`,
  );

  return withCacheName.replace(
    /const STATIC_ASSETS = \[[\s\S]*?\];/,
    `const STATIC_ASSETS = [\n${staticAssets.map((asset) => `  '${asset}'`).join(",\n")}\n];`,
  );
}

function writeFile(fileName, content) {
  fs.writeFileSync(path.join(publicDir, fileName), content, "utf8");
}

function main() {
  const html = readFile(sources.html);
  const css = readFile(sources.css);
  const qr = readFile(sources.qr);
  const js = readFile(sources.js);
  const pwa = readFile(sources.pwa);
  const manifest = readFile(sources.manifest);
  const sw = readFile(sources.sw);

  const versions = {
    css: hashOf(css),
    qr: hashOf(qr),
    js: hashOf(js),
    pwa: hashOf(pwa),
    manifest: hashOf(manifest),
    sw: hashOf(sw),
  };
  versions.build = hashOf(
    [versions.css, versions.qr, versions.js, versions.pwa, versions.manifest, versions.sw].join(":"),
  );

  fs.mkdirSync(publicDir, { recursive: true });
  writeFile("dashboard.css", css);
  writeFile("dashboard-qr.js", qr);
  writeFile("dashboard.js", js);
  writeFile("manifest.json", manifest);
  writeFile("dashboard.html", rewriteDashboardHtml(html, versions));
  writeFile("dashboard-pwa.js", rewriteDashboardPwa(pwa, versions));
  writeFile("sw.js", rewriteServiceWorker(sw, versions));
  writeFile("dashboard-build.json", `${JSON.stringify({ versions }, null, 2)}\n`);

  console.log(`Dashboard assets sincronizados en public/ (build=${versions.build})`);
}

main();
