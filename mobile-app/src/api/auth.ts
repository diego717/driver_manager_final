import CryptoJS from "crypto-js";

import { unixTimestampSeconds } from "../utils/time";

export interface AuthMaterial {
  token: string;
  secret: string;
}

export function getAuthMaterial(): AuthMaterial {
  const token = process.env.EXPO_PUBLIC_API_TOKEN ?? "";
  const secret = process.env.EXPO_PUBLIC_API_SECRET ?? "";
  return { token, secret };
}

export function sha256HexFromString(input: string): string {
  return CryptoJS.SHA256(input).toString(CryptoJS.enc.Hex);
}

export function sha256HexFromBytes(bytes: Uint8Array): string {
  const wordArray = CryptoJS.lib.WordArray.create(bytes as unknown as number[]);
  return CryptoJS.SHA256(wordArray).toString(CryptoJS.enc.Hex);
}

export function buildCanonical({
  method,
  path,
  timestamp,
  bodyHash,
}: {
  method: string;
  path: string;
  timestamp: string;
  bodyHash: string;
}): string {
  return `${method.toUpperCase()}|${path}|${timestamp}|${bodyHash}`;
}

export function hmacSha256Hex(secret: string, message: string): string {
  return CryptoJS.HmacSHA256(message, secret).toString(CryptoJS.enc.Hex);
}

export function buildAuthHeaders({
  method,
  path,
  bodyHash,
  token,
  secret,
}: {
  method: string;
  path: string;
  bodyHash: string;
  token?: string;
  secret?: string;
}): Record<string, string> {
  const timestamp = unixTimestampSeconds();
  const finalToken = token ?? getAuthMaterial().token;
  const finalSecret = secret ?? getAuthMaterial().secret;

  if (!finalToken || !finalSecret) {
    return {
      "X-Request-Timestamp": timestamp,
      "X-Request-Signature": "dev-signature",
    };
  }

  const canonical = buildCanonical({
    method,
    path,
    timestamp,
    bodyHash,
  });
  const signature = hmacSha256Hex(finalSecret, canonical);

  return {
    "X-API-Token": finalToken,
    "X-Request-Timestamp": timestamp,
    "X-Request-Signature": signature,
  };
}
