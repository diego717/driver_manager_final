import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const REQUIRED_TENANT_COLUMNS = [
  "id",
  "name",
  "slug",
  "status",
  "plan_code",
  "created_at",
  "updated_at",
];

const WRANGLER_RUNNER =
  process.platform === "win32"
    ? { command: "cmd.exe", prefix: ["/d", "/s", "/c", "npx", "wrangler"] }
    : { command: "npx", prefix: ["wrangler"] };

function readArgValue(flag, fallback = null) {
  const index = process.argv.indexOf(flag);
  if (index === -1) return fallback;
  const next = process.argv[index + 1];
  if (!next || next.startsWith("--")) return fallback;
  return next;
}

function hasFlag(flag) {
  return process.argv.includes(flag);
}

function runWranglerJson(args) {
  const output = execFileSync(WRANGLER_RUNNER.command, [...WRANGLER_RUNNER.prefix, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return JSON.parse(output);
}

function runWranglerRaw(args) {
  return execFileSync(WRANGLER_RUNNER.command, [...WRANGLER_RUNNER.prefix, ...args], {
    encoding: "utf8",
    stdio: "inherit",
  });
}

function runWranglerSqlFile(args, sql) {
  const tempFilePath = path.join(
    os.tmpdir(),
    `driver-manager-tenants-normalize-${Date.now()}.sql`,
  );
  fs.writeFileSync(tempFilePath, sql, "utf8");
  try {
    return execFileSync(
      WRANGLER_RUNNER.command,
      [...WRANGLER_RUNNER.prefix, ...args, "--file", tempFilePath],
      {
        encoding: "utf8",
        stdio: "inherit",
      },
    );
  } finally {
    try {
      fs.unlinkSync(tempFilePath);
    } catch {}
  }
}

function normalizeResults(jsonPayload) {
  if (Array.isArray(jsonPayload)) {
    const first = jsonPayload[0];
    if (first && Array.isArray(first.results)) return first.results;
  }
  if (jsonPayload && Array.isArray(jsonPayload.results)) {
    return jsonPayload.results;
  }
  return [];
}

function sqlQuote(value) {
  return `'${String(value ?? "").replace(/'/g, "''")}'`;
}

function buildTenantNormalizationSql(columns, backupTableName) {
  const hasColumn = (name) => columns.has(name);
  const slugExpr = hasColumn("slug")
    ? "COALESCE(NULLIF(TRIM(slug), ''), id)"
    : "id";
  const statusExpr = hasColumn("status")
    ? "CASE WHEN LOWER(COALESCE(status, 'active')) IN ('active', 'suspended') THEN LOWER(COALESCE(status, 'active')) ELSE 'active' END"
    : "'active'";
  const planCodeExpr = hasColumn("plan_code")
    ? "COALESCE(NULLIF(TRIM(plan_code), ''), 'starter')"
    : "'starter'";
  const createdAtExpr = hasColumn("created_at")
    ? "COALESCE(NULLIF(created_at, ''), datetime('now'))"
    : "datetime('now')";
  const updatedAtExpr = hasColumn("updated_at")
    ? "COALESCE(NULLIF(updated_at, ''), datetime('now'))"
    : createdAtExpr;

  return `
PRAGMA foreign_keys = OFF;

DROP TABLE IF EXISTS ${backupTableName};
ALTER TABLE tenants RENAME TO ${backupTableName};

CREATE TABLE tenants (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'suspended')),
  plan_code TEXT NOT NULL DEFAULT 'starter',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO tenants (
  id,
  name,
  slug,
  status,
  plan_code,
  created_at,
  updated_at
)
SELECT
  id,
  name,
  ${slugExpr} AS slug,
  ${statusExpr} AS status,
  ${planCodeExpr} AS plan_code,
  ${createdAtExpr} AS created_at,
  ${updatedAtExpr} AS updated_at
FROM ${backupTableName};

CREATE INDEX IF NOT EXISTS idx_tenants_status
  ON tenants (status);

INSERT OR IGNORE INTO tenants (id, name, slug, plan_code)
VALUES ('default', 'Default Tenant', 'default', 'starter');

PRAGMA foreign_keys = ON;
`.trim();
}

function main() {
  const database = readArgValue("--db", "driver-manager-db");
  const remote = hasFlag("--remote") || !hasFlag("--local");
  const local = hasFlag("--local");
  const envName = readArgValue("--env", null);
  const yes = hasFlag("--yes");

  const baseArgs = ["d1", "execute", database, "--json"];
  if (remote) baseArgs.push("--remote");
  if (local) baseArgs.push("--local");
  if (envName) {
    baseArgs.push("--env", envName);
  }

  const tableInfoPayload = runWranglerJson([
    ...baseArgs,
    "--command",
    "PRAGMA table_info(tenants);",
  ]);
  const tableInfo = normalizeResults(tableInfoPayload);

  if (!tableInfo.length) {
    throw new Error("No se encontro la tabla 'tenants' en D1.");
  }

  const columns = new Set(
    tableInfo
      .map((row) => String(row?.name || "").trim())
      .filter(Boolean),
  );

  const missingColumns = REQUIRED_TENANT_COLUMNS.filter((column) => !columns.has(column));
  if (!missingColumns.length) {
    console.log("[tenants-normalize] La tabla tenants ya tiene el esquema esperado. No hay cambios para aplicar.");
    return;
  }

  const backupTableName = "tenants_legacy_backup_20260329";
  const sql = buildTenantNormalizationSql(columns, backupTableName);

  console.log(`[tenants-normalize] Columnas actuales: ${Array.from(columns).join(", ")}`);
  console.log(`[tenants-normalize] Columnas faltantes: ${missingColumns.join(", ")}`);
  console.log(`[tenants-normalize] Se reconstruira la tabla tenants y se dejara backup en '${backupTableName}'.`);

  if (!yes) {
    console.log("[tenants-normalize] Reejecuta con --yes para aplicar la normalizacion.");
    return;
  }

  runWranglerSqlFile([
    "d1",
    "execute",
    database,
    ...(remote ? ["--remote"] : []),
    ...(local ? ["--local"] : []),
    ...(envName ? ["--env", envName] : []),
  ], sql);

  const verificationPayload = runWranglerJson([
    ...baseArgs,
    "--command",
    "PRAGMA table_info(tenants);",
  ]);
  const verificationColumns = new Set(
    normalizeResults(verificationPayload)
      .map((row) => String(row?.name || "").trim())
      .filter(Boolean),
  );
  const remainingMissing = REQUIRED_TENANT_COLUMNS.filter((column) => !verificationColumns.has(column));
  if (remainingMissing.length) {
    throw new Error(`La normalizacion termino incompleta. Siguen faltando: ${remainingMissing.join(", ")}`);
  }

  const samplePayload = runWranglerJson([
    ...baseArgs,
    "--command",
    `SELECT id, name, slug, status, plan_code FROM tenants ORDER BY id ASC LIMIT 5;`,
  ]);
  const sampleRows = normalizeResults(samplePayload);
  console.log("[tenants-normalize] Esquema normalizado correctamente.");
  console.log(`[tenants-normalize] Ejemplo de filas: ${JSON.stringify(sampleRows, null, 2)}`);
  console.log(`[tenants-normalize] Backup disponible en ${sqlQuote(backupTableName)}.`);
}

main();
