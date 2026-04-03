export const DEFAULT_REALTIME_TENANT_ID = "default";

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

export function isMissingIncidentReadModelColumnsError(error) {
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
    message.includes("gps_capture_note") ||
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
