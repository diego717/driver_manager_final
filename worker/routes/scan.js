import { HttpError, normalizeOptionalString } from "../lib/core.js";

const MAX_IMAGE_BASE64_LENGTH = 6_000_000;
const ASSET_EXTERNAL_CODE_MAX_LENGTH = 128;
const ASSET_BRAND_MAX_LENGTH = 120;
const ASSET_MODEL_MAX_LENGTH = 160;
const ASSET_SERIAL_MAX_LENGTH = 128;
const ASSET_CLIENT_MAX_LENGTH = 180;
const ASSET_NOTES_MAX_LENGTH = 2000;

function normalizeAssetField(value, maxLength) {
  return normalizeOptionalString(value, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function normalizeMimeType(rawValue) {
  const normalized = normalizeOptionalString(rawValue, "").toLowerCase();
  if (!normalized) return "image/jpeg";
  if (!/^image\/[a-z0-9.+-]+$/i.test(normalized)) {
    throw new HttpError(400, "Campo 'mime_type' invalido.");
  }
  return normalized;
}

function parseImageBase64Payload(payload) {
  const data = payload && typeof payload === "object" ? payload : {};
  const rawDataUrl = normalizeOptionalString(data.image_data_url, "").trim();
  const rawBase64 = normalizeOptionalString(data.image_base64, "").trim();
  const fallbackMimeType = normalizeMimeType(data.mime_type);

  let mimeType = fallbackMimeType;
  let imageBase64 = rawBase64;

  if (rawDataUrl) {
    const match = rawDataUrl.match(/^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i);
    if (!match) {
      throw new HttpError(400, "Campo 'image_data_url' invalido.");
    }
    mimeType = normalizeMimeType(match[1]);
    imageBase64 = normalizeOptionalString(match[2], "").trim();
  }

  if (!imageBase64) {
    throw new HttpError(400, "Debes enviar 'image_base64' o 'image_data_url'.");
  }

  const compactBase64 = imageBase64.replace(/\s+/g, "");
  if (!/^[A-Za-z0-9+/=]+$/.test(compactBase64)) {
    throw new HttpError(400, "Campo 'image_base64' invalido.");
  }
  if (compactBase64.length > MAX_IMAGE_BASE64_LENGTH) {
    throw new HttpError(413, "Imagen demasiado grande para OCR.");
  }

  return {
    mimeType,
    imageBase64: compactBase64,
  };
}

function parseOpenAiJsonContent(rawContent) {
  const content = normalizeOptionalString(rawContent, "").trim();
  if (!content) {
    throw new HttpError(502, "OCR no devolvio contenido util.");
  }
  try {
    return JSON.parse(content);
  } catch {
    throw new HttpError(502, "OCR devolvio una respuesta no parseable.");
  }
}

function normalizeExtractedLabel(rawLabel) {
  const source = rawLabel && typeof rawLabel === "object" ? rawLabel : {};

  const serialNumber = normalizeAssetField(
    source.serial_number ?? source.serial ?? source.sn,
    ASSET_SERIAL_MAX_LENGTH,
  );
  const externalCodeCandidate = normalizeAssetField(
    source.external_code ?? source.externalCode ?? source.code ?? source.asset_code,
    ASSET_EXTERNAL_CODE_MAX_LENGTH,
  );
  const externalCode = externalCodeCandidate || serialNumber;
  const brand = normalizeAssetField(source.brand, ASSET_BRAND_MAX_LENGTH);
  const model = normalizeAssetField(source.model, ASSET_MODEL_MAX_LENGTH);
  const clientName = normalizeAssetField(
    source.client_name ?? source.client,
    ASSET_CLIENT_MAX_LENGTH,
  );
  const notes = normalizeAssetField(source.notes, ASSET_NOTES_MAX_LENGTH);

  if (!externalCode) {
    throw new HttpError(422, "OCR no pudo extraer un codigo externo o serie util.");
  }
  if (!brand && !model) {
    throw new HttpError(422, "OCR no pudo extraer marca o modelo.");
  }
  if (!serialNumber) {
    throw new HttpError(422, "OCR no pudo extraer numero de serie.");
  }

  const confidenceRaw = Number(source.confidence);
  const confidence = Number.isFinite(confidenceRaw)
    ? Math.max(0, Math.min(1, confidenceRaw))
    : null;

  return {
    external_code: externalCode,
    brand,
    model,
    serial_number: serialNumber,
    client_name: clientName,
    notes,
    confidence,
  };
}

async function extractAssetLabelWithOpenAi(env, { mimeType, imageBase64 }) {
  const apiKey = normalizeOptionalString(env?.OPENAI_API_KEY, "").trim();
  if (!apiKey) {
    throw new HttpError(
      503,
      "OCR no configurado: falta OPENAI_API_KEY en el worker.",
    );
  }

  const model = normalizeOptionalString(env?.OPENAI_OCR_MODEL, "").trim() || "gpt-4.1-mini";
  const dataUrl = `data:${mimeType};base64,${imageBase64}`;
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      response_format: { type: "json_object" },
      max_tokens: 400,
      messages: [
        {
          role: "system",
          content:
            "Extrae datos de etiquetas de equipos. Responde SOLO JSON con claves external_code, brand, model, serial_number, client_name, notes, confidence.",
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text:
                "Lee la etiqueta del equipo y devuelve los campos. Si un campo no aparece, devolvelo como cadena vacia. confidence entre 0 y 1.",
            },
            {
              type: "image_url",
              image_url: {
                url: dataUrl,
              },
            },
          ],
        },
      ],
    }),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    throw new HttpError(
      502,
      `OCR externo fallo (${response.status}): ${normalizeOptionalString(errorText, "sin detalle")}`,
    );
  }

  const completion = await response.json();
  const parsed = parseOpenAiJsonContent(
    completion?.choices?.[0]?.message?.content,
  );
  return {
    model,
    label: normalizeExtractedLabel(parsed),
  };
}

export function createScanRouteHandlers({
  jsonResponse,
  readJsonOrThrowBadRequest,
  requireWebWriteRole,
}) {
  async function handleAssetLabelScanRoute(
    request,
    env,
    corsPolicy,
    routeParts,
    isWebRoute,
    webSession,
  ) {
    if (
      routeParts.length !== 2 ||
      routeParts[0] !== "scan" ||
      routeParts[1] !== "asset-label"
    ) {
      return null;
    }

    if (request.method !== "POST") {
      throw new HttpError(405, "Metodo no permitido para /scan/asset-label.");
    }
    if (!isWebRoute) {
      throw new HttpError(401, "OCR de etiquetas requiere sesion web.");
    }

    requireWebWriteRole(webSession?.role);

    const payload = await readJsonOrThrowBadRequest(
      request,
      "Payload OCR invalido.",
      { maxBytes: 8_000_000 },
    );
    const imageInput = parseImageBase64Payload(payload);
    const extracted = await extractAssetLabelWithOpenAi(env, imageInput);

    return jsonResponse(request, env, corsPolicy, {
      success: true,
      provider: "openai",
      model: extracted.model,
      label: extracted.label,
    });
  }

  return {
    handleAssetLabelScanRoute,
  };
}

