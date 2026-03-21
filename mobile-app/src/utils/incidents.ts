import {
  type Incident,
  type IncidentSeverity,
  type IncidentStatus,
  type InstallationRecord,
} from "../types/api";

export type RecordAttentionState =
  | "clear"
  | "open"
  | "in_progress"
  | "paused"
  | "resolved"
  | "critical";

function parseNonNegativeInt(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, Math.trunc(parsed));
}

function parseIsoMs(value: unknown): number | null {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

export function formatDuration(value: number | null | undefined): string {
  const totalSeconds = parseNonNegativeInt(value, 0);
  if (totalSeconds <= 0) return "0s";

  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;

  const parts: string[] = [];
  if (days) parts.push(`${days}d`);
  if (hours) parts.push(`${hours}h`);
  if (minutes) parts.push(`${minutes}m`);
  if (seconds || parts.length === 0) parts.push(`${seconds}s`);
  return parts.join(" ");
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return "-";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
}

export function normalizeIncidentStatus(value: unknown): IncidentStatus {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "in_progress") return "in_progress";
  if (normalized === "paused") return "paused";
  if (normalized === "resolved") return "resolved";
  return "open";
}

export function getIncidentStatusLabel(value: unknown): string {
  const status = normalizeIncidentStatus(value);
  if (status === "in_progress") return "En curso";
  if (status === "paused") return "Pausada";
  if (status === "resolved") return "Resuelta";
  return "Abierta";
}

export function normalizeRecordAttentionState(value: unknown): RecordAttentionState {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "critical") return "critical";
  if (normalized === "in_progress") return "in_progress";
  if (normalized === "paused") return "paused";
  if (normalized === "resolved") return "resolved";
  if (normalized === "open") return "open";
  return "clear";
}

export function getRecordAttentionStateLabel(value: unknown): string {
  const attention = normalizeRecordAttentionState(value);
  if (attention === "critical") return "Crítica";
  if (attention === "in_progress") return "En curso";
  if (attention === "paused") return "Pausada";
  if (attention === "resolved") return "Resuelta";
  if (attention === "open") return "Abierta";
  return "Sin incidencias";
}

export function getSeverityLabel(value: IncidentSeverity | string | null | undefined): string {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "critical") return "Crítica";
  if (normalized === "high") return "Alta";
  if (normalized === "medium") return "Media";
  return "Baja";
}

export function resolveIncidentEstimatedDurationSeconds(
  incident: Pick<Incident, "estimated_duration_seconds" | "time_adjustment_seconds"> | null | undefined,
): number {
  if (!incident) return 0;
  const estimated = parseNonNegativeInt(incident.estimated_duration_seconds, -1);
  if (estimated >= 0) return estimated;
  return parseNonNegativeInt(incident.time_adjustment_seconds, 0);
}

export function resolveIncidentRuntimeStartMs(
  incident: Pick<
    Incident,
    "created_at" | "status_updated_at" | "work_started_at" | "incident_status"
  > | null | undefined,
): number | null {
  if (!incident) return null;
  const workStartedAtMs = parseIsoMs(incident.work_started_at);
  if (workStartedAtMs) return workStartedAtMs;
  const status = normalizeIncidentStatus(incident.incident_status);
  if (status === "in_progress") {
    return parseIsoMs(incident.status_updated_at) ?? parseIsoMs(incident.created_at);
  }
  return parseIsoMs(incident.created_at);
}

export function resolveIncidentRealDurationSeconds(
  incident: Pick<
    Incident,
    | "actual_duration_seconds"
    | "incident_status"
    | "created_at"
    | "status_updated_at"
    | "work_started_at"
    | "work_ended_at"
    | "resolved_at"
  > | null | undefined,
  nowMs = Date.now(),
): number {
  if (!incident) return 0;

  const status = normalizeIncidentStatus(incident.incident_status);
  const persisted = parseNonNegativeInt(incident.actual_duration_seconds, -1);
  const startMs = resolveIncidentRuntimeStartMs(incident);
  const endMs =
    parseIsoMs(incident.work_ended_at) ??
    parseIsoMs(incident.resolved_at) ??
    (status === "in_progress" ? nowMs : null);
  const segmentSeconds =
    startMs !== null && endMs !== null && endMs >= startMs
      ? Math.floor((endMs - startMs) / 1000)
      : 0;

  if (persisted >= 0) {
    return status === "in_progress" ? persisted + segmentSeconds : persisted;
  }
  return segmentSeconds;
}

export function summarizeIncidentBuckets(incidents: Incident[]): {
  open: number;
  inProgress: number;
  paused: number;
  resolved: number;
  active: number;
  criticalActive: number;
} {
  return incidents.reduce(
    (summary, incident) => {
      const status = normalizeIncidentStatus(incident.incident_status);
      if (status === "resolved") {
        summary.resolved += 1;
      } else {
        summary.active += 1;
      }
      if (status === "open") summary.open += 1;
      if (status === "in_progress") summary.inProgress += 1;
      if (status === "paused") summary.paused += 1;
      if (
        status !== "resolved" &&
        String(incident.severity || "").trim().toLowerCase() === "critical"
      ) {
        summary.criticalActive += 1;
      }
      return summary;
    },
    {
      open: 0,
      inProgress: 0,
      paused: 0,
      resolved: 0,
      active: 0,
      criticalActive: 0,
    },
  );
}

export function deriveRecordIncidentSummary(record: InstallationRecord | null | undefined): {
  active: number;
  inProgress: number;
  paused: number;
  criticalActive: number;
} {
  return {
    active: parseNonNegativeInt(record?.incident_active_count, 0),
    inProgress: parseNonNegativeInt(record?.incident_in_progress_count, 0),
    paused: parseNonNegativeInt(record?.incident_paused_count, 0),
    criticalActive: parseNonNegativeInt(record?.incident_critical_active_count, 0),
  };
}
