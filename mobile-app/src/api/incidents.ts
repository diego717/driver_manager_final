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

  const records = await signedJsonRequest<InstallationRecord[]>({
    method: "GET",
    path: "/installations",
  });
  installationsCache = records;
  installationsCacheExpiresAt = now + INSTALLATIONS_CACHE_TTL_MS;
  return records;
}

export function clearInstallationsCache(): void {
  installationsCache = null;
  installationsCacheExpiresAt = 0;
}

export async function createInstallationRecord(
  payload: CreateRecordInput,
): Promise<CreateRecordResponse> {
  return signedJsonRequest<CreateRecordResponse>({
    method: "POST",
    path: "/records",
    data: payload,
  });
}
