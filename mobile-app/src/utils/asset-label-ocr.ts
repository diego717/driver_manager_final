import type { ParsedAssetLabelData } from "./scan";

const ASSET_EXTERNAL_CODE_MAX_LENGTH = 128;
const ASSET_BRAND_MAX_LENGTH = 120;
const ASSET_MODEL_MAX_LENGTH = 160;
const ASSET_SERIAL_MAX_LENGTH = 128;
const ASSET_CLIENT_MAX_LENGTH = 180;
const ASSET_NOTES_MAX_LENGTH = 2000;

const COMMON_TOKEN_EXCLUSIONS = new Set([
  "SITEOPS",
  "EQUIPO",
  "ACTIVO",
  "ASSET",
  "CODE",
  "CODIGO",
  "SERIAL",
  "SERIE",
  "MODEL",
  "MODELO",
  "BRAND",
  "MARCA",
  "CLIENT",
  "CLIENTE",
]);

function normalizeField(value: string, maxLength: number): string {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function normalizeOcrLines(lines: string[]): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const raw of lines || []) {
    const cleaned = normalizeField(raw, 300)
      .replace(/[|]+/g, " ")
      .replace(/[“”]/g, '"')
      .replace(/[‘’]/g, "'");
    if (!cleaned) continue;
    const dedupeKey = cleaned.toUpperCase();
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    normalized.push(cleaned);
  }
  return normalized;
}

function extractByPatterns(line: string, patterns: RegExp[]): string {
  for (const pattern of patterns) {
    const match = line.match(pattern);
    if (match?.[1]) {
      return normalizeField(match[1], 240);
    }
  }
  return "";
}

function pickCodeTokenFallback(lines: string[]): string {
  for (const line of lines) {
    const tokens = line.toUpperCase().match(/[A-Z0-9][A-Z0-9._/-]{3,}/g) || [];
    for (const token of tokens) {
      if (COMMON_TOKEN_EXCLUSIONS.has(token)) continue;
      if (!/[0-9]/.test(token)) continue;
      return token;
    }
  }
  return "";
}

function clampConfidence(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return Math.round(value * 100) / 100;
}

function estimateConfidence(input: {
  hasExternalCode: boolean;
  externalFromPattern: boolean;
  serialFromPattern: boolean;
  hasSerial: boolean;
  hasBrand: boolean;
  hasModel: boolean;
  hasClientName: boolean;
  lineCount: number;
}): number {
  if (!input.hasExternalCode) return 0;

  let score = 0.35;
  score += input.externalFromPattern ? 0.25 : 0.1;
  score += input.serialFromPattern ? 0.2 : input.hasSerial ? 0.1 : 0;
  if (input.hasBrand) score += 0.1;
  if (input.hasModel) score += 0.1;
  if (input.hasClientName) score += 0.05;
  if (input.lineCount <= 1) score -= 0.1;
  return clampConfidence(score);
}

export function parseAssetLabelCandidateFromTextLines(rawLines: string[]): {
  label: ParsedAssetLabelData | null;
  confidence: number | null;
} {
  const lines = normalizeOcrLines(rawLines);
  if (!lines.length) {
    return { label: null, confidence: null };
  }

  let externalCode = "";
  let brand = "";
  let model = "";
  let serialNumber = "";
  let clientName = "";
  let externalFromPattern = false;
  let serialFromPattern = false;

  const externalPatterns = [
    /(?:^|\b)(?:external\s*code|codigo(?:\s*externo)?|asset\s*(?:code|id)|equipo(?:\s*id)?)\s*[:#=\-]\s*([A-Za-z0-9._/-]{3,})/i,
    /(?:^|\b)(?:id)\s*[:#=\-]\s*([A-Za-z0-9._/-]{3,})/i,
  ];
  const serialPatterns = [
    /(?:^|\b)(?:serial(?:\s*number)?|n[úu]mero\s*de\s*serie|num(?:ero)?\s*serie|serie|s\/n|sn)\s*[:#=\-]\s*([A-Za-z0-9._/-]{3,})/i,
  ];
  const brandPatterns = [
    /(?:^|\b)(?:brand|marca)\s*[:#=\-]\s*([^,;|]{2,})/i,
  ];
  const modelPatterns = [
    /(?:^|\b)(?:model|modelo)\s*[:#=\-]\s*([^,;|]{2,})/i,
  ];
  const clientPatterns = [
    /(?:^|\b)(?:client(?:e)?|cliente|empresa|sucursal)\s*[:#=\-]\s*([^,;|]{2,})/i,
  ];

  for (const line of lines) {
    if (!externalCode) {
      const extracted = extractByPatterns(line, externalPatterns);
      if (extracted) {
        externalCode = extracted;
        externalFromPattern = true;
      }
    }
    if (!serialNumber) {
      const extracted = extractByPatterns(line, serialPatterns);
      if (extracted) {
        serialNumber = extracted;
        serialFromPattern = true;
      }
    }
    if (!brand) brand = extractByPatterns(line, brandPatterns);
    if (!model) model = extractByPatterns(line, modelPatterns);
    if (!clientName) clientName = extractByPatterns(line, clientPatterns);
  }

  if (!externalCode) {
    externalCode = pickCodeTokenFallback(lines);
  }
  if (!serialNumber) {
    serialNumber = externalCode;
  }

  externalCode = normalizeField(externalCode, ASSET_EXTERNAL_CODE_MAX_LENGTH);
  serialNumber = normalizeField(serialNumber, ASSET_SERIAL_MAX_LENGTH);
  brand = normalizeField(brand, ASSET_BRAND_MAX_LENGTH);
  model = normalizeField(model, ASSET_MODEL_MAX_LENGTH);
  clientName = normalizeField(clientName, ASSET_CLIENT_MAX_LENGTH);

  if (!externalCode) {
    return { label: null, confidence: null };
  }

  const notes = normalizeField(lines.slice(0, 4).join(" | "), ASSET_NOTES_MAX_LENGTH);
  const label = {
    external_code: externalCode,
    brand,
    model,
    serial_number: serialNumber,
    client_name: clientName,
    notes,
  };
  const confidence = estimateConfidence({
    hasExternalCode: Boolean(externalCode),
    externalFromPattern,
    serialFromPattern,
    hasSerial: Boolean(serialNumber),
    hasBrand: Boolean(brand),
    hasModel: Boolean(model),
    hasClientName: Boolean(clientName),
    lineCount: lines.length,
  });

  return {
    label,
    confidence,
  };
}

export function parseAssetLabelFromTextLines(rawLines: string[]): ParsedAssetLabelData | null {
  return parseAssetLabelCandidateFromTextLines(rawLines).label;
}
