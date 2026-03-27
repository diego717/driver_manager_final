import { HttpError, normalizeOptionalString } from "./core.js";

export const GPS_CAPTURE_STATUSES = new Set([
  "pending",
  "captured",
  "denied",
  "timeout",
  "unavailable",
  "unsupported",
]);

export const GPS_CAPTURE_SOURCES = new Set([
  "browser",
  "none",
]);

export const GPS_OVERRIDE_STATUS = "override";
export const GPS_OVERRIDE_SOURCE = "override";

export const GPS_COLUMN_NAMES = Object.freeze([
  "gps_lat",
  "gps_lng",
  "gps_accuracy_m",
  "gps_captured_at",
  "gps_capture_source",
  "gps_capture_status",
  "gps_capture_note",
]);

function parseFiniteNumber(value, label) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new HttpError(400, `Campo 'gps.${label}' invalido.`);
  }
  return parsed;
}

function parseIsoTimestamp(value, label) {
  const normalized = normalizeOptionalString(value, "");
  const parsed = Date.parse(normalized);
  if (!normalized || !Number.isFinite(parsed)) {
    throw new HttpError(400, `Campo 'gps.${label}' invalido.`);
  }
  return new Date(parsed).toISOString();
}

export function buildDefaultGpsSnapshot() {
  return {
    gps_lat: null,
    gps_lng: null,
    gps_accuracy_m: null,
    gps_captured_at: null,
    gps_capture_source: "none",
    gps_capture_status: "pending",
    gps_capture_note: "",
  };
}

export function normalizeGpsPayload(payload, options = {}) {
  const allowOverride = options?.allowOverride === true;
  if (payload === null || payload === undefined) {
    return buildDefaultGpsSnapshot();
  }
  if (typeof payload !== "object" || Array.isArray(payload)) {
    throw new HttpError(400, "Campo 'gps' invalido.");
  }

  const rawStatus = normalizeOptionalString(payload.status, "pending").toLowerCase();
  const allowedStatuses = allowOverride
    ? new Set([...GPS_CAPTURE_STATUSES, GPS_OVERRIDE_STATUS])
    : GPS_CAPTURE_STATUSES;
  if (!allowedStatuses.has(rawStatus)) {
    throw new HttpError(400, "Campo 'gps.status' invalido.");
  }

  const defaultSource = rawStatus === "pending"
    ? "none"
    : rawStatus === GPS_OVERRIDE_STATUS
      ? GPS_OVERRIDE_SOURCE
      : "browser";
  const rawSource = normalizeOptionalString(payload.source, defaultSource).toLowerCase();
  const allowedSources = allowOverride
    ? new Set([...GPS_CAPTURE_SOURCES, GPS_OVERRIDE_SOURCE])
    : GPS_CAPTURE_SOURCES;
  if (!allowedSources.has(rawSource)) {
    throw new HttpError(400, "Campo 'gps.source' invalido.");
  }

  if (rawStatus === GPS_OVERRIDE_STATUS && rawSource !== GPS_OVERRIDE_SOURCE) {
    throw new HttpError(400, "Campo 'gps.source' invalido para override.");
  }

  if (rawStatus !== "pending" && rawStatus !== GPS_OVERRIDE_STATUS && rawSource === "none") {
    throw new HttpError(400, "Campo 'gps.source' invalido para el estado enviado.");
  }

  const note = normalizeOptionalString(payload.note, "");
  if (note.length > 500) {
    throw new HttpError(400, "Campo 'gps.note' supera el limite permitido.");
  }

  if (rawStatus === GPS_OVERRIDE_STATUS && !note) {
    throw new HttpError(400, "Campo 'gps.note' es obligatorio para override.");
  }

  if (rawStatus !== "captured") {
    return {
      gps_lat: null,
      gps_lng: null,
      gps_accuracy_m: null,
      gps_captured_at: null,
      gps_capture_source: rawSource,
      gps_capture_status: rawStatus,
      gps_capture_note: note,
    };
  }

  if (rawSource !== "browser") {
    throw new HttpError(400, "Campo 'gps.source' invalido para una captura valida.");
  }

  const lat = parseFiniteNumber(payload.lat, "lat");
  if (lat < -90 || lat > 90) {
    throw new HttpError(400, "Campo 'gps.lat' fuera de rango.");
  }

  const lng = parseFiniteNumber(payload.lng, "lng");
  if (lng < -180 || lng > 180) {
    throw new HttpError(400, "Campo 'gps.lng' fuera de rango.");
  }

  const accuracy = parseFiniteNumber(payload.accuracy_m, "accuracy_m");
  if (accuracy < 0) {
    throw new HttpError(400, "Campo 'gps.accuracy_m' invalido.");
  }

  return {
    gps_lat: lat,
    gps_lng: lng,
    gps_accuracy_m: accuracy,
    gps_captured_at: parseIsoTimestamp(payload.captured_at, "captured_at"),
    gps_capture_source: rawSource,
    gps_capture_status: rawStatus,
    gps_capture_note: note,
  };
}

export function buildGpsMetadataSnapshot(gps) {
  const snapshot = gps && typeof gps === "object"
    ? gps
    : buildDefaultGpsSnapshot();
  return {
    lat: snapshot.gps_lat ?? null,
    lng: snapshot.gps_lng ?? null,
    accuracy_m: snapshot.gps_accuracy_m ?? null,
    captured_at: snapshot.gps_captured_at ?? null,
    source: snapshot.gps_capture_source || "none",
    status: snapshot.gps_capture_status || "pending",
    note: snapshot.gps_capture_note || "",
  };
}

export function buildGpsMapsUrl(gps) {
  const snapshot = buildGpsMetadataSnapshot(gps);
  if (snapshot.status !== "captured") return "";
  if (!Number.isFinite(Number(snapshot.lat)) || !Number.isFinite(Number(snapshot.lng))) {
    return "";
  }
  return `https://www.google.com/maps?q=${Number(snapshot.lat)},${Number(snapshot.lng)}`;
}

export function gpsBindValues(gps) {
  const snapshot = gps && typeof gps === "object"
    ? gps
    : buildDefaultGpsSnapshot();
  return GPS_COLUMN_NAMES.map((field) => snapshot[field] ?? null);
}
