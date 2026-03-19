import { extractApiError, getResolvedApiBaseUrl, resolveRequestAuth, signedJsonRequest } from "./client";

export interface DriverRecord {
  tenant_id: string;
  brand: string;
  version: string;
  description?: string;
  key: string;
  filename: string;
  uploaded: string;
  last_modified?: string;
  size_bytes?: number;
  size_mb?: number;
  download_url?: string;
}

interface ListDriversResponse {
  success: boolean;
  total: number;
  items: DriverRecord[];
}

interface UploadDriverResponse {
  success: boolean;
  driver: DriverRecord;
}

function joinUrl(baseUrl: string, path: string): string {
  const cleanBase = baseUrl.replace(/\/+$/, "");
  const cleanPath = path.startsWith("/") ? path : `/${path}`;
  return `${cleanBase}${cleanPath}`;
}

export async function listDrivers(params?: {
  search?: string;
  brand?: string;
  version?: string;
  limit?: number;
}): Promise<DriverRecord[]> {
  const query = new URLSearchParams();
  if (params?.search) query.set("search", String(params.search).trim());
  if (params?.brand) query.set("brand", String(params.brand).trim());
  if (params?.version) query.set("version", String(params.version).trim());
  if (params?.limit && Number.isInteger(params.limit) && params.limit > 0) {
    query.set("limit", String(params.limit));
  }
  const suffix = query.toString();

  const response = await signedJsonRequest<ListDriversResponse>({
    method: "GET",
    path: suffix ? `/drivers?${suffix}` : "/drivers",
  });

  return Array.isArray(response?.items) ? response.items : [];
}

export async function uploadDriver(payload: {
  fileUri: string;
  fileName: string;
  mimeType?: string;
  brand: string;
  version: string;
  description?: string;
}): Promise<DriverRecord> {
  const apiBaseUrl = await getResolvedApiBaseUrl();
  const requestAuth = await resolveRequestAuth({
    method: "POST",
    path: "/drivers",
    bodyHash: "",
  });

  const form = new FormData();
  form.append("brand", String(payload.brand || "").trim());
  form.append("version", String(payload.version || "").trim());
  form.append("description", String(payload.description || "").trim());
  form.append("file", {
    uri: payload.fileUri,
    name: payload.fileName,
    type: payload.mimeType || "application/octet-stream",
  } as unknown as Blob);

  try {
    const response = await fetch(joinUrl(apiBaseUrl, requestAuth.path), {
      method: "POST",
      headers: {
        ...requestAuth.headers,
      },
      body: form,
    });

    const body = (await response.json()) as UploadDriverResponse | { error?: { message?: string } };
    if (!response.ok) {
      const message =
        typeof body === "object" && body !== null && "error" in body && body.error?.message
          ? body.error.message
          : `No se pudo subir driver (HTTP ${response.status}).`;
      throw new Error(message);
    }

    if (!body || typeof body !== "object" || !("driver" in body) || !body.driver) {
      throw new Error("Respuesta invalida al subir driver.");
    }

    return body.driver;
  } catch (error) {
    throw new Error(extractApiError(error));
  }
}

export async function deleteDriver(key: string): Promise<void> {
  const normalizedKey = String(key || "").trim();
  if (!normalizedKey) {
    throw new Error("Key de driver requerida.");
  }

  await signedJsonRequest<{ success: boolean }>({
    method: "DELETE",
    path: `/drivers?key=${encodeURIComponent(normalizedKey)}`,
  });
}

export async function resolveDriverDownloadUrl(driver: Pick<DriverRecord, "key" | "download_url">): Promise<string> {
  const directUrl = String(driver.download_url || "").trim();
  if (directUrl) {
    if (directUrl.startsWith("http://") || directUrl.startsWith("https://")) {
      return directUrl;
    }
    return joinUrl(await getResolvedApiBaseUrl(), directUrl);
  }

  const normalizedKey = String(driver.key || "").trim();
  if (!normalizedKey) {
    throw new Error("Key de driver requerida.");
  }

  return joinUrl(
    await getResolvedApiBaseUrl(),
    `/web/drivers/download?key=${encodeURIComponent(normalizedKey)}`,
  );
}
