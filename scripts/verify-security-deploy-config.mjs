import { readFile } from "node:fs/promises";
import { execSync } from "node:child_process";

const REQUIRED_KV_BINDINGS = ["RATE_LIMIT_KV", "WEB_SESSION_KV"];
const REQUIRED_SECRETS = ["WEB_SESSION_SECRET"];
const DISALLOWED_SECRETS = ["ALLOW_INSECURE_WEB_AUTH_FALLBACK"];
const LEGACY_HMAC_SECRETS = ["API_TOKEN", "API_SECRET", "DRIVER_MANAGER_API_TOKEN", "DRIVER_MANAGER_API_SECRET"];
const LEGACY_TENANT_BINDING_SECRETS = ["DRIVER_MANAGER_API_TENANT_ID", "API_TENANT_ID"];

function parseArgs(argv) {
  const parsed = {
    env: "",
    config: "wrangler.toml",
  };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--env" && argv[i + 1]) {
      parsed.env = String(argv[i + 1]).trim();
      i += 1;
      continue;
    }
    if (token === "--config" && argv[i + 1]) {
      parsed.config = String(argv[i + 1]).trim();
      i += 1;
    }
  }
  return parsed;
}

function extractKvNamespaces(wranglerToml) {
  const bindings = new Map();
  const sections = wranglerToml.split(/\[\[kv_namespaces\]\]/g).slice(1);
  for (const section of sections) {
    const bindingMatch = section.match(/^\s*binding\s*=\s*"([^"]+)"/m);
    const idMatch = section.match(/^\s*id\s*=\s*"([^"]+)"/m);
    const previewIdMatch = section.match(/^\s*preview_id\s*=\s*"([^"]+)"/m);
    if (bindingMatch?.[1]) {
      const bindingName = bindingMatch[1].trim();
      bindings.set(bindingName, {
        id: idMatch?.[1]?.trim() || "",
        preview_id: previewIdMatch?.[1]?.trim() || "",
      });
    }
  }
  return bindings;
}

function runWranglerSecretList(env) {
  if (env && !/^[A-Za-z0-9_-]+$/.test(env)) {
    throw new Error("Nombre de env invalido.");
  }
  const command = `npx wrangler secret list --format json${env ? ` --env ${env}` : ""}`;
  let output = "";
  try {
    output = String(
      execSync(command, {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      }) || "",
    ).trim();
  } catch (error) {
    const stderr = String(error?.stderr || "").trim();
    const stdout = String(error?.stdout || "").trim();
    const reason = stderr || stdout || error?.message || "wrangler secret list failed";
    throw new Error(reason);
  }
  if (!output) {
    return [];
  }
  let parsed;
  try {
    parsed = JSON.parse(output);
  } catch {
    throw new Error("No se pudo parsear JSON de `wrangler secret list`.");
  }
  if (!Array.isArray(parsed)) {
    throw new Error("Formato inesperado de `wrangler secret list`.");
  }
  return parsed
    .map((entry) => String(entry?.name || "").trim())
    .filter(Boolean);
}

function printFailuresAndExit(failures) {
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

async function main() {
  if (String(process.env.SKIP_SECURITY_DEPLOY_CHECK || "").toLowerCase() === "true") {
    console.warn("[security-check] SKIP_SECURITY_DEPLOY_CHECK=true, verificacion omitida.");
    return;
  }

  const { env, config } = parseArgs(process.argv.slice(2));
  const wranglerToml = await readFile(config, "utf8");
  const kvNamespaces = extractKvNamespaces(wranglerToml);
  const failures = [];

  for (const binding of REQUIRED_KV_BINDINGS) {
    if (!kvNamespaces.has(binding)) {
      failures.push(
        `Falta KV binding requerido en ${config}: ${binding}.`,
      );
    }
  }

  for (const binding of REQUIRED_KV_BINDINGS) {
    const entry = kvNamespaces.get(binding);
    if (!entry) continue;
    if (!entry.id || /^REPLACE_WITH_/i.test(entry.id)) {
      failures.push(`KV binding ${binding} tiene id ausente o placeholder en ${config}.`);
    }
    if (!entry.preview_id || /^REPLACE_WITH_/i.test(entry.preview_id)) {
      failures.push(`KV binding ${binding} tiene preview_id ausente o placeholder en ${config}.`);
    }
  }

  const rateLimitNamespace = kvNamespaces.get("RATE_LIMIT_KV");
  const webSessionNamespace = kvNamespaces.get("WEB_SESSION_KV");
  if (
    rateLimitNamespace &&
    webSessionNamespace &&
    rateLimitNamespace.id &&
    webSessionNamespace.id &&
    rateLimitNamespace.id === webSessionNamespace.id
  ) {
    failures.push(
      "RATE_LIMIT_KV y WEB_SESSION_KV no pueden compartir el mismo namespace id.",
    );
  }
  if (
    rateLimitNamespace &&
    webSessionNamespace &&
    rateLimitNamespace.preview_id &&
    webSessionNamespace.preview_id &&
    rateLimitNamespace.preview_id === webSessionNamespace.preview_id
  ) {
    failures.push(
      "RATE_LIMIT_KV y WEB_SESSION_KV no pueden compartir el mismo preview_id.",
    );
  }

  let secretNames = [];
  let secretsLoaded = false;
  try {
    secretNames = runWranglerSecretList(env);
    secretsLoaded = true;
  } catch (error) {
    failures.push(
      `No se pudieron verificar secrets remotos (${env ? `env=${env}` : "env=default"}): ${error.message}`,
    );
  }

  if (secretsLoaded) {
    const secretNameSet = new Set(secretNames);
    for (const requiredSecret of REQUIRED_SECRETS) {
      if (!secretNameSet.has(requiredSecret)) {
        failures.push(
          `Falta secret requerido (${requiredSecret}) en Worker remoto (${env ? `env=${env}` : "default"}).`,
        );
      }
    }

    for (const disallowedSecret of DISALLOWED_SECRETS) {
      if (secretNameSet.has(disallowedSecret)) {
        failures.push(
          `Secret inseguro detectado en remoto: ${disallowedSecret}. Eliminalo antes de deploy a produccion.`,
        );
      }
    }

    const hasLegacyHmacSecret = LEGACY_HMAC_SECRETS.some((secretName) => secretNameSet.has(secretName));
    const hasLegacyTenantBinding = LEGACY_TENANT_BINDING_SECRETS.some((secretName) => secretNameSet.has(secretName));
    if (hasLegacyHmacSecret && !hasLegacyTenantBinding) {
      failures.push(
        `Credenciales legacy HMAC detectadas sin tenant fijado. Define uno de: ${LEGACY_TENANT_BINDING_SECRETS.join(", ")}.`,
      );
    }
  }

  if (failures.length > 0) {
    console.error("[security-check] Verificacion de seguridad de deploy fallida.");
    printFailuresAndExit(failures);
  }

  console.log(
    `[security-check] OK (${env ? `env=${env}` : "env=default"}): bindings y secrets de seguridad verificados.`,
  );
}

await main();
