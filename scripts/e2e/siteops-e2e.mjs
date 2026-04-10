import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const localDevVarsPath = path.join(repoRoot, ".dev.vars");
const seedStatePath = path.join(repoRoot, "reports", "e2e", "seed-state.json");

export const DEFAULT_E2E_BASE_URL = "http://127.0.0.1:8787";

export const E2E_SCENARIO = {
  tenantId: "default",
  platformOwner: {
    username: "e2e-root",
    password: "E2ERoot#2026",
    role: "platform_owner",
  },
  admin: {
    username: "e2e-admin",
    password: "E2EAdmin#2026",
    role: "admin",
  },
  supervisor: {
    username: "e2e-supervisor",
    password: "E2ESupervisor#2026",
    role: "supervisor",
  },
  technicianUser: {
    username: "e2e-tech",
    password: "E2ETech#2026",
    role: "tecnico",
  },
  reader: {
    username: "e2e-reader",
    password: "E2EReader#2026",
    role: "solo_lectura",
  },
  technician: {
    display_name: "Tecnico E2E Campo",
    employee_code: "E2E-TECH-01",
    email: "e2e.tech@siteops.local",
    phone: "+59800000001",
    notes: "Tecnico estable para smoke E2E web/mobile.",
  },
  installation: {
    timestamp: "2026-04-08T12:00:00.000Z",
    driver_brand: "SiteOps QA",
    driver_version: "2026.04-e2e",
    status: "pending",
    client_name: "Cliente E2E Smoke",
    driver_description: "Registro aislado para QA automatizado",
    installation_time_seconds: 120,
    os_info: "Android / Web smoke",
    notes: "No borrar: fixture E2E aislado.",
  },
  incident: {
    note: "E2E smoke incident assigned to technician queue.",
    severity: "high",
    time_adjustment_seconds: 0,
    estimated_duration_seconds: 900,
    apply_to_installation: false,
    dispatch_required: true,
    target_lat: -34.9053,
    target_lng: -56.1911,
    target_label: "Cliente E2E Smoke",
    target_source: "manual_map",
    dispatch_place_name: "Cliente E2E Smoke",
    dispatch_address: "Av. 18 de Julio 1234, Montevideo",
    dispatch_reference: "Fixture de QA automatizado",
    dispatch_contact_name: "Mesa E2E",
    dispatch_contact_phone: "+59800000002",
  },
};

function normalizeBaseUrl(baseUrl = DEFAULT_E2E_BASE_URL) {
  return String(baseUrl || DEFAULT_E2E_BASE_URL).trim().replace(/\/+$/, "");
}

async function wait(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForServer(baseUrl, { timeoutMs = 120_000 } = {}) {
  const startedAt = Date.now();
  let lastError = null;
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) return;
      lastError = new Error(`health returned HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await wait(1_000);
  }
  throw new Error(
    `[e2e] local worker not ready at ${baseUrl}: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
  );
}

async function readLocalDevVars() {
  try {
    const raw = await fs.readFile(localDevVarsPath, "utf8");
    const result = {};
    raw.split(/\r?\n/).forEach((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) return;
      const separatorIndex = trimmed.indexOf("=");
      if (separatorIndex <= 0) return;
      const key = trimmed.slice(0, separatorIndex).trim();
      const rawValue = trimmed.slice(separatorIndex + 1).trim();
      const isQuoted =
        (rawValue.startsWith('"') && rawValue.endsWith('"'))
        || (rawValue.startsWith("'") && rawValue.endsWith("'"));
      const value = isQuoted
        ? rawValue.slice(1, -1)
        : rawValue.split(/\s+#/, 1)[0].split("#", 1)[0].trim();
      if (!key) return;
      result[key] = value;
    });
    return result;
  } catch {
    return {};
  }
}

async function resolveBootstrapPassword() {
  if (process.env.SITEOPS_E2E_BOOTSTRAP_PASSWORD) {
    return String(process.env.SITEOPS_E2E_BOOTSTRAP_PASSWORD).trim();
  }
  if (process.env.WEB_LOGIN_PASSWORD) {
    return String(process.env.WEB_LOGIN_PASSWORD).trim();
  }
  const localVars = await readLocalDevVars();
  return String(localVars.WEB_LOGIN_PASSWORD || "").trim();
}

async function requestJson(baseUrl, pathname, options = {}) {
  const method = options.method || "GET";
  const headers = {
    Accept: "application/json",
    ...(options.body !== undefined ? { "Content-Type": "application/json" } : {}),
    ...(options.headers || {}),
  };
  const response = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const text = await response.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  return { response, data };
}

function buildAuthHeaders(accessToken) {
  return {
    Authorization: `Bearer ${accessToken}`,
  };
}

function unwrapApiError(data, response) {
  if (typeof data === "string" && data.trim()) return data.trim();
  if (typeof data?.error?.message === "string" && data.error.message.trim()) {
    return data.error.message.trim();
  }
  return `HTTP ${response.status}`;
}

async function bootstrapPlatformOwner(baseUrl, logger) {
  const bootstrapPassword = await resolveBootstrapPassword();
  if (!bootstrapPassword) {
    throw new Error(
      "[e2e] missing WEB_LOGIN_PASSWORD or SITEOPS_E2E_BOOTSTRAP_PASSWORD to bootstrap the isolated worker.",
    );
  }

  const { response, data } = await requestJson(baseUrl, "/web/auth/bootstrap", {
    method: "POST",
    body: {
      username: E2E_SCENARIO.platformOwner.username,
      password: E2E_SCENARIO.platformOwner.password,
      role: E2E_SCENARIO.platformOwner.role,
      tenant_id: E2E_SCENARIO.tenantId,
      bootstrap_password: bootstrapPassword,
    },
  });

  if (response.status === 201) {
    logger.log?.(`[e2e] bootstrapped ${E2E_SCENARIO.platformOwner.username}`);
    return;
  }
  if (response.status === 409) {
    logger.log?.("[e2e] bootstrap already applied in isolated state");
    return;
  }
  throw new Error(`[e2e] bootstrap failed: ${unwrapApiError(data, response)}`);
}

async function login(baseUrl, credentials) {
  const { response, data } = await requestJson(baseUrl, "/web/auth/login", {
    method: "POST",
    body: {
      username: credentials.username,
      password: credentials.password,
    },
  });
  if (!response.ok || !data?.access_token) {
    throw new Error(`[e2e] login failed for ${credentials.username}: ${unwrapApiError(data, response)}`);
  }
  return data;
}

async function listUsers(baseUrl, accessToken) {
  const { response, data } = await requestJson(baseUrl, "/web/auth/users?limit=200", {
    headers: buildAuthHeaders(accessToken),
  });
  if (!response.ok) {
    throw new Error(`[e2e] list users failed: ${unwrapApiError(data, response)}`);
  }
  return Array.isArray(data?.users) ? data.users : [];
}

async function ensureUser(baseUrl, accessToken, userSpec, logger) {
  const existingUsers = await listUsers(baseUrl, accessToken);
  const existing = existingUsers.find((user) => String(user?.username || "").trim().toLowerCase() === userSpec.username);
  if (existing) return existing;

  const { response, data } = await requestJson(baseUrl, "/web/auth/users", {
    method: "POST",
    headers: buildAuthHeaders(accessToken),
    body: {
      username: userSpec.username,
      password: userSpec.password,
      role: userSpec.role,
      tenant_id: E2E_SCENARIO.tenantId,
    },
  });
  if (!response.ok) {
    throw new Error(`[e2e] create user ${userSpec.username} failed: ${unwrapApiError(data, response)}`);
  }
  logger.log?.(`[e2e] ensured user ${userSpec.username} (${userSpec.role})`);
  return data?.user || null;
}

async function listTechnicians(baseUrl, accessToken) {
  const { response, data } = await requestJson(baseUrl, "/web/technicians?include_inactive=1", {
    headers: buildAuthHeaders(accessToken),
  });
  if (!response.ok) {
    throw new Error(`[e2e] list technicians failed: ${unwrapApiError(data, response)}`);
  }
  return Array.isArray(data?.technicians) ? data.technicians : [];
}

async function ensureTechnician(baseUrl, accessToken, linkedUserId, logger) {
  const existingTechnicians = await listTechnicians(baseUrl, accessToken);
  const existing = existingTechnicians.find(
    (technician) =>
      String(technician?.employee_code || "").trim().toLowerCase() === E2E_SCENARIO.technician.employee_code.toLowerCase(),
  );
  if (existing) {
    if (Number(existing.web_user_id || 0) !== Number(linkedUserId)) {
      const { response, data } = await requestJson(baseUrl, `/web/technicians/${existing.id}`, {
        method: "PATCH",
        headers: buildAuthHeaders(accessToken),
        body: {
          web_user_id: linkedUserId,
        },
      });
      if (!response.ok) {
        throw new Error(`[e2e] relink technician failed: ${unwrapApiError(data, response)}`);
      }
      return data?.technician || existing;
    }
    return existing;
  }

  const { response, data } = await requestJson(baseUrl, "/web/technicians", {
    method: "POST",
    headers: buildAuthHeaders(accessToken),
    body: {
      ...E2E_SCENARIO.technician,
      web_user_id: linkedUserId,
    },
  });
  if (!response.ok) {
    throw new Error(`[e2e] create technician failed: ${unwrapApiError(data, response)}`);
  }
  logger.log?.(`[e2e] ensured technician ${E2E_SCENARIO.technician.display_name}`);
  return data?.technician || null;
}

async function listInstallations(baseUrl, accessToken) {
  const query = new URLSearchParams({
    client_name: E2E_SCENARIO.installation.client_name,
  });
  const { response, data } = await requestJson(baseUrl, `/web/installations?${query.toString()}`, {
    headers: buildAuthHeaders(accessToken),
  });
  if (!response.ok) {
    throw new Error(`[e2e] list installations failed: ${unwrapApiError(data, response)}`);
  }
  return Array.isArray(data) ? data : [];
}

async function ensureInstallation(baseUrl, accessToken, logger) {
  const existingInstallations = await listInstallations(baseUrl, accessToken);
  if (existingInstallations.length > 0) {
    return [...existingInstallations].sort((left, right) => Number(right.id || 0) - Number(left.id || 0))[0];
  }

  const { response, data } = await requestJson(baseUrl, "/web/installations", {
    method: "POST",
    headers: buildAuthHeaders(accessToken),
    body: E2E_SCENARIO.installation,
  });
  if (!response.ok) {
    throw new Error(`[e2e] create installation failed: ${unwrapApiError(data, response)}`);
  }
  logger.log?.("[e2e] ensured installation fixture");
  const created = await listInstallations(baseUrl, accessToken);
  if (!created.length) {
    throw new Error("[e2e] installation was created but could not be reloaded");
  }
  return created[0];
}

async function listInstallationIncidents(baseUrl, accessToken, installationId) {
  const { response, data } = await requestJson(
    baseUrl,
    `/web/installations/${installationId}/incidents`,
    {
      headers: buildAuthHeaders(accessToken),
    },
  );
  if (!response.ok) {
    throw new Error(`[e2e] list incidents failed: ${unwrapApiError(data, response)}`);
  }
  return Array.isArray(data?.incidents) ? data.incidents : [];
}

async function ensureIncident(baseUrl, accessToken, installationId, logger) {
  const existingIncidents = await listInstallationIncidents(baseUrl, accessToken, installationId);
  const existing = existingIncidents.find(
    (incident) => String(incident?.note || "").trim() === E2E_SCENARIO.incident.note,
  );
  if (existing) return existing;

  const { response, data } = await requestJson(
    baseUrl,
    `/web/installations/${installationId}/incidents`,
    {
      method: "POST",
      headers: buildAuthHeaders(accessToken),
      body: {
        note: E2E_SCENARIO.incident.note,
        severity: E2E_SCENARIO.incident.severity,
        time_adjustment_seconds: E2E_SCENARIO.incident.time_adjustment_seconds,
        estimated_duration_seconds: E2E_SCENARIO.incident.estimated_duration_seconds,
        apply_to_installation: E2E_SCENARIO.incident.apply_to_installation,
      },
    },
  );
  if (!response.ok) {
    throw new Error(`[e2e] create incident failed: ${unwrapApiError(data, response)}`);
  }
  logger.log?.("[e2e] ensured incident fixture");
  const created = await listInstallationIncidents(baseUrl, accessToken, installationId);
  const createdIncident = created.find(
    (incident) => String(incident?.note || "").trim() === E2E_SCENARIO.incident.note,
  );
  if (!createdIncident) {
    throw new Error("[e2e] incident was created but could not be reloaded");
  }
  return createdIncident;
}

async function ensureDispatchTarget(baseUrl, accessToken, incidentId, logger) {
  const { response, data } = await requestJson(
    baseUrl,
    `/web/incidents/${incidentId}/dispatch-target`,
    {
      method: "PATCH",
      headers: buildAuthHeaders(accessToken),
      body: {
        target_lat: E2E_SCENARIO.incident.target_lat,
        target_lng: E2E_SCENARIO.incident.target_lng,
        target_label: E2E_SCENARIO.incident.target_label,
        target_source: E2E_SCENARIO.incident.target_source,
        dispatch_required: E2E_SCENARIO.incident.dispatch_required,
        dispatch_place_name: E2E_SCENARIO.incident.dispatch_place_name,
        dispatch_address: E2E_SCENARIO.incident.dispatch_address,
        dispatch_reference: E2E_SCENARIO.incident.dispatch_reference,
        dispatch_contact_name: E2E_SCENARIO.incident.dispatch_contact_name,
        dispatch_contact_phone: E2E_SCENARIO.incident.dispatch_contact_phone,
      },
    },
  );
  if (!response.ok) {
    throw new Error(`[e2e] set dispatch target failed: ${unwrapApiError(data, response)}`);
  }
  logger.log?.("[e2e] ensured incident dispatch target");
  return data?.incident || null;
}

async function ensureIncidentAssignment(baseUrl, accessToken, technicianId, incidentId, logger) {
  const { response: listResponse, data: listData } = await requestJson(
    baseUrl,
    `/web/technician-assignments?entity_type=incident&entity_id=${incidentId}`,
    {
      headers: buildAuthHeaders(accessToken),
    },
  );
  if (!listResponse.ok) {
    throw new Error(`[e2e] list assignments failed: ${unwrapApiError(listData, listResponse)}`);
  }
  const assignments = Array.isArray(listData?.assignments) ? listData.assignments : [];
  const existing = assignments.find(
    (assignment) =>
      Number(assignment?.technician_id || 0) === Number(technicianId) &&
      String(assignment?.assignment_role || "").trim().toLowerCase() === "owner" &&
      !assignment?.unassigned_at,
  );
  if (existing) return existing;

  const { response, data } = await requestJson(
    baseUrl,
    `/web/technicians/${technicianId}/assignments`,
    {
      method: "POST",
      headers: buildAuthHeaders(accessToken),
      body: {
        entity_type: "incident",
        entity_id: incidentId,
        assignment_role: "owner",
        metadata_json: {
          source: "e2e-seed",
        },
      },
    },
  );
  if (!response.ok) {
    throw new Error(`[e2e] create assignment failed: ${unwrapApiError(data, response)}`);
  }
  logger.log?.("[e2e] ensured technician assignment");
  return data?.assignment || null;
}

async function persistSeedState(state) {
  await fs.mkdir(path.dirname(seedStatePath), { recursive: true });
  await fs.writeFile(seedStatePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

export async function seedE2eScenario({
  baseUrl = DEFAULT_E2E_BASE_URL,
  logger = console,
} = {}) {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
  await waitForServer(normalizedBaseUrl);
  await bootstrapPlatformOwner(normalizedBaseUrl, logger);

  const platformSession = await login(normalizedBaseUrl, E2E_SCENARIO.platformOwner);
  const platformAccessToken = platformSession.access_token;

  const admin = await ensureUser(normalizedBaseUrl, platformAccessToken, E2E_SCENARIO.admin, logger);
  const supervisor = await ensureUser(normalizedBaseUrl, platformAccessToken, E2E_SCENARIO.supervisor, logger);
  const technicianUser = await ensureUser(normalizedBaseUrl, platformAccessToken, E2E_SCENARIO.technicianUser, logger);
  const reader = await ensureUser(normalizedBaseUrl, platformAccessToken, E2E_SCENARIO.reader, logger);
  const technician = await ensureTechnician(
    normalizedBaseUrl,
    platformAccessToken,
    Number(technicianUser?.id),
    logger,
  );
  const installation = await ensureInstallation(normalizedBaseUrl, platformAccessToken, logger);
  const incident = await ensureIncident(
    normalizedBaseUrl,
    platformAccessToken,
    Number(installation?.id),
    logger,
  );
  await ensureDispatchTarget(normalizedBaseUrl, platformAccessToken, Number(incident?.id), logger);
  const assignment = await ensureIncidentAssignment(
    normalizedBaseUrl,
    platformAccessToken,
    Number(technician?.id),
    Number(incident?.id),
    logger,
  );

  const seedState = {
    generated_at: new Date().toISOString(),
    base_url: normalizedBaseUrl,
    tenant_id: E2E_SCENARIO.tenantId,
    users: {
      platform_owner: E2E_SCENARIO.platformOwner,
      admin: E2E_SCENARIO.admin,
      supervisor: E2E_SCENARIO.supervisor,
      technician: E2E_SCENARIO.technicianUser,
      reader: E2E_SCENARIO.reader,
    },
    technician,
    installation,
    incident,
    assignment,
  };
  await persistSeedState(seedState);
  logger.log?.(`[e2e] seed state written to ${seedStatePath}`);
  return seedState;
}
