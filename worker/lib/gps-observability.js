import { GPS_CAPTURE_STATUSES, GPS_OVERRIDE_STATUS } from "./gps.js";

export const GPS_OBSERVABILITY_AUDIT_ACTIONS = Object.freeze([
  "incident_geofence_warning",
  "override_incident_geofence",
  "installation_conformity_geofence_warning",
  "override_installation_conformity_geofence",
  "override_installation_conformity_gps",
]);

function round2(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function normalizeGpsStatus(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (GPS_CAPTURE_STATUSES.has(normalized) || normalized === GPS_OVERRIDE_STATUS) {
    return normalized;
  }
  return "pending";
}

function pickPercentile(values, percentile) {
  if (!Array.isArray(values) || values.length === 0) {
    return null;
  }
  const index = Math.min(
    values.length - 1,
    Math.max(0, Math.ceil(values.length * percentile) - 1),
  );
  return round2(values[index]);
}

export function createEmptyGpsFlowObservability() {
  return {
    total_rows: 0,
    attempted_count: 0,
    captured_count: 0,
    pending_count: 0,
    denied_count: 0,
    timeout_count: 0,
    unavailable_count: 0,
    unsupported_count: 0,
    override_count: 0,
    failure_count: 0,
    capture_success_rate: 0,
    average_accuracy_m: null,
    p50_accuracy_m: null,
    p95_accuracy_m: null,
  };
}

export function summarizeGpsFlowObservability(rows) {
  const summary = createEmptyGpsFlowObservability();
  const capturedAccuracies = [];

  for (const row of rows || []) {
    summary.total_rows += 1;
    const status = normalizeGpsStatus(row?.gps_capture_status);
    const accuracy = Number(row?.gps_accuracy_m);

    if (status === "captured") {
      summary.captured_count += 1;
      if (Number.isFinite(accuracy) && accuracy >= 0) {
        capturedAccuracies.push(accuracy);
      }
    } else if (status === "denied") {
      summary.denied_count += 1;
    } else if (status === "timeout") {
      summary.timeout_count += 1;
    } else if (status === "unavailable") {
      summary.unavailable_count += 1;
    } else if (status === "unsupported") {
      summary.unsupported_count += 1;
    } else if (status === GPS_OVERRIDE_STATUS) {
      summary.override_count += 1;
    } else {
      summary.pending_count += 1;
    }
  }

  summary.attempted_count = summary.total_rows - summary.pending_count;
  summary.failure_count =
    summary.denied_count +
    summary.timeout_count +
    summary.unavailable_count +
    summary.unsupported_count;
  summary.capture_success_rate = summary.attempted_count > 0
    ? round2((summary.captured_count / summary.attempted_count) * 100)
    : 0;

  if (capturedAccuracies.length > 0) {
    capturedAccuracies.sort((left, right) => left - right);
    const average = capturedAccuracies.reduce((sum, value) => sum + value, 0) / capturedAccuracies.length;
    summary.average_accuracy_m = round2(average);
    summary.p50_accuracy_m = pickPercentile(capturedAccuracies, 0.5);
    summary.p95_accuracy_m = pickPercentile(capturedAccuracies, 0.95);
  }

  return summary;
}

export function createEmptyGpsObservabilitySummary() {
  return {
    installations: createEmptyGpsFlowObservability(),
    incidents: createEmptyGpsFlowObservability(),
    warnings: {
      incident_outside_count: 0,
      conformity_outside_count: 0,
      total_outside_count: 0,
    },
    overrides: {
      incident_geofence_count: 0,
      conformity_geofence_count: 0,
      conformity_gps_count: 0,
      total_override_count: 0,
    },
  };
}

export function summarizeGpsObservability({
  installationRows = [],
  incidentRows = [],
  auditActionRows = [],
} = {}) {
  const summary = createEmptyGpsObservabilitySummary();
  summary.installations = summarizeGpsFlowObservability(installationRows);
  summary.incidents = summarizeGpsFlowObservability(incidentRows);

  const countsByAction = new Map();
  for (const row of auditActionRows || []) {
    const action = String(row?.action || "").trim();
    const count = Number(row?.count) || 0;
    if (!action || count <= 0) continue;
    countsByAction.set(action, count);
  }

  summary.warnings.incident_outside_count = countsByAction.get("incident_geofence_warning") || 0;
  summary.warnings.conformity_outside_count = countsByAction.get("installation_conformity_geofence_warning") || 0;
  summary.warnings.total_outside_count =
    summary.warnings.incident_outside_count +
    summary.warnings.conformity_outside_count;

  summary.overrides.incident_geofence_count = countsByAction.get("override_incident_geofence") || 0;
  summary.overrides.conformity_geofence_count = countsByAction.get("override_installation_conformity_geofence") || 0;
  summary.overrides.conformity_gps_count = countsByAction.get("override_installation_conformity_gps") || 0;
  summary.overrides.total_override_count =
    summary.overrides.incident_geofence_count +
    summary.overrides.conformity_geofence_count +
    summary.overrides.conformity_gps_count;

  return summary;
}
