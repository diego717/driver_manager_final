export const QR_MAX_ASSET_CODE_LENGTH = 128;

export type QrType = "asset" | "installation";

export function normalizeAssetCodeForQr(rawValue: string): string {
  return String(rawValue || "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, QR_MAX_ASSET_CODE_LENGTH);
}

export function buildQrPayload(qrType: QrType, rawValue: string): string {
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
  return `dm://asset/${encodeURIComponent(assetCode)}`;
}
