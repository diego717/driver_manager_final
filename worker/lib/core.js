export const DEFAULT_REALTIME_TENANT_ID = "default";
export const WEB_CANONICAL_ROLES = [
  "admin",
  "supervisor",
  "tecnico",
  "solo_lectura",
  "super_admin",
  "platform_owner",
];
export const WEB_CANONICAL_ROLE_SET = new Set(WEB_CANONICAL_ROLES);

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function nowIso() {
  return new Date().toISOString();
}

export function normalizeOptionalString(value, fallback = "") {
  if (value === null || value === undefined) return fallback;
  return String(value).trim();
}

export function canonicalizeWebRole(roleRaw, fallback = "admin") {
  const normalized = normalizeOptionalString(roleRaw, fallback).toLowerCase();
  if (!normalized) {
    return normalizeOptionalString(fallback, "admin").toLowerCase() || "admin";
  }
  if (normalized === "viewer") return "solo_lectura";
  return normalized;
}

export function isValidWebRole(roleRaw) {
  return WEB_CANONICAL_ROLE_SET.has(canonicalizeWebRole(roleRaw, ""));
}

function resolveRoleFromActor(actorOrRole, fallback = "") {
  return actorOrRole && typeof actorOrRole === "object"
    ? canonicalizeWebRole(actorOrRole.role, fallback)
    : canonicalizeWebRole(actorOrRole, fallback);
}

export function canManagePlatform(actorOrRole) {
  const role = resolveRoleFromActor(actorOrRole, "");
  return role === "platform_owner" || role === "super_admin";
}

export function canManageUsers(actorOrRole) {
  const role = resolveRoleFromActor(actorOrRole, "");
  return role === "admin" || canManagePlatform(role);
}

export function canManageTechnicians(actorOrRole) {
  return canManageUsers(actorOrRole);
}

export function canViewTechnicianCatalog(actorOrRole) {
  const role = resolveRoleFromActor(actorOrRole, "");
  return (
    role === "admin" ||
    role === "supervisor" ||
    role === "solo_lectura" ||
    canManagePlatform(role)
  );
}

export function canAssignTechnicians(actorOrRole) {
  const role = resolveRoleFromActor(actorOrRole, "");
  return role === "admin" || role === "supervisor" || canManagePlatform(role);
}

export function canWriteOperationalData(actorOrRole) {
  const role = resolveRoleFromActor(actorOrRole, "");
  return (
    role === "admin" ||
    role === "supervisor" ||
    role === "tecnico" ||
    canManagePlatform(role)
  );
}

export function canReadOperationalData(actorOrRole) {
  return WEB_CANONICAL_ROLE_SET.has(resolveRoleFromActor(actorOrRole, ""));
}

export function canViewTenantIncidentMap(actorOrRole) {
  const role = resolveRoleFromActor(actorOrRole, "");
  return (
    role === "admin" ||
    role === "supervisor" ||
    role === "solo_lectura" ||
    canManagePlatform(role)
  );
}

export function canReopenIncidents(actorOrRole) {
  const role = resolveRoleFromActor(actorOrRole, "");
  return role === "admin" || role === "supervisor" || canManagePlatform(role);
}

export function canViewAssetCatalog(actorOrRole) {
  const role = resolveRoleFromActor(actorOrRole, "");
  return (
    role === "admin" ||
    role === "supervisor" ||
    role === "solo_lectura" ||
    canManagePlatform(role)
  );
}

export function canViewAssetDetail(actorOrRole) {
  const role = resolveRoleFromActor(actorOrRole, "");
  return role === "tecnico" || canViewAssetCatalog(role);
}

export function canEditAssetCatalog(actorOrRole) {
  const role = resolveRoleFromActor(actorOrRole, "");
  return role === "admin" || canManagePlatform(role);
}

export function canManageAssetLinks(actorOrRole) {
  const role = resolveRoleFromActor(actorOrRole, "");
  return role === "admin" || role === "supervisor" || canManagePlatform(role);
}

export function canManageAssetLoans(actorOrRole) {
  const role = resolveRoleFromActor(actorOrRole, "");
  return role === "admin" || role === "supervisor" || canManagePlatform(role);
}

export function canManagePublicTracking(actorOrRole) {
  const role = resolveRoleFromActor(actorOrRole, "");
  return role === "admin" || role === "supervisor" || canManagePlatform(role);
}

export function canDeleteCriticalData(actorOrRole) {
  return canManagePlatform(actorOrRole);
}

export function normalizeRealtimeTenantId(value) {
  const raw = normalizeOptionalString(value, "").toLowerCase();
  if (!raw) return DEFAULT_REALTIME_TENANT_ID;
  const normalized = raw.replace(/[^a-z0-9._-]/g, "_").slice(0, 64);
  return normalized || DEFAULT_REALTIME_TENANT_ID;
}

export function parsePositiveInt(value, label, ErrorType = HttpError) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new ErrorType(400, `${label} invalido.`);
  }
  return parsed;
}

export function parseOptionalPositiveInt(value, label, ErrorType = HttpError) {
  if (value === null || value === undefined || value === "") return null;
  return parsePositiveInt(value, label, ErrorType);
}

export function parseDateOrNull(value, options = {}) {
  if (!value) return null;
  const parsed = new Date(String(value));
  if (Number.isNaN(parsed.getTime())) {
    const ErrorType = options.ErrorType || HttpError;
    throw new ErrorType(400, options.errorMessage || "Fecha invalida en filtros.");
  }
  return parsed;
}

export function startOfUtcDay(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

export function addUtcDays(date, days) {
  const copy = new Date(date.getTime());
  copy.setUTCDate(copy.getUTCDate() + Number(days || 0));
  return copy;
}

export function toUtcDayKey(date) {
  return date.toISOString().slice(0, 10);
}

export function isMissingIncidentsTableError(error) {
  const message = normalizeOptionalString(error?.message, "").toLowerCase();
  return message.includes("no such table") && message.includes("incidents");
}

export function isMissingAssetsTableError(error) {
  const message = normalizeOptionalString(error?.message, "").toLowerCase();
  return (
    message.includes("no such table") &&
    (message.includes("assets") || message.includes("asset_installation_links"))
  );
}

export function isMissingIncidentAssetColumnError(error) {
  const message = normalizeOptionalString(error?.message, "").toLowerCase();
  return (
    (message.includes("no such column") || message.includes("has no column named")) &&
    message.includes("asset_id")
  );
}

export function isMissingIncidentTimingColumnsError(error) {
  const message = normalizeOptionalString(error?.message, "").toLowerCase();
  if (!(message.includes("no such column") || message.includes("has no column named"))) {
    return false;
  }
  return (
    message.includes("estimated_duration_seconds") ||
    message.includes("work_started_at") ||
    message.includes("work_ended_at") ||
      message.includes("actual_duration_seconds")
  );
}

export function isMissingIncidentGpsColumnsError(error) {
  const message = normalizeOptionalString(error?.message, "").toLowerCase();
  if (!(message.includes("no such column") || message.includes("has no column named"))) {
    return false;
  }
  return (
    message.includes("gps_lat") ||
    message.includes("gps_lng") ||
    message.includes("gps_accuracy_m") ||
    message.includes("gps_captured_at") ||
    message.includes("gps_capture_source") ||
    message.includes("gps_capture_status") ||
    message.includes("gps_capture_note")
  );
}

export function isMissingIncidentDispatchColumnsError(error) {
  const message = normalizeOptionalString(error?.message, "").toLowerCase();
  if (!(message.includes("no such column") || message.includes("has no column named"))) {
    return false;
  }
  return (
    message.includes("target_lat") ||
    message.includes("target_lng") ||
    message.includes("target_label") ||
    message.includes("target_source") ||
    message.includes("target_updated_at") ||
    message.includes("target_updated_by") ||
    message.includes("dispatch_required") ||
    message.includes("dispatch_place_name") ||
    message.includes("dispatch_address") ||
    message.includes("dispatch_reference") ||
    message.includes("dispatch_contact_name") ||
    message.includes("dispatch_contact_phone") ||
    message.includes("dispatch_notes")
  );
}

export function isMissingIncidentReadModelColumnsError(error) {
  return (
    isMissingIncidentGpsColumnsError(error) ||
    isMissingIncidentDispatchColumnsError(error)
  );
}

export function isIncidentStatusConstraintError(error) {
  const message = normalizeOptionalString(error?.message, "").toLowerCase();
  return message.includes("check constraint failed") && message.includes("incident_status");
}

export function isMissingIncidentSoftDeleteColumnsError(error) {
  const message = normalizeOptionalString(error?.message, "").toLowerCase();
  if (!(message.includes("no such column") || message.includes("has no column named"))) {
    return false;
  }
  return (
    message.includes("deleted_at") ||
    message.includes("deleted_by") ||
    message.includes("deletion_reason")
  );
}
