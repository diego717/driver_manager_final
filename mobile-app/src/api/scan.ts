import { signedJsonRequest } from "./client";

export type LookupEntityType = "installation" | "asset";

export interface LookupCodeResponse {
  success: boolean;
  match: {
    type: LookupEntityType;
    installation_id?: number | null;
    asset_record_id?: number | null;
    asset_id?: string | null;
    external_code?: string | null;
  };
}

export interface AssetLabelScanResult {
  external_code: string;
  brand: string;
  model: string;
  serial_number: string;
  client_name: string;
  notes: string;
  confidence?: number | null;
}

export interface ScanAssetLabelResponse {
  success: boolean;
  provider?: string;
  model?: string;
  label: AssetLabelScanResult;
}

export async function lookupCode(
  code: string,
  type: LookupEntityType,
): Promise<LookupCodeResponse> {
  const normalizedCode = code.trim();
  if (!normalizedCode) {
    throw new Error("Codigo requerido.");
  }

  const query = new URLSearchParams({ code: normalizedCode, type });
  return signedJsonRequest<LookupCodeResponse>({
    method: "GET",
    path: `/lookup?${query.toString()}`,
  });
}

export async function extractAssetLabelFromImage(input: {
  imageBase64: string;
  mimeType?: string;
}): Promise<ScanAssetLabelResponse> {
  const imageBase64 = String(input.imageBase64 || "").replace(/\s+/g, "").trim();
  if (!imageBase64) {
    throw new Error("Imagen requerida para detectar la etiqueta.");
  }
  if (imageBase64.length > 6_000_000) {
    throw new Error("Imagen demasiado grande para detectar etiqueta.");
  }
  const mimeType = String(input.mimeType || "image/jpeg").trim() || "image/jpeg";

  return signedJsonRequest<ScanAssetLabelResponse>({
    method: "POST",
    path: "/scan/asset-label",
    data: {
      image_base64: imageBase64,
      mime_type: mimeType,
    },
  });
}
