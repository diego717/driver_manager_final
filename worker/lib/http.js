import { normalizeOptionalString } from "./core.js";

const CONTROLLED_DASHBOARD_ORIGINS = [
  "https://dashboard.driver-manager.app",
  "https://dashboard.drivermanager.app",
];

const CONTROLLED_MOBILE_ORIGINS = [
  "https://mobile.driver-manager.app",
  "https://app.driver-manager.app",
  "capacitor://localhost",
];

export function errorCodeFromHttpStatus(status) {
  const normalizedStatus = Number.isInteger(status) ? status : Number.parseInt(String(status || ""), 10);
  switch (normalizedStatus) {
    case 400:
      return "INVALID_REQUEST";
    case 401:
      return "UNAUTHORIZED";
    case 403:
      return "FORBIDDEN";
    case 404:
      return "NOT_FOUND";
    case 405:
      return "METHOD_NOT_ALLOWED";
    case 409:
      return "CONFLICT";
    case 413:
      return "PAYLOAD_TOO_LARGE";
    case 422:
      return "UNPROCESSABLE_ENTITY";
    case 429:
      return "TOO_MANY_REQUESTS";
    default:
      if (Number.isInteger(normalizedStatus) && normalizedStatus >= 400 && normalizedStatus <= 499) {
        return "INVALID_REQUEST";
      }
      if (Number.isInteger(normalizedStatus) && normalizedStatus >= 500) {
        return "INTERNAL_ERROR";
      }
      return "INVALID_REQUEST";
  }
}

function isLocalhostOrigin(origin) {
  if (!origin) return false;
  try {
    const parsed = new URL(origin);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return false;
    }
    const host = normalizeOptionalString(parsed.hostname, "").toLowerCase();
    return host === "localhost" || host === "127.0.0.1" || host === "::1";
  } catch {
    return false;
  }
}

function parseBooleanEnvFlag(value, fallback = false) {
  if (value === null || value === undefined || value === "") return fallback;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  const normalized = normalizeOptionalString(value, "").toLowerCase();
  if (!normalized) return fallback;
  if (["1", "true", "yes", "on", "enabled"].includes(normalized)) return true;
  if (["0", "false", "no", "off", "disabled"].includes(normalized)) return false;
  return fallback;
}

function shouldAllowLocalhostCors(env) {
  return (
    parseBooleanEnvFlag(env?.ALLOW_LOCALHOST_CORS, false) ||
    parseBooleanEnvFlag(env?.ALLOW_LOCALHOST_ORIGINS, false)
  );
}

function getAllowedCorsOrigins(request, env) {
  void request;
  const allowed = new Set([...CONTROLLED_DASHBOARD_ORIGINS, ...CONTROLLED_MOBILE_ORIGINS]);

  const extraOrigins = normalizeOptionalString(env?.CORS_ALLOWED_ORIGINS, "");
  if (extraOrigins) {
    for (const origin of extraOrigins.split(",")) {
      const normalized = origin.trim();
      if (normalized) {
        allowed.add(normalized);
      }
    }
  }

  return allowed;
}

export function buildCorsPolicy(isWebRoute, routeParts) {
  const headers = new Set();
  const methods = new Set(["OPTIONS"]);

  if (routeParts.length === 0 || (routeParts.length === 1 && routeParts[0] === "health")) {
    methods.add("GET");
    return { methods: [...methods], headers: [] };
  }

  const first = routeParts[0] || "";
  const isPhotoUpload = routeParts.length === 3 && first === "incidents" && routeParts[2] === "photos";
  const isRecordById = routeParts.length === 2 && first === "installations";
  const isIncidentStatusByIdRoute =
    routeParts.length === 3 &&
    first === "incidents" &&
    routeParts[2] === "status";
  const isInstallationIncidentStatusRoute =
    routeParts.length === 5 &&
    first === "installations" &&
    routeParts[2] === "incidents" &&
    routeParts[4] === "status";

  if (isWebRoute) {
    headers.add("Authorization");
    headers.add("X-Client-Platform");
  } else {
    headers.add("X-API-Token");
    headers.add("X-Request-Timestamp");
    headers.add("X-Request-Signature");
    headers.add("X-Request-Nonce");
    headers.add("X-Body-SHA256");
  }

  if (
    isPhotoUpload ||
    isIncidentStatusByIdRoute ||
    isInstallationIncidentStatusRoute ||
    first === "records" ||
    first === "assets" ||
    first === "scan" ||
    first === "drivers" ||
    first === "devices" ||
    first === "audit-logs" ||
    first === "auth" ||
    first === "installations" ||
    first === "maintenance"
  ) {
    headers.add("Content-Type");
  }
  if (isPhotoUpload) {
    headers.add("X-File-Name");
    headers.add("X-Client-Name");
    headers.add("X-Asset-Code");
  }

  if (
    [
      "dashboard",
      "dashboard.css",
      "chart.umd.js",
      "dashboard-qr.js",
      "dashboard.js",
      "dashboard-pwa.js",
      "manifest.json",
      "events",
      "sw.js",
    ].includes(first)
  ) {
    methods.add("GET");
  } else if (isInstallationIncidentStatusRoute) {
    methods.add("PATCH");
  } else if (first === "installations" && !isRecordById) {
    methods.add("GET");
    methods.add("POST");
  } else if (isRecordById) {
    methods.add("GET");
    methods.add("PUT");
    methods.add("DELETE");
  } else if (first === "assets") {
    methods.add("GET");
    methods.add("POST");
    methods.add("PATCH");
    methods.add("DELETE");
  } else if (first === "scan") {
    methods.add("POST");
  } else if (first === "drivers") {
    methods.add("GET");
    methods.add("POST");
    methods.add("DELETE");
  } else if (["records", "devices", "audit-logs"].includes(first)) {
    methods.add(first === "audit-logs" ? "GET" : "POST");
    methods.add("POST");
  } else if (first === "statistics" || first === "photos" || first === "lookup") {
    methods.add("GET");
  } else if (first === "incidents") {
    methods.add("GET");
    methods.add("POST");
    methods.add("PATCH");
  } else if (first === "auth") {
    methods.add("GET");
    methods.add("POST");
    methods.add("PATCH");
  } else if (first === "maintenance") {
    methods.add("POST");
  }

  return {
    methods: [...methods],
    headers: [...headers],
  };
}

export function corsHeaders(request, env, corsPolicy = { methods: ["OPTIONS"], headers: [] }) {
  const origin = normalizeOptionalString(request?.headers?.get("Origin"), "");
  if (!origin) return {};

  const allowedOrigins = getAllowedCorsOrigins(request, env);
  const isAllowedLocalhostOrigin = shouldAllowLocalhostCors(env) && isLocalhostOrigin(origin);
  if (!allowedOrigins.has(origin) && !isAllowedLocalhostOrigin) {
    return {};
  }

  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": corsPolicy.methods.join(", "),
    "Access-Control-Allow-Headers": corsPolicy.headers.join(", "),
    Vary: "Origin",
  };
}

export function appendVaryHeader(headers, varyValue) {
  if (!headers || !varyValue) return;

  const existing = normalizeOptionalString(headers.get("Vary"), "");
  if (!existing) {
    headers.set("Vary", String(varyValue));
    return;
  }

  const existingValues = new Set(
    existing
      .split(",")
      .map((value) => normalizeOptionalString(value, "").toLowerCase())
      .filter((value) => value),
  );

  for (const token of String(varyValue).split(",")) {
    const normalized = normalizeOptionalString(token, "");
    if (!normalized) continue;
    const lowered = normalized.toLowerCase();
    if (!existingValues.has(lowered)) {
      headers.set("Vary", `${headers.get("Vary")}, ${normalized}`);
      existingValues.add(lowered);
    }
  }
}

export function setHeaderWithVaryMerge(headers, key, value) {
  if (String(key).toLowerCase() === "vary") {
    appendVaryHeader(headers, value);
    return;
  }
  headers.set(key, value);
}

function shouldDisableCachingForRequest(request) {
  if (!request?.url) return false;
  try {
    const pathname = new URL(request.url).pathname || "";
    return pathname === "/web" || pathname.startsWith("/web/");
  } catch {
    return false;
  }
}

function apiResponseSecurityHeaders() {
  return {
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
  };
}

export function jsonResponse(request, env, corsPolicy, body, status = 200) {
  const headers = {
    ...corsHeaders(request, env, corsPolicy),
    ...apiResponseSecurityHeaders(),
    "Content-Type": "application/json",
  };

  if (shouldDisableCachingForRequest(request)) {
    headers["Cache-Control"] = "no-store";
    headers.Pragma = "no-cache";
  }

  return new Response(JSON.stringify(body), {
    status,
    headers,
  });
}

export function textResponse(request, env, corsPolicy, text, status = 200) {
  const headers = {
    ...corsHeaders(request, env, corsPolicy),
    ...apiResponseSecurityHeaders(),
  };
  if (shouldDisableCachingForRequest(request)) {
    headers["Cache-Control"] = "no-store";
    headers.Pragma = "no-cache";
  }

  return new Response(text, {
    status,
    headers,
  });
}

export function applyNoStoreHeaders(response) {
  if (!(response instanceof Response)) return response;
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("Pragma", "no-cache");
  return response;
}
