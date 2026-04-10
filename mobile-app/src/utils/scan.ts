export type ScanEntityType = "installation" | "asset";

export type ParsedAssetLabelData = {
  external_code: string;
  brand: string;
  model: string;
  serial_number: string;
  client_name: string;
  notes: string;
};

export type ParsedScanPayload =
  | {
      type: "installation";
      raw: string;
      installationId: number;
    }
  | {
      type: "asset";
      raw: string;
      externalCode: string;
      assetData: ParsedAssetLabelData | null;
    };

const DM_URI_PATTERN = /^dm:\/\/(installation|asset)\/([^?#]+)(?:\?([^#]*))?$/i;
const ASSET_CODE_MAX_LENGTH = 128;
const ASSET_BRAND_MAX_LENGTH = 120;
const ASSET_MODEL_MAX_LENGTH = 160;
const ASSET_SERIAL_MAX_LENGTH = 128;
const ASSET_CLIENT_MAX_LENGTH = 180;
const ASSET_NOTES_MAX_LENGTH = 2000;

function normalizeAssetMetadataValue(value: string, maxLength: number): string {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, maxLength);
}

function parseAssetMetadataFromQuery(
  rawQueryString: string,
  externalCode: string,
): ParsedAssetLabelData | null {
  const queryString = String(rawQueryString || "").trim();
  if (!queryString) return null;

  let params: URLSearchParams;
  try {
    params = new URLSearchParams(queryString);
  } catch {
    return null;
  }

  const readFirst = (...keys: string[]): string => {
    for (const key of keys) {
      const value = params.get(key);
      if (value !== null && value !== undefined) {
        return value;
      }
    }
    return "";
  };

  const normalizedExternalCode = normalizeAssetMetadataValue(
    externalCode || readFirst("external_code", "code", "asset_code"),
    ASSET_CODE_MAX_LENGTH,
  );
  if (!normalizedExternalCode) return null;

  const brand = normalizeAssetMetadataValue(readFirst("brand", "b"), ASSET_BRAND_MAX_LENGTH);
  const model = normalizeAssetMetadataValue(readFirst("model", "m"), ASSET_MODEL_MAX_LENGTH);
  const serialNumber = normalizeAssetMetadataValue(
    readFirst("serial_number", "serial", "sn", "s"),
    ASSET_SERIAL_MAX_LENGTH,
  );
  const clientName = normalizeAssetMetadataValue(
    readFirst("client_name", "client", "c"),
    ASSET_CLIENT_MAX_LENGTH,
  );
  const notes = normalizeAssetMetadataValue(
    readFirst("notes", "note", "n"),
    ASSET_NOTES_MAX_LENGTH,
  );

  if (!brand && !model && !serialNumber && !clientName && !notes) {
    return null;
  }

  return {
    external_code: normalizedExternalCode,
    brand,
    model,
    serial_number: serialNumber,
    client_name: clientName,
    notes,
  };
}

export function parseScannedPayload(input: string): ParsedScanPayload | null {
  const raw = input.trim();
  if (!raw) return null;

  const dmMatch = raw.match(DM_URI_PATTERN);
  if (dmMatch) {
    const type = dmMatch[1].toLowerCase() as ScanEntityType;
    const payload = decodeURIComponent(dmMatch[2]);
    const queryString = String(dmMatch[3] || "").trim();

    if (type === "installation") {
      const installationId = Number.parseInt(payload, 10);
      if (!Number.isInteger(installationId) || installationId <= 0) {
        return null;
      }
      return { type, raw, installationId };
    }

    if (!payload.trim()) return null;
    const externalCode = payload.trim();
    return {
      type,
      raw,
      externalCode,
      assetData: parseAssetMetadataFromQuery(queryString, externalCode),
    };
  }

  if (/^\d+$/.test(raw)) {
    const installationId = Number.parseInt(raw, 10);
    if (Number.isInteger(installationId) && installationId > 0) {
      return { type: "installation", raw, installationId };
    }
  }

  return null;
}
