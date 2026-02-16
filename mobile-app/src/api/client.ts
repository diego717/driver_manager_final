import axios, { AxiosError, type AxiosRequestConfig } from "axios";

import {
  buildAuthHeaders,
  getAuthMaterial,
  sha256HexFromString,
} from "./auth";
import { getStoredApiSecret, getStoredApiToken } from "../storage/secure";

const baseURL = process.env.EXPO_PUBLIC_API_BASE_URL ?? "";

if (!baseURL) {
  // Keep an explicit warning for dev builds; requests will fail if baseURL stays empty.
  // eslint-disable-next-line no-console
  console.warn("EXPO_PUBLIC_API_BASE_URL is empty.");
}

export const apiClient = axios.create({
  baseURL,
  timeout: 20000,
});

function normalizePath(path: string): string {
  if (path.startsWith("http://") || path.startsWith("https://")) {
    return new URL(path).pathname;
  }
  return path.startsWith("/") ? path : `/${path}`;
}

async function resolveAuth() {
  const envAuth = getAuthMaterial();
  if (envAuth.token && envAuth.secret) return envAuth;

  const [storedToken, storedSecret] = await Promise.all([
    getStoredApiToken(),
    getStoredApiSecret(),
  ]);
  return {
    token: storedToken ?? envAuth.token,
    secret: storedSecret ?? envAuth.secret,
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
  const normalizedPath = normalizePath(path);
  const rawBody =
    data === undefined ? "" : JSON.stringify(data);
  const bodyHash = sha256HexFromString(rawBody);
  const auth = await resolveAuth();
  const authHeaders = buildAuthHeaders({
    method,
    path: normalizedPath,
    bodyHash,
    token: auth.token,
    secret: auth.secret,
  });

  const response = await apiClient.request<T>({
    method,
    url: normalizedPath,
    data,
    ...config,
    headers: {
      "Content-Type": "application/json",
      ...(config?.headers ?? {}),
      ...authHeaders,
    },
  });

  return response.data;
}

export function getApiBaseUrl(): string {
  return baseURL;
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
