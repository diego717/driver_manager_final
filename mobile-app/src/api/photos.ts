import * as FileSystem from "expo-file-system/legacy";
import CryptoJS from "crypto-js";

import { sha256HexFromString } from "./auth";
import { getResolvedApiBaseUrl, resolveRequestAuth } from "./client";
import { type UploadPhotoResponse } from "../types/api";
import {
  contentTypeFromFileName,
  ensureNonEmpty,
  ensurePositiveInt,
} from "../utils/validation";

const MAX_UPLOAD_PHOTO_BYTES = 5 * 1024 * 1024;
const MIN_UPLOAD_PHOTO_BYTES = 1024;
const FILE_READ_CHUNK_BYTES = 256 * 1024;

function wordArrayToUint8Array(wordArray: CryptoJS.lib.WordArray): Uint8Array {
  const { words, sigBytes } = wordArray;
  const result = new Uint8Array(sigBytes);
  let index = 0;
  for (let i = 0; i < sigBytes; i += 1) {
    const word = words[(i / 4) | 0];
    result[index] = (word >> (24 - (i % 4) * 8)) & 0xff;
    index += 1;
  }
  return result;
}


function sha256HexFromBlobChunked(blob: Blob): Promise<string> {
  const hasher = CryptoJS.algo.SHA256.create();
  const totalSize = blob.size;
  let offset = 0;

  const processNextChunk = async (): Promise<string> => {
    if (offset >= totalSize) {
      return hasher.finalize().toString(CryptoJS.enc.Hex);
    }

    const chunk = blob.slice(offset, offset + FILE_READ_CHUNK_BYTES);
    const chunkBuffer = await chunk.arrayBuffer();
    const chunkBytes = new Uint8Array(chunkBuffer);
    hasher.update(CryptoJS.lib.WordArray.create(chunkBytes as unknown as number[]));
    offset += chunkBytes.byteLength;
    return processNextChunk();
  };

  return processNextChunk();
}

async function readFileBodyAndHashChunked(
  fileUri: string,
  totalBytes: number,
): Promise<{ body: ArrayBuffer; bodyHash: string }> {
  const hasher = CryptoJS.algo.SHA256.create();
  const payload = new Uint8Array(totalBytes);
  let offset = 0;

  while (offset < totalBytes) {
    const length = Math.min(FILE_READ_CHUNK_BYTES, totalBytes - offset);
    const base64Chunk = await FileSystem.readAsStringAsync(fileUri, {
      encoding: FileSystem.EncodingType.Base64,
      position: offset,
      length,
    });
    const parsedChunk = CryptoJS.enc.Base64.parse(base64Chunk);
    const chunkBytes = wordArrayToUint8Array(parsedChunk);
    if (chunkBytes.byteLength === 0) {
      throw new Error("No se pudo leer el archivo para subida.");
    }

    payload.set(chunkBytes, offset);
    hasher.update(parsedChunk);
    offset += chunkBytes.byteLength;
  }

  if (offset !== totalBytes) {
    throw new Error("No se pudo leer el archivo completo para subida.");
  }

  return {
    body: payload.buffer,
    bodyHash: hasher.finalize().toString(CryptoJS.enc.Hex),
  };
}

async function buildBlobFromUri(fileUri: string): Promise<Blob | null> {
  if (typeof Blob === "undefined") {
    return null;
  }

  try {
    const response = await fetch(fileUri);
    if (!response.ok) {
      return null;
    }
    return response.blob();
  } catch {
    return null;
  }
}

function joinUrl(baseUrl: string, path: string): string {
  const cleanBase = baseUrl.replace(/\/+$/, "");
  const cleanPath = path.startsWith("/") ? path : `/${path}`;
  return `${cleanBase}${cleanPath}`;
}

export interface IncidentPhotoPreviewTarget {
  uri: string;
  headers: Record<string, string>;
}

function base64FromArrayBuffer(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const wordArray = CryptoJS.lib.WordArray.create(bytes as unknown as number[]);
  return CryptoJS.enc.Base64.stringify(wordArray);
}

export async function resolveIncidentPhotoPreviewTarget(
  photoId: number,
): Promise<IncidentPhotoPreviewTarget> {
  ensurePositiveInt(photoId, "photoId");
  const apiBaseUrl = await getResolvedApiBaseUrl();
  ensureNonEmpty(apiBaseUrl, "EXPO_PUBLIC_API_BASE_URL");

  const requestAuth = await resolveRequestAuth({
    method: "GET",
    path: `/photos/${photoId}`,
    bodyHash: sha256HexFromString(""),
  });

  return {
    uri: joinUrl(apiBaseUrl, requestAuth.path),
    headers: requestAuth.headers,
  };
}

export async function fetchIncidentPhotoDataUri(photoId: number): Promise<string> {
  const target = await resolveIncidentPhotoPreviewTarget(photoId);
  const response = await fetch(target.uri, {
    method: "GET",
    headers: target.headers,
  });

  if (!response.ok) {
    throw new Error(`No se pudo descargar foto #${photoId} (HTTP ${response.status}).`);
  }

  const contentType = response.headers.get("Content-Type") || "image/jpeg";
  const buffer = await response.arrayBuffer();
  const base64 = base64FromArrayBuffer(buffer);
  return `data:${contentType};base64,${base64}`;
}

export async function uploadIncidentPhoto({
  incidentId,
  fileUri,
  fileName,
  contentType,
}: {
  incidentId: number;
  fileUri: string;
  fileName?: string;
  contentType?: string;
}): Promise<UploadPhotoResponse> {
  ensurePositiveInt(incidentId, "incidentId");
  ensureNonEmpty(fileUri, "fileUri");
  const apiBaseUrl = await getResolvedApiBaseUrl();
  ensureNonEmpty(apiBaseUrl, "EXPO_PUBLIC_API_BASE_URL");

  const finalFileName = fileName ?? `incident_${incidentId}.jpg`;
  const finalContentType = contentType ?? contentTypeFromFileName(finalFileName);
  const path = `/incidents/${incidentId}/photos`;

  const info = await FileSystem.getInfoAsync(fileUri, { size: true });
  const totalBytes = "size" in info && typeof info.size === "number" ? info.size : 0;

  if (totalBytes < MIN_UPLOAD_PHOTO_BYTES) {
    throw new Error("Imagen demasiado pequena o corrupta.");
  }
  if (totalBytes > MAX_UPLOAD_PHOTO_BYTES) {
    const sizeMb = (totalBytes / (1024 * 1024)).toFixed(1);
    throw new Error(`Imagen demasiado grande (${sizeMb}MB). Maximo: 5MB.`);
  }

  const blob = await buildBlobFromUri(fileUri);
  let requestBody: BodyInit;
  let bodyHash: string;

  if (blob && blob.size === totalBytes) {
    requestBody = blob;
    bodyHash = await sha256HexFromBlobChunked(blob);
  } else {
    const fallbackPayload = await readFileBodyAndHashChunked(fileUri, totalBytes);
    requestBody = fallbackPayload.body as unknown as BodyInit;
    bodyHash = fallbackPayload.bodyHash;
  }

  const requestAuth = await resolveRequestAuth({
    method: "POST",
    path,
    bodyHash,
  });

  const response = await fetch(joinUrl(apiBaseUrl, requestAuth.path), {
    method: "POST",
    headers: {
      "Content-Type": finalContentType,
      "X-File-Name": finalFileName,
      ...requestAuth.headers,
    },
    body: requestBody,
  });

  let body: UploadPhotoResponse | { error?: { message?: string } } | null = null;
  try {
    body = (await response.json()) as UploadPhotoResponse | { error?: { message?: string } };
  } catch {
    body = null;
  }
  if (!response.ok) {
    const message =
      typeof body === "object" && body && "error" in body
        ? body.error?.message || "Photo upload failed."
        : "Photo upload failed.";
    throw new Error(`${message} (HTTP ${response.status})`);
  }

  if (!body || typeof body !== "object" || !("photo" in body)) {
    throw new Error("Respuesta invalida al subir foto.");
  }
  return body as UploadPhotoResponse;
}
