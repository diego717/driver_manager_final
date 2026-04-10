import type { ParsedAssetLabelData } from "./scan";

export type PreviewValidationErrors = Partial<Record<keyof ParsedAssetLabelData, string>>;

function normalizeIdentifier(value: string): string {
  return String(value || "")
    .trim()
    .replace(/\s+/g, "")
    .toUpperCase();
}

function normalizeText(value: string): string {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ");
}

export function normalizePreviewLabelDraft(draft: ParsedAssetLabelData): ParsedAssetLabelData {
  const externalCode = normalizeIdentifier(draft.external_code);
  const serialNumber = normalizeIdentifier(draft.serial_number) || externalCode;

  return {
    external_code: externalCode,
    brand: normalizeText(draft.brand),
    model: normalizeText(draft.model),
    serial_number: serialNumber,
    client_name: normalizeText(draft.client_name),
    notes: normalizeText(draft.notes),
  };
}

export function validatePreviewLabelDraft(draft: ParsedAssetLabelData): {
  isValid: boolean;
  errors: PreviewValidationErrors;
} {
  const errors: PreviewValidationErrors = {};
  const normalized = normalizePreviewLabelDraft(draft);

  if (!normalized.external_code) {
    errors.external_code = "Codigo externo requerido.";
  }
  if (!normalized.serial_number) {
    errors.serial_number = "Serie requerida.";
  }

  return {
    isValid: Object.keys(errors).length === 0,
    errors,
  };
}

export function normalizeAssetIdentifierForCompare(value: string): string {
  return normalizeIdentifier(value);
}

