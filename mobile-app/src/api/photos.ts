import * as FileSystem from "expo-file-system/legacy";
import CryptoJS from "crypto-js";

import { sha256HexFromBytes, sha256HexFromString } from "./auth";
import { getResolvedApiBaseUrl, resolveRequestAuth } from "./client";
import { type UploadPhotoResponse } from "../types/api";
import {
  contentTypeFromFileName,
  ensureNonEmpty,
  ensurePositiveInt,
} from "../utils/validation";

const MAX_UPLOAD_PHOTO_BYTES = 5 * 1024 * 1024;
const MIN_UPLOAD_PHOTO_BYTES = 1024;

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

function bytesFromBase64(base64: string): Uint8Array {
  const wordArray = CryptoJS.enc.Base64.parse(base64);
  return wordArrayToUint8Array(wordArray);
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

  const base64 = await FileSystem.readAsStringAsync(fileUri, {
    encoding: FileSystem.EncodingType.Base64,
  });
  const bytes = bytesFromBase64(base64);
  if (bytes.byteLength < MIN_UPLOAD_PHOTO_BYTES) {
    throw new Error("Imagen demasiado pequena o corrupta.");
  }
  if (bytes.byteLength > MAX_UPLOAD_PHOTO_BYTES) {
    const sizeMb = (bytes.byteLength / (1024 * 1024)).toFixed(1);
    throw new Error(`Imagen demasiado grande (${sizeMb}MB). Maximo: 5MB.`);
  }
  const binaryBody = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  );
  const bodyHash = sha256HexFromBytes(bytes);
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
    body: binaryBody as unknown as BodyInit,
  });

  const body = (await response.json()) as UploadPhotoResponse | { error?: { message?: string } };
  if (!response.ok) {
    const message =
      typeof body === "object" && body && "error" in body
        ? body.error?.message || "Photo upload failed."
        : "Photo upload failed.";
    throw new Error(message);
  }

  return body as UploadPhotoResponse;
}
