import {
  type CreateIncidentInput,
  type CreateIncidentResponse,
  type InstallationRecord,
  type ListIncidentsResponse,
} from "../types/api";
import { ensurePositiveInt } from "../utils/validation";
import { signedJsonRequest } from "./client";

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

export async function listInstallations(): Promise<InstallationRecord[]> {
  return signedJsonRequest<InstallationRecord[]>({
    method: "GET",
    path: "/installations",
  });
}
