import axios, { AxiosError, type AxiosRequestConfig } from "axios";

import {
  buildAuthHeaders,
  getAuthMaterial,
  sha256HexFromString,
} from "./auth";
import {
  clearStoredWebSession,
  getStoredApiBaseUrl,
  getStoredApiSecret,
  getStoredApiToken,
  getStoredWebAccessExpiresAt,
  getStoredWebAccessToken,
} from "../storage/secure";

const envBaseURL = normalizeApiBaseUrl(process.env.EXPO_PUBLIC_API_BASE_URL ?? "");

if (!envBaseURL) {
  // Keep an explicit warning for dev builds; requests will fail if baseURL stays empty.
  // eslint-disable-next-line no-console
  console.warn("EXPO_PUBLIC_API_BASE_URL is empty.");
}

export const apiClient = axios.create({
  baseURL: envBaseURL,
  timeout: 20000,
});

export function normalizeApiBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

function normalizePath(path: string): string {
  if (path.startsWith("http://") || path.startsWith("https://")) {
    return new URL(path).pathname;
  }
  return path.startsWith("/") ? path : `/${path}`;
}

function ensureWebPath(path: string): string {
  return path.startsWith("/web/") ? path : `/web${path}`;
}

function parseIsoToMillis(value: string): number | null {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return null;
  return parsed;
}

async function resolveValidWebAccessToken(): Promise<string | null> {
  const [token, expiresAtIso] = await Promise.all([
    getStoredWebAccessToken(),
    getStoredWebAccessExpiresAt(),
  ]);

  if (!token || !expiresAtIso) return null;

  const expiresAtMs = parseIsoToMillis(expiresAtIso);
  if (expiresAtMs === null || expiresAtMs <= Date.now() + 5000) {
    await clearStoredWebSession();
    return null;
  }

  return token;
}

async function resolveApiBaseUrl(): Promise<string> {
  const storedBaseUrl = await getStoredApiBaseUrl();
  if (storedBaseUrl) {
    return normalizeApiBaseUrl(storedBaseUrl);
  }
  return envBaseURL;
}

async function resolveAuth() {
  const envAuth = getAuthMaterial();
  if (envAuth.token && envAuth.secret) return envAuth;

  const [storedToken, storedSecret] = await Promise.all([
    getStoredApiToken(),
    getStoredApiSecret(),
  ]);
  return {
    token: storedToken || envAuth.token,
    secret: storedSecret || envAuth.secret,
  };
}

export async function resolveRequestAuth({
  method,
  path,
  bodyHash,
}: {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  bodyHash: string;
}): Promise<{ path: string; headers: Record<string, string>; mode: "hmac" | "web" }> {
  const normalizedPath = normalizePath(path);
  const webAccessToken = await resolveValidWebAccessToken();
  if (webAccessToken) {
    return {
      path: ensureWebPath(normalizedPath),
      headers: {
        Authorization: `Bearer ${webAccessToken}`,
      },
      mode: "web",
    };
  }

  const auth = await resolveAuth();
  const authHeaders = buildAuthHeaders({
    method,
    path: normalizedPath,
    bodyHash,
    token: auth.token,
    secret: auth.secret,
  });

  return {
    path: normalizedPath,
    headers: authHeaders,
    mode: "hmac",
  };
}

export async function signedJsonRequest<T>({
  method,
  path,
  data,
  config,
}: {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  data?: unknown;
  config?: AxiosRequestConfig;
}): Promise<T> {
  const baseURL = await resolveApiBaseUrl();
  const rawBody =
    data === undefined ? "" : JSON.stringify(data);
  const bodyHash = sha256HexFromString(rawBody);
  const requestAuth = await resolveRequestAuth({
    method,
    path,
    bodyHash,
  });

  const response = await apiClient.request<T>({
    baseURL,
    method,
    url: requestAuth.path,
    data,
    ...config,
    headers: {
      "Content-Type": "application/json",
      ...(config?.headers ?? {}),
      ...requestAuth.headers,
    },
  });

  return response.data;
}

export function getApiBaseUrl(): string {
  return envBaseURL;
}

export async function getResolvedApiBaseUrl(): Promise<string> {
  return resolveApiBaseUrl();
}

export function extractApiError(error: unknown): string {
  if (!error) return "Unknown error";
  if ((error as AxiosError).isAxiosError) {
    const axiosErr = error as AxiosError<{ error?: { message?: string } }>;
    const apiMsg = axiosErr.response?.data?.error?.message;
    return apiMsg || axiosErr.message;
  }
  if (error instanceof Error) return error.message;
  return String(error);
}
