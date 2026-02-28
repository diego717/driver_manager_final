import fs from "node:fs";
import path from "node:path";

const projectRoot = process.cwd();
const publicDir = path.join(projectRoot, "public");
const dashboardFiles = [
  "dashboard.html",
  "dashboard.css",
  "dashboard.js",
  "dashboard-pwa.js",
  "sw.js",
  "manifest.json",
];

fs.mkdirSync(publicDir, { recursive: true });

for (const fileName of dashboardFiles) {
  const source = path.join(projectRoot, fileName);
  const target = path.join(publicDir, fileName);
  if (!fs.existsSync(source)) {
    throw new Error(`Missing dashboard source file: ${fileName}`);
  }
  fs.copyFileSync(source, target);
}

console.log(`Synced ${dashboardFiles.length} dashboard assets to public/`);
