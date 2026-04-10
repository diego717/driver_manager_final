import net from "node:net";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { DEFAULT_E2E_BASE_URL, seedE2eScenario } from "./siteops-e2e.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const mobileRoot = path.join(repoRoot, "mobile-app");
const androidRoot = path.join(mobileRoot, "android");

const WORKER_BASE_URL = DEFAULT_E2E_BASE_URL;
const LOCAL_ANDROID_API_BASE_URL = "http://127.0.0.1:8787";
const WORKER_PORT = 8787;
const METRO_PORT = 8081;
const FLOW_PATHS = {
  work: ".maestro/smoke-login-work.yaml",
  map: ".maestro/smoke-map.yaml",
  all: ".maestro",
};

function log(message) {
  console.log(`[e2e:android] ${message}`);
}

function readCliArg(flagName, fallback = "") {
  const index = process.argv.findIndex((arg) => arg === flagName);
  if (index === -1) return fallback;
  return String(process.argv[index + 1] || fallback).trim();
}

function hasFlag(flagName) {
  return process.argv.includes(flagName);
}

function resolveFlowSelection() {
  const requested = (readCliArg("--flow", "all") || "all").toLowerCase();
  if (!Object.prototype.hasOwnProperty.call(FLOW_PATHS, requested)) {
    throw new Error(`invalid flow '${requested}'. Use all, work or map.`);
  }
  return requested;
}

function isWindows() {
  return process.platform === "win32";
}

function spawnLogged(command, args, options = {}) {
  const child = spawn(command, args, {
    cwd: options.cwd || repoRoot,
    env: {
      ...process.env,
      ...(options.env || {}),
    },
    shell: false,
    stdio: options.stdio || "pipe",
  });

  if (options.prefix && child.stdout) {
    child.stdout.on("data", (chunk) => {
      process.stdout.write(`[${options.prefix}] ${chunk}`);
    });
  }
  if (options.prefix && child.stderr) {
    child.stderr.on("data", (chunk) => {
      process.stderr.write(`[${options.prefix}] ${chunk}`);
    });
  }

  return child;
}

function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawnLogged(command, args, options);
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${command} ${args.join(" ")} failed with exit code ${code}`));
    });
  });
}

function commandExists(command, versionArgs = ["--version"]) {
  const probe = spawnSync(command, versionArgs, {
    cwd: repoRoot,
    env: process.env,
    shell: isWindows(),
    encoding: "utf8",
  });
  return probe.status === 0;
}

async function wait(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForPort(port, host = "127.0.0.1", timeoutMs = 120_000) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const connected = await new Promise((resolve) => {
      const socket = net.connect({ port, host });
      socket.once("connect", () => {
        socket.destroy();
        resolve(true);
      });
      socket.once("error", () => {
        socket.destroy();
        resolve(false);
      });
    });

    if (connected) return;
    await wait(1_000);
  }

  throw new Error(`timed out waiting for ${host}:${port}`);
}

async function waitForWorker(timeoutMs = 120_000) {
  const startedAt = Date.now();
  let lastError = null;
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(`${WORKER_BASE_URL}/health`);
      if (response.ok) return;
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await wait(1_000);
  }
  throw new Error(
    `timed out waiting for worker at ${WORKER_BASE_URL}: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
  );
}

function parseAdbDevicesOutput(output) {
  return String(output || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("List of devices"))
    .map((line) => line.split(/\s+/))
    .filter((parts) => parts.length >= 2)
    .map(([serial, state]) => ({ serial, state }));
}

function ensureAdbAndMaestro() {
  if (!commandExists("adb", ["version"])) {
    throw new Error("adb is not available in PATH. Install Android platform-tools first.");
  }
  if (!commandExists("maestro", ["--version"])) {
    throw new Error("maestro is not available in PATH. Install Maestro CLI first.");
  }
}

function ensureConnectedAndroidDevice() {
  const result = spawnSync("adb", ["devices"], {
    cwd: repoRoot,
    env: process.env,
    shell: isWindows(),
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(`adb devices failed: ${result.stderr || result.stdout}`);
  }

  const devices = parseAdbDevicesOutput(result.stdout);
  const ready = devices.filter((device) => device.state === "device");
  if (!ready.length) {
    throw new Error(
      "no Android emulator/device detected. Start an emulator or connect a device before running the Android smoke suite.",
    );
  }
  log(`device ready: ${ready.map((device) => device.serial).join(", ")}`);
}

async function setupAdbReverse() {
  await runCommand("adb", ["reverse", `tcp:${WORKER_PORT}`, `tcp:${WORKER_PORT}`], {
    cwd: repoRoot,
    prefix: "adb",
  });
  await runCommand("adb", ["reverse", `tcp:${METRO_PORT}`, `tcp:${METRO_PORT}`], {
    cwd: repoRoot,
    prefix: "adb",
  });
}

async function installDebugApp() {
  const gradleCommand = isWindows() ? "gradlew.bat" : "./gradlew";
  await runCommand(gradleCommand, ["installDebug"], {
    cwd: androidRoot,
    env: {
      EXPO_PUBLIC_API_BASE_URL: LOCAL_ANDROID_API_BASE_URL,
      EXPO_PUBLIC_ALLOW_HTTP_API_BASE_URL: "true",
      CI: "1",
    },
    prefix: "gradle",
  });
}

function startWorkerProcess() {
  const npmCommand = isWindows() ? "npm.cmd" : "npm";
  return spawnLogged(npmCommand, ["run", "dev:e2e"], {
    cwd: repoRoot,
    env: {
      CI: "1",
    },
    prefix: "worker",
  });
}

function startMetroProcess() {
  const expoCommand = isWindows() ? "npx.cmd" : "npx";
  return spawnLogged(
    expoCommand,
    ["expo", "start", "--dev-client", "--localhost", "--port", String(METRO_PORT), "--clear"],
    {
      cwd: mobileRoot,
      env: {
        EXPO_PUBLIC_API_BASE_URL: LOCAL_ANDROID_API_BASE_URL,
        EXPO_PUBLIC_ALLOW_HTTP_API_BASE_URL: "true",
        CI: "1",
      },
      prefix: "metro",
    },
  );
}

async function runMaestroFlow(flowSelection) {
  const flowPath = FLOW_PATHS[flowSelection];
  await runCommand("maestro", ["test", flowPath], {
    cwd: mobileRoot,
    env: {
      SITEOPS_LOCAL_API_BASE_URL: LOCAL_ANDROID_API_BASE_URL,
      E2E_TECHNICIAN_USERNAME: "e2e-tech",
      E2E_TECHNICIAN_PASSWORD: "E2ETech#2026",
    },
    prefix: "maestro",
  });
}

function killProcess(child, label) {
  if (!child || child.killed) return;
  try {
    if (isWindows()) {
      spawnSync("taskkill", ["/pid", String(child.pid), "/t", "/f"], {
        cwd: repoRoot,
        env: process.env,
        shell: true,
        stdio: "ignore",
      });
      return;
    }
    child.kill("SIGTERM");
  } catch {
    log(`could not stop ${label} cleanly`);
  }
}

async function main() {
  const flowSelection = resolveFlowSelection();
  const skipInstall = hasFlag("--skip-install");

  ensureAdbAndMaestro();
  ensureConnectedAndroidDevice();

  let workerProcess = null;
  let metroProcess = null;
  try {
    log("starting isolated worker");
    workerProcess = startWorkerProcess();
    await waitForWorker();

    log("seeding deterministic E2E scenario");
    await seedE2eScenario({ baseUrl: WORKER_BASE_URL, logger: console });

    log("starting Metro for the debug app");
    metroProcess = startMetroProcess();
    await waitForPort(METRO_PORT);

    log("configuring adb reverse for API and Metro");
    await setupAdbReverse();

    if (!skipInstall) {
      log("installing debug Android app");
      await installDebugApp();
    } else {
      log("skipping app install as requested");
    }

    log(`running Maestro flow: ${flowSelection}`);
    await runMaestroFlow(flowSelection);
    log("Android smoke suite completed");
  } finally {
    killProcess(metroProcess, "Metro");
    killProcess(workerProcess, "worker");
  }
}

main().catch((error) => {
  console.error(`[e2e:android] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
