import { HttpError, normalizeOptionalString, normalizeRealtimeTenantId } from "./core.js";

export const GEOFENCE_RESULT_NOT_APPLICABLE = "not_applicable";
export const GEOFENCE_RESULT_INSIDE = "inside";
export const GEOFENCE_RESULT_OUTSIDE = "outside";
export const GEOFENCE_FLOW_INCIDENTS = "incidents";
export const GEOFENCE_FLOW_CONFORMITY = "conformity";

export function buildDefaultGeofenceSnapshot() {
  return {
    geofence_distance_m: null,
    geofence_radius_m: null,
    geofence_result: GEOFENCE_RESULT_NOT_APPLICABLE,
    geofence_checked_at: null,
    geofence_override_note: "",
    geofence_override_by: null,
    geofence_override_at: null,
  };
}

function normalizeToken(value) {
  return normalizeOptionalString(value, "").trim().toLowerCase();
}

function parseBooleanEnvFlag(value, fallback = false) {
  if (value === null || value === undefined) return fallback;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  const normalized = normalizeToken(value);
  if (!normalized) return fallback;
  if (["1", "true", "yes", "on", "enabled"].includes(normalized)) return true;
  if (["0", "false", "no", "off", "disabled"].includes(normalized)) return false;
  return fallback;
}

function parseCsvTokens(value) {
  return new Set(
    normalizeOptionalString(value, "")
      .split(",")
      .map((entry) => normalizeToken(entry))
      .filter(Boolean),
  );
}

function parseOptionalFiniteNumber(value, label) {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" && value.trim() === "") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new HttpError(400, `Campo '${label}' invalido.`);
  }
  return parsed;
}

export function normalizeInstallationSitePayload(data) {
  const source = data && typeof data === "object" ? data : {};
  const hasSiteLat = Object.prototype.hasOwnProperty.call(source, "site_lat");
  const hasSiteLng = Object.prototype.hasOwnProperty.call(source, "site_lng");
  const hasSiteRadius = Object.prototype.hasOwnProperty.call(source, "site_radius_m");
  const hasSiteConfig = hasSiteLat || hasSiteLng || hasSiteRadius;

  if (!hasSiteConfig) {
    return {
      hasSiteConfig: false,
      site_lat: null,
      site_lng: null,
      site_radius_m: null,
    };
  }

  const siteLat = parseOptionalFiniteNumber(source.site_lat, "site_lat");
  const siteLng = parseOptionalFiniteNumber(source.site_lng, "site_lng");
  const siteRadius = parseOptionalFiniteNumber(source.site_radius_m, "site_radius_m");

  const allEmpty = siteLat === null && siteLng === null && siteRadius === null;
  if (allEmpty) {
    return {
      hasSiteConfig: true,
      site_lat: null,
      site_lng: null,
      site_radius_m: null,
    };
  }

  if (siteLat === null || siteLng === null || siteRadius === null) {
    throw new HttpError(
      400,
      "Campos 'site_lat', 'site_lng' y 'site_radius_m' deben enviarse juntos.",
    );
  }
  if (siteLat < -90 || siteLat > 90) {
    throw new HttpError(400, "Campo 'site_lat' fuera de rango.");
  }
  if (siteLng < -180 || siteLng > 180) {
    throw new HttpError(400, "Campo 'site_lng' fuera de rango.");
  }
  if (siteRadius <= 0) {
    throw new HttpError(400, "Campo 'site_radius_m' debe ser mayor a cero.");
  }

  return {
    hasSiteConfig: true,
    site_lat: siteLat,
    site_lng: siteLng,
    site_radius_m: siteRadius,
  };
}

export function haversineDistanceMeters(fromLat, fromLng, toLat, toLng) {
  const earthRadiusM = 6371000;
  const toRadians = (value) => (Number(value) * Math.PI) / 180;
  const lat1 = toRadians(fromLat);
  const lat2 = toRadians(toLat);
  const dLat = toRadians(Number(toLat) - Number(fromLat));
  const dLng = toRadians(Number(toLng) - Number(fromLng));
  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const a = sinLat * sinLat
    + Math.cos(lat1) * Math.cos(lat2) * sinLng * sinLng;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return earthRadiusM * c;
}

export function evaluateGeofence({ gps, installation, checkedAt }) {
  const snapshot = buildDefaultGeofenceSnapshot();
  const siteLat = Number(installation?.site_lat);
  const siteLng = Number(installation?.site_lng);
  const siteRadius = Number(installation?.site_radius_m);
  const hasSiteConfig =
    Number.isFinite(siteLat) &&
    Number.isFinite(siteLng) &&
    Number.isFinite(siteRadius) &&
    siteRadius > 0;

  if (!hasSiteConfig) {
    return snapshot;
  }

  snapshot.geofence_radius_m = siteRadius;

  if (String(gps?.gps_capture_status || "").toLowerCase() !== "captured") {
    snapshot.geofence_checked_at = checkedAt || null;
    return snapshot;
  }

  const gpsLat = Number(gps?.gps_lat);
  const gpsLng = Number(gps?.gps_lng);
  if (!Number.isFinite(gpsLat) || !Number.isFinite(gpsLng)) {
    snapshot.geofence_checked_at = checkedAt || null;
    return snapshot;
  }

  const distance = haversineDistanceMeters(siteLat, siteLng, gpsLat, gpsLng);
  snapshot.geofence_distance_m = distance;
  snapshot.geofence_checked_at = checkedAt || null;
  snapshot.geofence_result = distance <= siteRadius
    ? GEOFENCE_RESULT_INSIDE
    : GEOFENCE_RESULT_OUTSIDE;
  return snapshot;
}

export function normalizeGeofenceOverrideNote(value) {
  const note = normalizeOptionalString(value, "");
  if (note.length > 500) {
    throw new HttpError(400, "Campo 'geofence_override_note' supera el limite permitido.");
  }
  return note;
}

export function isHardGeofenceEnabledForFlow(env, tenantId, flow) {
  if (!parseBooleanEnvFlag(env?.GEOFENCE_HARD_ENABLED, false)) {
    return false;
  }

  const allowedFlows = parseCsvTokens(env?.GEOFENCE_HARD_FLOWS);
  const normalizedFlow = normalizeToken(flow);
  if (
    allowedFlows.size > 0 &&
    !allowedFlows.has("all") &&
    !allowedFlows.has("*") &&
    !allowedFlows.has(normalizedFlow)
  ) {
    return false;
  }

  const allowedTenants = parseCsvTokens(env?.GEOFENCE_HARD_TENANTS);
  const normalizedTenantId = normalizeRealtimeTenantId(tenantId);
  if (
    allowedTenants.size > 0 &&
    !allowedTenants.has("all") &&
    !allowedTenants.has("*") &&
    !allowedTenants.has(normalizedTenantId)
  ) {
    return false;
  }

  return true;
}

function buildHardGeofenceMessage(flow) {
  if (normalizeToken(flow) === GEOFENCE_FLOW_CONFORMITY) {
    return "La captura GPS quedo fuera del radio configurado. Debes registrar motivo de override para generar la conformidad.";
  }
  return "La captura GPS quedo fuera del radio configurado. Debes registrar motivo de override para crear la incidencia.";
}

export function resolveHardGeofenceOverride({
  env,
  tenantId,
  flow,
  geofence,
  overrideNote,
  actorUsername,
  appliedAt,
}) {
  const policyEnabled = isHardGeofenceEnabledForFlow(env, tenantId, flow);
  const normalizedNote = normalizeGeofenceOverrideNote(overrideNote);
  const isOutside = normalizeToken(geofence?.geofence_result) === GEOFENCE_RESULT_OUTSIDE;
  const overrideRequired = policyEnabled && isOutside;

  if (overrideRequired && !normalizedNote) {
    throw new HttpError(409, buildHardGeofenceMessage(flow));
  }

  return {
    policy_enabled: policyEnabled,
    override_required: overrideRequired,
    override_applied: overrideRequired && Boolean(normalizedNote),
    override_note: overrideRequired ? normalizedNote : "",
    override_by: overrideRequired && normalizedNote ? normalizeOptionalString(actorUsername, "") || null : null,
    override_at: overrideRequired && normalizedNote ? appliedAt || null : null,
  };
}
