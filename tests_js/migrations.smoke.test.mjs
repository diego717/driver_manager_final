import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const migrationsDir = path.join(process.cwd(), "migrations");

function listMigrationFiles() {
  return fs
    .readdirSync(migrationsDir)
    .filter((file) => file.endsWith(".sql"))
    .sort();
}

function readMigration(fileName) {
  return fs.readFileSync(path.join(migrationsDir, fileName), "utf8");
}

test("Migrations follow sequential numeric naming without gaps", () => {
  const files = listMigrationFiles();
  assert.ok(files.length > 0);

  files.forEach((file) => {
    assert.match(file, /^\d{4}_[a-z0-9_]+\.sql$/i);
  });

  const numbers = files.map((file) => Number.parseInt(file.slice(0, 4), 10));
  assert.equal(numbers[0], 1);

  for (let i = 1; i < numbers.length; i += 1) {
    assert.equal(numbers[i], numbers[i - 1] + 1, `Expected sequence gapless at ${files[i]}`);
  }
});

test("Migrations define core tables and key auth/audit changes", () => {
  const base = readMigration("0001_installations_base.sql");
  const incidents = readMigration("0002_incidents_v1.sql");
  const webUsers = readMigration("0003_web_users_auth.sql");
  const hashType = readMigration("0004_web_users_hash_types.sql");
  const audit = readMigration("0005_audit_logs.sql");
  const devices = readMigration("0006_device_tokens.sql");
  const multiTenant = readMigration("0007_multi_tenant_foundation.sql");

  assert.match(base, /CREATE TABLE IF NOT EXISTS installations/i);
  assert.match(incidents, /CREATE TABLE IF NOT EXISTS incidents/i);
  assert.match(incidents, /CREATE TABLE IF NOT EXISTS incident_photos/i);
  assert.match(webUsers, /CREATE TABLE IF NOT EXISTS web_users/i);
  assert.match(hashType, /ALTER TABLE web_users\s+ADD COLUMN password_hash_type/i);
  assert.match(audit, /CREATE TABLE IF NOT EXISTS audit_logs/i);
  assert.match(devices, /CREATE TABLE IF NOT EXISTS device_tokens/i);
  assert.match(multiTenant, /CREATE TABLE IF NOT EXISTS tenants/i);
  assert.match(multiTenant, /CREATE TABLE IF NOT EXISTS tenant_user_roles/i);
  assert.match(multiTenant, /CREATE TABLE IF NOT EXISTS tenant_audit_events/i);
  assert.match(multiTenant, /CREATE TABLE IF NOT EXISTS tenant_usage_snapshots/i);
});

test("Multi-tenant migration adds tenant_id columns to legacy tables", () => {
  const multiTenant = readMigration("0007_multi_tenant_foundation.sql");
  const normalized = multiTenant.replace(/\s+/g, " ").trim();

  const requiredAlterStatements = [
    "ALTER TABLE installations ADD COLUMN tenant_id",
    "ALTER TABLE incidents ADD COLUMN tenant_id",
    "ALTER TABLE incident_photos ADD COLUMN tenant_id",
    "ALTER TABLE web_users ADD COLUMN tenant_id",
    "ALTER TABLE audit_logs ADD COLUMN tenant_id",
    "ALTER TABLE device_tokens ADD COLUMN tenant_id",
  ];

  requiredAlterStatements.forEach((statement) => {
    assert.match(normalized, new RegExp(statement, "i"));
  });
});
