import {
  type CreateInstallationConformityInput,
  type CreateInstallationConformityResponse,
  type GetInstallationConformityResponse,
  type InstallationConformity,
  type InstallationConformityStatus,
} from "../types/api";
import { ensurePositiveInt } from "../utils/validation";
import { signedJsonRequest } from "./client";

type RawInstallationConformity = Omit<
  InstallationConformity,
  "id" | "installation_id" | "generated_by_user_id" | "session_version" | "photo_count" | "status"
> & {
  id: number | string;
  installation_id: number | string;
  generated_by_user_id?: number | string | null;
  session_version?: number | string | null;
  photo_count?: number | string | null;
  status?: string | null;
};

type RawCreateInstallationConformityResponse = Omit<CreateInstallationConformityResponse, "conformity"> & {
  conformity: RawInstallationConformity;
};

type RawGetInstallationConformityResponse = Omit<GetInstallationConformityResponse, "conformity"> & {
  conformity: RawInstallationConformity | null;
};

function normalizePositiveId(value: number | string, field: string): number {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);
    if (Number.isInteger(parsed) && parsed > 0) {
      return parsed;
    }
  }
  throw new Error(`${field} invalido recibido desde API.`);
}

function normalizeConformityStatus(value: unknown): InstallationConformityStatus {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "emailed") return "emailed";
  if (normalized === "email_failed") return "email_failed";
  return "generated";
}

function normalizeOptionalNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.trunc(parsed);
}

function normalizeInstallationConformity(
  conformity: RawInstallationConformity,
): InstallationConformity {
  return {
    ...conformity,
    id: normalizePositiveId(conformity.id, "conformity.id"),
    installation_id: normalizePositiveId(conformity.installation_id, "conformity.installation_id"),
    generated_by_user_id: normalizeOptionalNumber(conformity.generated_by_user_id),
    session_version: normalizeOptionalNumber(conformity.session_version),
    photo_count: Math.max(0, normalizeOptionalNumber(conformity.photo_count) ?? 0),
    status: normalizeConformityStatus(conformity.status),
  };
}

export async function createInstallationConformity(
  installationId: number,
  payload: CreateInstallationConformityInput,
): Promise<CreateInstallationConformityResponse> {
  ensurePositiveInt(installationId, "installationId");
  const response = await signedJsonRequest<RawCreateInstallationConformityResponse>({
    method: "POST",
    path: `/installations/${installationId}/conformity`,
    data: payload,
  });

  return {
    ...response,
    conformity: normalizeInstallationConformity(response.conformity),
  };
}

export async function getInstallationConformity(
  installationId: number,
): Promise<InstallationConformity | null> {
  ensurePositiveInt(installationId, "installationId");
  const response = await signedJsonRequest<RawGetInstallationConformityResponse>({
    method: "GET",
    path: `/installations/${installationId}/conformity`,
  });
  return response.conformity ? normalizeInstallationConformity(response.conformity) : null;
}
