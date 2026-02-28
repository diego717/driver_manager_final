export type ScanEntityType = "installation" | "asset";

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
    };

const DM_URI_PATTERN = /^dm:\/\/(installation|asset)\/([^/?#]+)$/i;

export function parseScannedPayload(input: string): ParsedScanPayload | null {
  const raw = input.trim();
  if (!raw) return null;

  const dmMatch = raw.match(DM_URI_PATTERN);
  if (dmMatch) {
    const type = dmMatch[1].toLowerCase() as ScanEntityType;
    const payload = decodeURIComponent(dmMatch[2]);

    if (type === "installation") {
      const installationId = Number.parseInt(payload, 10);
      if (!Number.isInteger(installationId) || installationId <= 0) {
        return null;
      }
      return { type, raw, installationId };
    }

    if (!payload.trim()) return null;
    return { type, raw, externalCode: payload.trim() };
  }

  if (/^\d+$/.test(raw)) {
    const installationId = Number.parseInt(raw, 10);
    if (Number.isInteger(installationId) && installationId > 0) {
      return { type: "installation", raw, installationId };
    }
  }

  return null;
}

