import * as FileSystem from "expo-file-system/legacy";
import CryptoJS from "crypto-js";

import { sha256HexFromBytes } from "./auth";
import { getResolvedApiBaseUrl, resolveRequestAuth } from "./client";
import { type UploadPhotoResponse } from "../types/api";
import {
  contentTypeFromFileName,
  ensureNonEmpty,
  ensurePositiveInt,
} from "../utils/validation";

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

  const response = await fetch(`${apiBaseUrl}${requestAuth.path}`, {
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
