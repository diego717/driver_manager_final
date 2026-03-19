import { normalizeAssetCodeForQr, type QrType } from "@/src/utils/qr";

export const MIN_TOUCH_TARGET_SIZE = 44;
const QR_MAX_BRAND_LENGTH = 120;
const QR_MAX_MODEL_LENGTH = 160;
const QR_MAX_SERIAL_LENGTH = 128;
const QR_MAX_CLIENT_LENGTH = 180;
const QR_MAX_NOTES_LENGTH = 2000;

export type QrLabelPreset = "small" | "medium";

export type QrLabelPresetConfig = {
  width: number;
  height: number;
  padding: number;
  qrSize: number;
  textGap: number;
  titleSize: number;
  lineSize: number;
  lineHeight: number;
  titleY: number;
  lineStartY: number;
};

export const QR_LABEL_PRESETS: Record<QrLabelPreset, QrLabelPresetConfig> = {
  small: {
    width: 760,
    height: 340,
    padding: 18,
    qrSize: 260,
    textGap: 18,
    titleSize: 22,
    lineSize: 16,
    lineHeight: 24,
    titleY: 120,
    lineStartY: 150,
  },
  medium: {
    width: 960,
    height: 420,
    padding: 24,
    qrSize: 320,
    textGap: 24,
    titleSize: 28,
    lineSize: 20,
    lineHeight: 30,
    titleY: 150,
    lineStartY: 190,
  },
};

export type AssetFormData = {
  external_code: string;
  brand: string;
  model: string;
  serial_number: string;
  client_name: string;
  notes: string;
};

export type QrLabelRenderState = {
  qrBase64: string;
  lines: string[];
  preset: QrLabelPreset;
};

export type QrRouteParams = {
  qrType?: string | string[];
  installationId?: string | string[];
  externalCode?: string | string[];
  brand?: string | string[];
  model?: string | string[];
  serialNumber?: string | string[];
  clientName?: string | string[];
  notes?: string | string[];
  autoGenerate?: string | string[];
};

export type QrPrefillValues = {
  qrType: string;
  installationId: string;
  externalCode: string;
  brand: string;
  model: string;
  serialNumber: string;
  clientName: string;
  notes: string;
  autoGenerate: boolean;
};

export function normalizeRouteParam(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

export function normalizeAssetFormText(value: string, maxLength: number): string {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, maxLength);
}

export function buildAssetFormData(input: {
  externalCode: string;
  brand: string;
  model: string;
  serialNumber: string;
  clientName: string;
  notes: string;
}): AssetFormData {
  const brand = normalizeAssetFormText(input.brand, QR_MAX_BRAND_LENGTH);
  const model = normalizeAssetFormText(input.model, QR_MAX_MODEL_LENGTH);
  const serialNumber = normalizeAssetFormText(input.serialNumber, QR_MAX_SERIAL_LENGTH);
  const clientName = normalizeAssetFormText(input.clientName, QR_MAX_CLIENT_LENGTH);
  const notes = normalizeAssetFormText(input.notes, QR_MAX_NOTES_LENGTH);

  if (!brand && !model) {
    throw new Error("Debes ingresar al menos marca o modelo.");
  }
  if (!serialNumber) {
    throw new Error("El numero de serie es obligatorio.");
  }

  const externalCode = normalizeAssetCodeForQr(input.externalCode) || normalizeAssetCodeForQr(serialNumber);
  if (!externalCode) {
    throw new Error("No se pudo generar un codigo externo de equipo.");
  }

  return {
    external_code: externalCode,
    brand,
    model,
    serial_number: serialNumber,
    client_name: clientName,
    notes,
  };
}

export function buildAssetDetailsText(asset: AssetFormData): string {
  return [
    "Tipo: Equipo",
    `Codigo externo: ${asset.external_code}`,
    `Marca: ${asset.brand || "-"}`,
    `Modelo: ${asset.model || "-"}`,
    `Serie: ${asset.serial_number || "-"}`,
    `Cliente: ${asset.client_name || "-"}`,
  ].join("\n");
}

export function hasPrefillValues(prefillValues: QrPrefillValues): boolean {
  return Object.values(prefillValues).some((value) => {
    if (typeof value === "boolean") return value;
    return Boolean(value);
  });
}

export function getQrModeHint(hasRoutePrefill: boolean): string {
  if (hasRoutePrefill) {
    return "Modo detalle: datos precargados desde un equipo seleccionado.";
  }
  return "Modo nuevo: crea una etiqueta desde cero.";
}

export function getHelperText(qrType: QrType): string {
  if (qrType === "installation") {
    return "Formato recomendado: dm://installation/{id}.";
  }
  return "Sin conexion: puedes generar QR local. Con sesion web activa: puedes guardar el equipo en la base.";
}

export function buildLabelLines(details: string): string[] {
  return String(details || "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .filter((line) => !line.toLowerCase().startsWith("tipo:"))
    .slice(0, 8);
}

export function mergeSavedAssetValues(saved: Partial<AssetFormData>, asset: AssetFormData): AssetFormData {
  return {
    external_code: normalizeAssetCodeForQr(String(saved.external_code || asset.external_code)),
    brand: normalizeAssetFormText(String(saved.brand ?? asset.brand), QR_MAX_BRAND_LENGTH),
    model: normalizeAssetFormText(String(saved.model ?? asset.model), QR_MAX_MODEL_LENGTH),
    serial_number: normalizeAssetFormText(String(saved.serial_number ?? asset.serial_number), QR_MAX_SERIAL_LENGTH),
    client_name: normalizeAssetFormText(String(saved.client_name ?? asset.client_name), QR_MAX_CLIENT_LENGTH),
    notes: normalizeAssetFormText(String(saved.notes ?? asset.notes), QR_MAX_NOTES_LENGTH),
  };
}
