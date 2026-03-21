import { ensurePositiveInt } from "../utils/validation";
import { signedJsonRequest } from "./client";

export interface AssetRecord {
  id: number;
  tenant_id: string;
  external_code: string;
  brand?: string;
  serial_number?: string;
  model?: string;
  client_name?: string;
  notes?: string;
  status?: string;
  created_at?: string;
  updated_at?: string;
}

export interface ResolveAssetResponse {
  success: boolean;
  created: boolean;
  asset: AssetRecord;
}

export interface LinkAssetInstallationResponse {
  success: boolean;
  link: {
    id: number | null;
    tenant_id: string;
    asset_id: number;
    installation_id: number;
    linked_at: string;
    linked_by_username?: string | null;
  };
}

export interface ListAssetsResponse {
  success: boolean;
  items: AssetRecord[];
}

export interface AssetIncidentRecord {
  id: number;
  installation_id: number;
  asset_id?: number | null;
  reporter_username?: string;
  note?: string;
  time_adjustment_seconds?: number;
  estimated_duration_seconds?: number | null;
  work_started_at?: string | null;
  work_ended_at?: string | null;
  actual_duration_seconds?: number | null;
  severity?: string;
  source?: string;
  created_at?: string;
  incident_status?: "open" | "in_progress" | "paused" | "resolved";
  status_updated_at?: string | null;
  status_updated_by?: string | null;
  resolved_at?: string | null;
  resolved_by?: string | null;
  resolution_note?: string | null;
  installation_client_name?: string | null;
  installation_brand?: string | null;
  installation_version?: string | null;
  photos?: Array<{
    id: number;
    incident_id: number;
    r2_key: string;
    file_name: string;
    content_type: string;
    size_bytes: number;
    sha256: string | null;
    created_at: string;
  }>;
}

export interface AssetIncidentsResponse {
  success: boolean;
  asset: AssetRecord;
  active_link?: {
    id: number | null;
    installation_id: number;
    linked_at?: string;
    unlinked_at?: string | null;
    linked_by_username?: string | null;
    notes?: string | null;
  } | null;
  links: Array<{
    id: number | null;
    installation_id: number;
    linked_at?: string;
    unlinked_at?: string | null;
    linked_by_username?: string | null;
    notes?: string | null;
    installation_client_name?: string | null;
    installation_brand?: string | null;
    installation_version?: string | null;
    installation_status?: string | null;
  }>;
  incidents: AssetIncidentRecord[];
}

export interface ResolveAssetPayload {
  brand?: string;
  serial_number?: string;
  model?: string;
  client_name?: string;
  notes?: string;
  status?: string;
  update_existing?: boolean;
}

export interface UpdateAssetPayload {
  brand?: string;
  serial_number?: string;
  model?: string;
  client_name?: string;
  notes?: string;
  status?: string;
}

export async function resolveAssetByExternalCode(
  externalCode: string,
  payload?: ResolveAssetPayload,
): Promise<ResolveAssetResponse> {
  const normalizedExternalCode = String(externalCode || "").trim();
  if (!normalizedExternalCode) {
    throw new Error("Codigo externo de equipo requerido.");
  }

  return signedJsonRequest<ResolveAssetResponse>({
    method: "POST",
    path: "/assets/resolve",
    data: {
      external_code: normalizedExternalCode,
      ...(payload || {}),
    },
  });
}

export async function linkAssetToInstallation(
  assetId: number,
  installationId: number,
  notes?: string,
): Promise<LinkAssetInstallationResponse> {
  ensurePositiveInt(assetId, "assetId");
  ensurePositiveInt(installationId, "installationId");

  return signedJsonRequest<LinkAssetInstallationResponse>({
    method: "POST",
    path: `/assets/${assetId}/link-installation`,
    data: {
      installation_id: installationId,
      notes: typeof notes === "string" ? notes.trim() : "",
    },
  });
}

export async function listAssets(params?: {
  code?: string;
  search?: string;
  status?: string;
  limit?: number;
}): Promise<AssetRecord[]> {
  const query = new URLSearchParams();
  if (params?.code) query.set("code", String(params.code).trim());
  if (params?.search) query.set("search", String(params.search).trim());
  if (params?.status) query.set("status", String(params.status).trim());
  if (params?.limit) query.set("limit", String(params.limit));

  const suffix = query.toString();
  const response = await signedJsonRequest<ListAssetsResponse>({
    method: "GET",
    path: suffix ? `/assets?${suffix}` : "/assets",
  });
  return Array.isArray(response?.items) ? response.items : [];
}

export async function getAssetIncidents(
  assetId: number,
  params?: { limit?: number },
): Promise<AssetIncidentsResponse> {
  ensurePositiveInt(assetId, "assetId");
  const query = new URLSearchParams();
  if (params?.limit && Number.isInteger(params.limit) && params.limit > 0) {
    query.set("limit", String(params.limit));
  }

  const suffix = query.toString();
  return signedJsonRequest<AssetIncidentsResponse>({
    method: "GET",
    path: suffix ? `/assets/${assetId}/incidents?${suffix}` : `/assets/${assetId}/incidents`,
  });
}

export async function updateAsset(
  assetId: number,
  payload: UpdateAssetPayload,
): Promise<ResolveAssetResponse> {
  ensurePositiveInt(assetId, "assetId");
  return signedJsonRequest<ResolveAssetResponse>({
    method: "PATCH",
    path: `/assets/${assetId}`,
    data: payload,
  });
}

export async function deleteAsset(assetId: number): Promise<void> {
  ensurePositiveInt(assetId, "assetId");
  await signedJsonRequest<{ success: boolean }>({
    method: "DELETE",
    path: `/assets/${assetId}`,
  });
}
