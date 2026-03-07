import fs from "node:fs";
import path from "node:path";

const rootDir = process.cwd();
const srcDir = path.join(rootDir, "dashboard-src");
const outputPath = path.join(rootDir, "dashboard.js");

const sourceFiles = [
  "01-core.js",
  "02-api.js",
  "03-auth.js",
  "04-sections.js",
  "05-realtime.js",
  "06-init-theme-modules.js",
];

function readRequiredFile(fileName) {
  const fullPath = path.join(srcDir, fileName);
  if (!fs.existsSync(fullPath)) {
    throw new Error(`Missing dashboard source chunk: ${fullPath}`);
  }
  return fs.readFileSync(fullPath, "utf8").replace(/\r\n/g, "\n").trimEnd();
}

function buildBundle() {
  const chunks = sourceFiles.map((fileName) => readRequiredFile(fileName));
  return `${chunks.join("\n\n")}\n`;
}

function main() {
  if (!fs.existsSync(srcDir)) {
    throw new Error(`Missing source directory: ${srcDir}`);
  }
  const output = buildBundle();
  fs.writeFileSync(outputPath, output, "utf8");
  console.log(`dashboard.js generated from ${sourceFiles.length} chunks.`);
}

main();
