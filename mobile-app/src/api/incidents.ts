import {
  type CreateRecordInput,
  type CreateRecordResponse,
  type CreateIncidentInput,
  type CreateIncidentResponse,
  type DeleteIncidentResponse,
  type Incident,
  type IncidentPhoto,
  type InstallationRecord,
  type ListIncidentsResponse,
  type UpdateInstallationInput,
  type UpdateInstallationResponse,
  type UpdateIncidentEvidenceInput,
  type UpdateIncidentStatusInput,
} from "../types/api";
import { incidentsRepository } from "../db/repositories/incidents-repository";
import { normalizeIncidentStatus } from "../utils/incidents";
import { ensurePositiveInt } from "../utils/validation";
import { signedJsonRequest } from "./client";

const INSTALLATIONS_CACHE_TTL_MS = 60_000;
let installationsCache: InstallationRecord[] | null = null;
let installationsCacheExpiresAt = 0;
let lastIncidentListSource: "network" | "cache" = "network";
let lastIncidentDetailSource: "network" | "cache" = "network";

type RawInstallationRecord = Omit<InstallationRecord, "id"> & {
  id: number | string;
};

type RawIncidentPhoto = IncidentPhoto;

type RawIncidentRecord = Omit<Incident, "photos" | "incident_status"> & {
  incident_status?: string | null;
  photos?: RawIncidentPhoto[];
};

type RawListIncidentsResponse = Omit<ListIncidentsResponse, "incidents"> & {
  incidents: RawIncidentRecord[];
};

type RawCreateIncidentResponse = Omit<CreateIncidentResponse, "incident"> & {
  incident: Omit<RawIncidentRecord, "photos">;
};

type RawCreateRecordResponse = Omit<CreateRecordResponse, "record"> & {
  record: RawInstallationRecord;
};

type RawUpdateInstallationResponse = Omit<UpdateInstallationResponse, "installation"> & {
  installation: RawInstallationRecord;
};

function normalizeInstallationId(rawId: number | string): number {
  if (typeof rawId === "number" && Number.isInteger(rawId) && rawId > 0) {
    return rawId;
  }

  if (typeof rawId === "string") {
    const parsed = Number.parseInt(rawId, 10);
    if (Number.isInteger(parsed) && parsed > 0) {
      return parsed;
    }
  }

  throw new Error(`ID de instalacion invalido recibido desde API: ${String(rawId)}`);
}

function normalizeInstallationRecord(record: RawInstallationRecord): InstallationRecord {
  const asOptionalNonNegativeInt = (value: unknown): number | undefined => {
    if (value === null || value === undefined || value === "") return undefined;
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0) return 0;
    return Math.trunc(parsed);
  };

  return {
    ...record,
    id: normalizeInstallationId(record.id),
    incident_open_count: asOptionalNonNegativeInt(record.incident_open_count),
    incident_in_progress_count: asOptionalNonNegativeInt(record.incident_in_progress_count),
    incident_paused_count: asOptionalNonNegativeInt(record.incident_paused_count),
    incident_resolved_count: asOptionalNonNegativeInt(record.incident_resolved_count),
    incident_active_count: asOptionalNonNegativeInt(record.incident_active_count),
    incident_critical_active_count: asOptionalNonNegativeInt(record.incident_critical_active_count),
  };
}

function normalizeInstallationRecords(records: RawInstallationRecord[]): InstallationRecord[] {
  return records.map(normalizeInstallationRecord);
}

function normalizeIncidentRecord(record: RawIncidentRecord): Incident {
  return {
    ...record,
    asset_id:
      record.asset_id === null || record.asset_id === undefined
        ? null
        : Number(record.asset_id) || null,
    incident_status: normalizeIncidentStatus(record.incident_status),
    estimated_duration_seconds:
      record.estimated_duration_seconds === null || record.estimated_duration_seconds === undefined
        ? null
        : Math.max(0, Number(record.estimated_duration_seconds) || 0),
    target_lat:
      record.target_lat === null || record.target_lat === undefined
        ? null
        : Number(record.target_lat),
    target_lng:
      record.target_lng === null || record.target_lng === undefined
        ? null
        : Number(record.target_lng),
    target_label:
      typeof record.target_label === "string" && record.target_label.trim()
        ? record.target_label.trim()
        : null,
    target_source:
      typeof record.target_source === "string" && record.target_source.trim()
        ? record.target_source.trim().toLowerCase()
        : null,
    target_updated_at:
      typeof record.target_updated_at === "string" && record.target_updated_at.trim()
        ? record.target_updated_at.trim()
        : null,
    target_updated_by:
      typeof record.target_updated_by === "string" && record.target_updated_by.trim()
        ? record.target_updated_by.trim()
        : null,
    dispatch_required:
      record.dispatch_required === null || record.dispatch_required === undefined
        ? true
        : Boolean(record.dispatch_required),
    dispatch_place_name:
      typeof record.dispatch_place_name === "string" && record.dispatch_place_name.trim()
        ? record.dispatch_place_name.trim()
        : null,
    dispatch_address:
      typeof record.dispatch_address === "string" && record.dispatch_address.trim()
        ? record.dispatch_address.trim()
        : null,
    dispatch_reference:
      typeof record.dispatch_reference === "string" && record.dispatch_reference.trim()
        ? record.dispatch_reference.trim()
        : null,
    dispatch_contact_name:
      typeof record.dispatch_contact_name === "string" && record.dispatch_contact_name.trim()
        ? record.dispatch_contact_name.trim()
        : null,
    dispatch_contact_phone:
      typeof record.dispatch_contact_phone === "string" && record.dispatch_contact_phone.trim()
        ? record.dispatch_contact_phone.trim()
        : null,
    dispatch_notes:
      typeof record.dispatch_notes === "string" && record.dispatch_notes.trim()
        ? record.dispatch_notes.trim()
        : null,
    actual_duration_seconds:
      record.actual_duration_seconds === null || record.actual_duration_seconds === undefined
        ? null
        : Math.max(0, Number(record.actual_duration_seconds) || 0),
    photos: Array.isArray(record.photos) ? record.photos : [],
  };
}

export async function createIncident(
  installationId: number,
  payload: CreateIncidentInput,
): Promise<CreateIncidentResponse> {
  ensurePositiveInt(installationId, "installationId");
  const response = await signedJsonRequest<RawCreateIncidentResponse>({
    method: "POST",
    path: `/installations/${installationId}/incidents`,
    data: payload,
  });
  return {
    ...response,
    incident: normalizeIncidentRecord({
      ...response.incident,
      photos: [],
    }),
  };
}

export async function listIncidentsByInstallation(
  installationId: number,
): Promise<ListIncidentsResponse> {
  ensurePositiveInt(installationId, "installationId");
  try {
    const response = await signedJsonRequest<RawListIncidentsResponse>({
      method: "GET",
      path: `/installations/${installationId}/incidents`,
    });
    const incidents = Array.isArray(response.incidents)
      ? response.incidents.map(normalizeIncidentRecord)
      : [];
    await incidentsRepository.replaceRemoteInstallationSnapshots(installationId, incidents);
    lastIncidentListSource = "network";
    return {
      ...response,
      incidents,
    };
  } catch (error) {
    const cachedIncidents = await incidentsRepository.listCachedIncidentsByInstallation(installationId);
    if (cachedIncidents.length > 0) {
      lastIncidentListSource = "cache";
      return {
        success: true,
        installation_id: installationId,
        incidents: cachedIncidents.map(normalizeIncidentRecord),
      };
    }
    throw error;
  }
}

export async function getIncidentById(incidentId: number): Promise<Incident> {
  ensurePositiveInt(incidentId, "incidentId");
  try {
    const response = await signedJsonRequest<{ success: boolean; incident: RawIncidentRecord }>({
      method: "GET",
      path: `/incidents/${incidentId}`,
    });
    if (!response?.incident) {
      throw new Error("La incidencia solicitada no existe.");
    }
    const incident = normalizeIncidentRecord(response.incident);
    await incidentsRepository.upsertRemoteIncidentSnapshot(incident);
    lastIncidentDetailSource = "network";
    return incident;
  } catch (error) {
    const cachedIncident = await incidentsRepository.getCachedIncidentByRemoteId(incidentId);
    if (cachedIncident) {
      lastIncidentDetailSource = "cache";
      return normalizeIncidentRecord(cachedIncident as RawIncidentRecord);
    }
    throw error;
  }
}

export function getLastIncidentListSource(): "network" | "cache" {
  return lastIncidentListSource;
}

export function getLastIncidentDetailSource(): "network" | "cache" {
  return lastIncidentDetailSource;
}

export async function updateIncidentStatus(
  incidentId: number,
  payload: UpdateIncidentStatusInput,
): Promise<CreateIncidentResponse> {
  ensurePositiveInt(incidentId, "incidentId");
  const response = await signedJsonRequest<RawCreateIncidentResponse>({
    method: "PATCH",
    path: `/incidents/${incidentId}/status`,
    data: payload,
  });
  return {
    ...response,
    incident: normalizeIncidentRecord({
      ...response.incident,
      photos: [],
    }),
  };
}

export async function updateIncidentEvidence(
  incidentId: number,
  payload: UpdateIncidentEvidenceInput,
): Promise<CreateIncidentResponse> {
  ensurePositiveInt(incidentId, "incidentId");
  const response = await signedJsonRequest<RawCreateIncidentResponse>({
    method: "PATCH",
    path: `/incidents/${incidentId}/evidence`,
    data: payload,
  });
  return {
    ...response,
    incident: normalizeIncidentRecord({
      ...response.incident,
      photos: [],
    }),
  };
}

export async function deleteIncident(
  incidentId: number,
): Promise<DeleteIncidentResponse> {
  ensurePositiveInt(incidentId, "incidentId");
  return signedJsonRequest<DeleteIncidentResponse>({
    method: "DELETE",
    path: `/incidents/${incidentId}`,
  });
}

export async function listInstallations(
  options: { forceRefresh?: boolean } = {},
): Promise<InstallationRecord[]> {
  const now = Date.now();
  if (
    !options.forceRefresh &&
    installationsCache &&
    installationsCacheExpiresAt > now
  ) {
    return installationsCache;
  }

  const records = await signedJsonRequest<RawInstallationRecord[]>({
    method: "GET",
    path: "/installations",
  });
  const normalizedRecords = normalizeInstallationRecords(records);
  installationsCache = normalizedRecords;
  installationsCacheExpiresAt = now + INSTALLATIONS_CACHE_TTL_MS;
  return normalizedRecords;
}

export function clearInstallationsCache(): void {
  installationsCache = null;
  installationsCacheExpiresAt = 0;
}

export async function createInstallationRecord(
  payload: CreateRecordInput,
): Promise<CreateRecordResponse> {
  const response = await signedJsonRequest<RawCreateRecordResponse>({
    method: "POST",
    path: "/records",
    data: payload,
  });
  return {
    ...response,
    record: normalizeInstallationRecord(response.record),
  };
}

export async function updateInstallationRecord(
  installationId: number,
  payload: UpdateInstallationInput,
): Promise<UpdateInstallationResponse> {
  ensurePositiveInt(installationId, "installationId");
  const response = await signedJsonRequest<RawUpdateInstallationResponse>({
    method: "PUT",
    path: `/installations/${installationId}`,
    data: payload,
  });
  clearInstallationsCache();
  return {
    ...response,
    installation: normalizeInstallationRecord(response.installation),
  };
}
