import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const rootDir = process.cwd();
const publicDir = path.join(rootDir, "public");

const sources = {
  html: path.join(rootDir, "dashboard.html"),
  css: path.join(rootDir, "dashboard.css"),
  chart: path.join(rootDir, "node_modules", "chart.js", "dist", "chart.umd.js"),
  jsqr: path.join(rootDir, "node_modules", "jsqr", "dist", "jsQR.js"),
  qr: path.join(rootDir, "dashboard-qr.js"),
  api: path.join(rootDir, "dashboard-api.js"),
  scan: path.join(rootDir, "dashboard-scan.js"),
  modals: path.join(rootDir, "dashboard-modals.js"),
  incidents: path.join(rootDir, "dashboard-incidents.js"),
  assets: path.join(rootDir, "dashboard-assets.js"),
  drivers: path.join(rootDir, "dashboard-drivers.js"),
  audit: path.join(rootDir, "dashboard-audit.js"),
  overview: path.join(rootDir, "dashboard-overview.js"),
  realtime: path.join(rootDir, "dashboard-realtime.js"),
  auth: path.join(rootDir, "dashboard-auth.js"),
  navigation: path.join(rootDir, "dashboard-navigation.js"),
  bootstrap: path.join(rootDir, "dashboard-bootstrap.js"),
  js: path.join(rootDir, "dashboard.js"),
  pwa: path.join(rootDir, "dashboard-pwa.js"),
  manifest: path.join(rootDir, "manifest.json"),
  sw: path.join(rootDir, "sw.js"),
  materialSymbolsFont: path.join(rootDir, "assets", "fonts", "material-symbols-outlined.ttf"),
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
    .replace(/src="\/chart\.umd\.js(?:\?v=[^"]+)?"/g, `src="/chart.umd.js?v=${versions.chart}"`)
    .replace(/src="\/jsqr\.js(?:\?v=[^"]+)?"/g, `src="/jsqr.js?v=${versions.jsqr}"`)
    .replace(/src="\/dashboard-qr\.js(?:\?v=[^"]+)?"/g, `src="/dashboard-qr.js?v=${versions.qr}"`)
    .replace(/src="\/dashboard-api\.js(?:\?v=[^"]+)?"/g, `src="/dashboard-api.js?v=${versions.api}"`)
    .replace(/src="\/dashboard-scan\.js(?:\?v=[^"]+)?"/g, `src="/dashboard-scan.js?v=${versions.scan}"`)
    .replace(/src="\/dashboard-modals\.js(?:\?v=[^"]+)?"/g, `src="/dashboard-modals.js?v=${versions.modals}"`)
    .replace(/src="\/dashboard-incidents\.js(?:\?v=[^"]+)?"/g, `src="/dashboard-incidents.js?v=${versions.incidents}"`)
    .replace(/src="\/dashboard-assets\.js(?:\?v=[^"]+)?"/g, `src="/dashboard-assets.js?v=${versions.assets}"`)
    .replace(/src="\/dashboard-drivers\.js(?:\?v=[^"]+)?"/g, `src="/dashboard-drivers.js?v=${versions.drivers}"`)
    .replace(/src="\/dashboard-audit\.js(?:\?v=[^"]+)?"/g, `src="/dashboard-audit.js?v=${versions.audit}"`)
    .replace(/src="\/dashboard-overview\.js(?:\?v=[^"]+)?"/g, `src="/dashboard-overview.js?v=${versions.overview}"`)
    .replace(/src="\/dashboard-realtime\.js(?:\?v=[^"]+)?"/g, `src="/dashboard-realtime.js?v=${versions.realtime}"`)
    .replace(/src="\/dashboard-auth\.js(?:\?v=[^"]+)?"/g, `src="/dashboard-auth.js?v=${versions.auth}"`)
    .replace(
      /src="\/dashboard-navigation\.js(?:\?v=[^"]+)?"/g,
      `src="/dashboard-navigation.js?v=${versions.navigation}"`,
    )
    .replace(
      /src="\/dashboard-bootstrap\.js(?:\?v=[^"]+)?"/g,
      `src="/dashboard-bootstrap.js?v=${versions.bootstrap}"`,
    )
    .replace(/src="\/dashboard\.js(?:\?v=[^"]+)?"/g, `src="/dashboard.js?v=${versions.js}"`)
    .replace(/src="\/dashboard-pwa\.js(?:\?v=[^"]+)?"/g, `src="/dashboard-pwa.js?v=${versions.pwa}"`);
}

function rewriteDashboardPwa(content, versions) {
  return content.replace(/\/sw\.js(?:\?v=[^'"]+)?/g, `/sw.js?v=${versions.sw}`);
}

function rewriteServiceWorker(content, versions) {
  const cacheName = `driver-manager-${versions.build}`;
  const staticAssets = [
    "/web/dashboard",
    `/dashboard.css?v=${versions.css}`,
    `/chart.umd.js?v=${versions.chart}`,
    `/jsqr.js?v=${versions.jsqr}`,
    `/dashboard-qr.js?v=${versions.qr}`,
    `/dashboard-api.js?v=${versions.api}`,
    `/dashboard-scan.js?v=${versions.scan}`,
    `/dashboard-modals.js?v=${versions.modals}`,
    `/dashboard-incidents.js?v=${versions.incidents}`,
    `/dashboard-assets.js?v=${versions.assets}`,
    `/dashboard-drivers.js?v=${versions.drivers}`,
    `/dashboard-audit.js?v=${versions.audit}`,
    `/dashboard-overview.js?v=${versions.overview}`,
    `/dashboard-realtime.js?v=${versions.realtime}`,
    `/dashboard-auth.js?v=${versions.auth}`,
    `/dashboard-navigation.js?v=${versions.navigation}`,
    `/dashboard-bootstrap.js?v=${versions.bootstrap}`,
    `/dashboard.js?v=${versions.js}`,
    `/dashboard-pwa.js?v=${versions.pwa}`,
    `/manifest.json?v=${versions.manifest}`,
    "/assets/fonts/material-symbols-outlined.ttf",
  ];
  const staticAssetPaths = Array.from(
    new Set(staticAssets.map((asset) => new URL(asset, "https://dashboard.local").pathname)),
  );

  const withCacheName = content.replace(
    /const CACHE_NAME = ['"][^'"]+['"];/,
    `const CACHE_NAME = '${cacheName}';`,
  );

  const withStaticAssets = withCacheName.replace(
    /const STATIC_ASSETS = \[[\s\S]*?\];/,
    `const STATIC_ASSETS = [\n${staticAssets.map((asset) => `  '${asset}'`).join(",\n")}\n];`,
  );

  return withStaticAssets.replace(
    /const STATIC_ASSET_PATHS = new Set\(\[[\s\S]*?\]\);/,
    `const STATIC_ASSET_PATHS = new Set([\n${staticAssetPaths.map((asset) => `  '${asset}'`).join(",\n")}\n]);`,
  );
}

function writeFile(fileName, content) {
  fs.writeFileSync(path.join(publicDir, fileName), content, "utf8");
}

function copyFileToPublic(sourcePath, targetPath) {
  const destination = path.join(publicDir, targetPath);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(sourcePath, destination);
}

function main() {
  const html = readFile(sources.html);
  const css = readFile(sources.css);
  const chart = readFile(sources.chart);
  const jsqr = readFile(sources.jsqr);
  const qr = readFile(sources.qr);
  const api = readFile(sources.api);
  const scan = readFile(sources.scan);
  const modals = readFile(sources.modals);
  const incidents = readFile(sources.incidents);
  const assets = readFile(sources.assets);
  const drivers = readFile(sources.drivers);
  const audit = readFile(sources.audit);
  const overview = readFile(sources.overview);
  const realtime = readFile(sources.realtime);
  const auth = readFile(sources.auth);
  const navigation = readFile(sources.navigation);
  const bootstrap = readFile(sources.bootstrap);
  const js = readFile(sources.js);
  const pwa = readFile(sources.pwa);
  const manifest = readFile(sources.manifest);
  const sw = readFile(sources.sw);
  const materialSymbolsFont = fs.readFileSync(sources.materialSymbolsFont);

  const versions = {
    css: hashOf(css),
    chart: hashOf(chart),
    jsqr: hashOf(jsqr),
    qr: hashOf(qr),
    api: hashOf(api),
    scan: hashOf(scan),
    modals: hashOf(modals),
    incidents: hashOf(incidents),
    assets: hashOf(assets),
    drivers: hashOf(drivers),
    audit: hashOf(audit),
    overview: hashOf(overview),
    realtime: hashOf(realtime),
    auth: hashOf(auth),
    navigation: hashOf(navigation),
    bootstrap: hashOf(bootstrap),
    js: hashOf(js),
    pwa: hashOf(pwa),
    manifest: hashOf(manifest),
    sw: hashOf(sw),
    materialSymbolsFont: hashOf(materialSymbolsFont),
  };
  versions.build = hashOf(
    [
      versions.css,
      versions.chart,
      versions.jsqr,
      versions.qr,
      versions.api,
      versions.scan,
      versions.modals,
      versions.incidents,
      versions.assets,
      versions.drivers,
      versions.audit,
      versions.overview,
      versions.realtime,
      versions.auth,
      versions.navigation,
      versions.bootstrap,
      versions.js,
      versions.pwa,
      versions.manifest,
      versions.sw,
    ].join(":"),
  );

  fs.mkdirSync(publicDir, { recursive: true });
  writeFile("dashboard.css", css);
  writeFile("chart.umd.js", chart);
  writeFile("jsqr.js", jsqr);
  writeFile("dashboard-qr.js", qr);
  writeFile("dashboard-api.js", api);
  writeFile("dashboard-scan.js", scan);
  writeFile("dashboard-modals.js", modals);
  writeFile("dashboard-incidents.js", incidents);
  writeFile("dashboard-assets.js", assets);
  writeFile("dashboard-drivers.js", drivers);
  writeFile("dashboard-audit.js", audit);
  writeFile("dashboard-overview.js", overview);
  writeFile("dashboard-realtime.js", realtime);
  writeFile("dashboard-auth.js", auth);
  writeFile("dashboard-navigation.js", navigation);
  writeFile("dashboard-bootstrap.js", bootstrap);
  writeFile("dashboard.js", js);
  writeFile("manifest.json", manifest);
  writeFile("dashboard.html", rewriteDashboardHtml(html, versions));
  writeFile("dashboard-pwa.js", rewriteDashboardPwa(pwa, versions));
  writeFile("sw.js", rewriteServiceWorker(sw, versions));
  copyFileToPublic(sources.materialSymbolsFont, path.join("assets", "fonts", "material-symbols-outlined.ttf"));
  writeFile("dashboard-build.json", `${JSON.stringify({ versions }, null, 2)}\n`);

  console.log(`Dashboard assets sincronizados en public/ (build=${versions.build})`);
}

main();
