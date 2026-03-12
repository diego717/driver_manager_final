import { readFile } from "node:fs/promises";
import { execSync } from "node:child_process";

const REQUIRED_KV_BINDINGS = ["RATE_LIMIT_KV", "WEB_SESSION_KV"];
const REQUIRED_SECRETS = ["WEB_SESSION_SECRET"];
const DISALLOWED_SECRETS = ["ALLOW_INSECURE_WEB_AUTH_FALLBACK"];

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

function extractKvBindings(wranglerToml) {
  const bindings = new Set();
  const sections = wranglerToml.split(/\[\[kv_namespaces\]\]/g).slice(1);
  for (const section of sections) {
    const bindingMatch = section.match(/^\s*binding\s*=\s*"([^"]+)"/m);
    if (bindingMatch?.[1]) {
      bindings.add(bindingMatch[1].trim());
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
  const kvBindings = extractKvBindings(wranglerToml);
  const failures = [];

  for (const binding of REQUIRED_KV_BINDINGS) {
    if (!kvBindings.has(binding)) {
      failures.push(
        `Falta KV binding requerido en ${config}: ${binding}.`,
      );
    }
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
