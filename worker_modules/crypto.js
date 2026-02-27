import { HttpError, normalizeOptionalString } from "./core.js";

export async function sha256Hex(bytes) {
  if (!globalThis.crypto?.subtle) {
    return null;
  }

  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function hmacSha256Hex(secret, message) {
  const keyData = new TextEncoder().encode(secret);
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    keyData,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(message));
  return [...new Uint8Array(signature)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function timingSafeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;

  const maxLen = Math.max(a.length, b.length);
  const paddedA = a.padEnd(maxLen, "\0");
  const paddedB = b.padEnd(maxLen, "\0");

  let mismatch = a.length !== b.length ? 1 : 0;
  for (let i = 0; i < maxLen; i += 1) {
    mismatch |= paddedA.charCodeAt(i) ^ paddedB.charCodeAt(i);
  }
  return mismatch === 0;
}

export function bytesToBase64Url(bytes) {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function base64UrlToBytes(input) {
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  const padding = normalized.length % 4 === 0 ? "" : "=".repeat(4 - (normalized.length % 4));
  const decoded = atob(`${normalized}${padding}`);
  const bytes = new Uint8Array(decoded.length);
  for (let i = 0; i < decoded.length; i += 1) {
    bytes[i] = decoded.charCodeAt(i);
  }
  return bytes;
}

export function base64UrlEncodeUtf8(text) {
  return bytesToBase64Url(new TextEncoder().encode(text));
}

export function base64UrlDecodeUtf8(input) {
  return new TextDecoder().decode(base64UrlToBytes(input));
}

export function pemToArrayBuffer(pemText) {
  const normalizedPem = normalizeOptionalString(pemText, "").replace(/\\n/g, "\n");
  const base64Body = normalizedPem
    .replace(/-----BEGIN PRIVATE KEY-----/g, "")
    .replace(/-----END PRIVATE KEY-----/g, "")
    .replace(/\s+/g, "");

  if (!base64Body) {
    throw new HttpError(500, "FCM service account invalido: private_key vacia.");
  }

  const binary = atob(base64Body);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

export function bytesToHex(bytes) {
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}
