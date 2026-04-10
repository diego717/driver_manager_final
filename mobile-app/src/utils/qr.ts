export const QR_MAX_ASSET_CODE_LENGTH = 128;
const QR_MAX_BRAND_LENGTH = 120;
const QR_MAX_MODEL_LENGTH = 160;
const QR_MAX_SERIAL_LENGTH = 128;
const QR_MAX_CLIENT_LENGTH = 180;
const QR_MAX_NOTES_LENGTH = 2000;
const QR_EMBEDDED_NOTES_MAX_LENGTH = 320;

export type QrType = "asset" | "installation";
export type AssetQrPayloadMetadata = {
  brand?: string;
  model?: string;
  serial_number?: string;
  client_name?: string;
  notes?: string;
};

export function normalizeAssetCodeForQr(rawValue: string): string {
  return String(rawValue || "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, QR_MAX_ASSET_CODE_LENGTH);
}

function normalizeAssetFormField(rawValue: string, maxLength: number): string {
  return String(rawValue || "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, maxLength);
}

function buildEmbeddedAssetMetadataQuery(
  metadata: AssetQrPayloadMetadata | null | undefined,
): string {
  if (!metadata || typeof metadata !== "object") return "";

  const brand = normalizeAssetFormField(metadata.brand || "", QR_MAX_BRAND_LENGTH);
  const model = normalizeAssetFormField(metadata.model || "", QR_MAX_MODEL_LENGTH);
  const serialNumber = normalizeAssetFormField(
    metadata.serial_number || "",
    QR_MAX_SERIAL_LENGTH,
  );
  const clientName = normalizeAssetFormField(metadata.client_name || "", QR_MAX_CLIENT_LENGTH);
  const notes = normalizeAssetFormField(
    metadata.notes || "",
    Math.min(QR_MAX_NOTES_LENGTH, QR_EMBEDDED_NOTES_MAX_LENGTH),
  );

  if (!brand && !model && !serialNumber && !clientName && !notes) {
    return "";
  }

  const params = new URLSearchParams();
  params.set("v", "2");
  if (brand) params.set("brand", brand);
  if (model) params.set("model", model);
  if (serialNumber) params.set("serial_number", serialNumber);
  if (clientName) params.set("client_name", clientName);
  if (notes) params.set("notes", notes);
  return params.toString();
}

export function buildQrPayload(
  qrType: QrType,
  rawValue: string,
  assetMetadata?: AssetQrPayloadMetadata | null,
): string {
  if (qrType === "installation") {
    const installationId = Number.parseInt(String(rawValue || "").trim(), 10);
    if (!Number.isInteger(installationId) || installationId <= 0) {
      throw new Error("El ID de instalacion debe ser un entero positivo.");
    }
    return `dm://installation/${encodeURIComponent(String(installationId))}`;
  }

  const assetCode = normalizeAssetCodeForQr(rawValue);
  if (!assetCode) {
    throw new Error("El codigo de equipo es obligatorio.");
  }
  const metadataQuery = buildEmbeddedAssetMetadataQuery(assetMetadata);
  if (!metadataQuery) {
    return `dm://asset/${encodeURIComponent(assetCode)}`;
  }
  return `dm://asset/${encodeURIComponent(assetCode)}?${metadataQuery}`;
}
