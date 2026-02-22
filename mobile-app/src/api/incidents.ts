import {
  type CreateRecordInput,
  type CreateRecordResponse,
  type CreateIncidentInput,
  type CreateIncidentResponse,
  type InstallationRecord,
  type ListIncidentsResponse,
} from "../types/api";
import { ensurePositiveInt } from "../utils/validation";
import { signedJsonRequest } from "./client";

const INSTALLATIONS_CACHE_TTL_MS = 60_000;
let installationsCache: InstallationRecord[] | null = null;
let installationsCacheExpiresAt = 0;

type RawInstallationRecord = Omit<InstallationRecord, "id"> & {
  id: number | string;
};

type RawCreateRecordResponse = Omit<CreateRecordResponse, "record"> & {
  record: RawInstallationRecord;
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
  return {
    ...record,
    id: normalizeInstallationId(record.id),
  };
}

function normalizeInstallationRecords(records: RawInstallationRecord[]): InstallationRecord[] {
  return records.map(normalizeInstallationRecord);
}

export async function createIncident(
  installationId: number,
  payload: CreateIncidentInput,
): Promise<CreateIncidentResponse> {
  ensurePositiveInt(installationId, "installationId");
  return signedJsonRequest<CreateIncidentResponse>({
    method: "POST",
    path: `/installations/${installationId}/incidents`,
    data: payload,
  });
}

export async function listIncidentsByInstallation(
  installationId: number,
): Promise<ListIncidentsResponse> {
  ensurePositiveInt(installationId, "installationId");
  return signedJsonRequest<ListIncidentsResponse>({
    method: "GET",
    path: `/installations/${installationId}/incidents`,
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
