import { parseAssetLabelCandidateFromTextLines } from "@/src/utils/asset-label-ocr";
import type { ParsedAssetLabelData } from "@/src/utils/scan";

export type OnDeviceAssetLabelResult = {
  supported: boolean;
  lines: string[];
  label: ParsedAssetLabelData | null;
  confidence: number | null;
};

type TextExtractorModule = {
  isSupported: boolean;
  extractTextFromImage: (uri: string) => Promise<string[]>;
};

async function loadTextExtractorModule(): Promise<TextExtractorModule | null> {
  try {
    const module = await import("expo-text-extractor");
    return {
      isSupported: Boolean(module?.isSupported),
      extractTextFromImage: module.extractTextFromImage,
    };
  } catch {
    return null;
  }
}

export async function extractAssetLabelOnDevice(imageUri: string): Promise<OnDeviceAssetLabelResult> {
  const normalizedUri = String(imageUri || "").trim();
  if (!normalizedUri) {
    throw new Error("Imagen requerida para OCR local.");
  }

  const textExtractor = await loadTextExtractorModule();
  if (!textExtractor || !textExtractor.isSupported) {
    return {
      supported: false,
      lines: [],
      label: null,
      confidence: null,
    };
  }

  const lines = await textExtractor.extractTextFromImage(normalizedUri);
  const normalizedLines = Array.isArray(lines)
    ? lines.map((line) => String(line || "").trim()).filter(Boolean)
    : [];

  const parsed = parseAssetLabelCandidateFromTextLines(normalizedLines);

  return {
    supported: true,
    lines: normalizedLines,
    label: parsed.label,
    confidence: parsed.confidence,
  };
}
