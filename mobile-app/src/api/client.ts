import axios, { AxiosError, type AxiosRequestConfig } from "axios";

import { sha256HexFromString } from "./auth";
import {
  clearStoredWebSession,
  getStoredApiBaseUrl,
  getStoredWebAccessExpiresAt,
  getStoredWebAccessToken,
} from "../storage/secure";
import { resolveWebSession } from "./webSession";

const envBaseURL = normalizeApiBaseUrl(process.env.EXPO_PUBLIC_API_BASE_URL ?? "");
const allowHttpApiBaseUrlInDebug =
  process.env.EXPO_PUBLIC_ALLOW_HTTP_API_BASE_URL === "true";
export const WEB_AUTH_TOKEN_TYPE = "Bearer" as const;
export const MOBILE_WEB_CLIENT_PLATFORM = "mobile" as const;

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
  const trimmed = value.trim();
  if (!trimmed) return "";

  const withoutTrailingSlash = trimmed.replace(/\/+$/, "");
  try {
    const parsed = new URL(withoutTrailingSlash);
    // Siempre usar la raiz del dominio para evitar base URLs con paths
    // heredados (ej. /web/installations) que rompen auth/routing.
    return parsed.origin;
  } catch {
    return withoutTrailingSlash;
  }
}

function isLocalDebugHostname(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "10.0.2.2";
}

export function assertSecureApiBaseUrl(
  value: string,
  options?: {
    isDevRuntime?: boolean;
    allowHttpInDebug?: boolean;
  },
): string {
  if (!value) return "";

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(
      "API Base URL invalida. Configura una URL completa (https://...) en Configuracion y acceso.",
    );
  }

  const isDevRuntime = options?.isDevRuntime ?? (typeof __DEV__ !== "undefined" && __DEV__);
  const allowHttpInDebug = options?.allowHttpInDebug ?? allowHttpApiBaseUrlInDebug;
  const canUseLocalHttp =
    isDevRuntime && allowHttpInDebug && isLocalDebugHostname(parsed.hostname);

  if (parsed.protocol === "http:" && !canUseLocalHttp) {
    throw new Error(
      "API Base URL insegura: se requiere https en release. Para debug local usa localhost/127.0.0.1/10.0.2.2 y habilita EXPO_PUBLIC_ALLOW_HTTP_API_BASE_URL=true solo en desarrollo.",
    );
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error(
      "API Base URL invalida: solo se permiten esquemas https:// (o http:// local en debug).",
    );
  }

  return value;
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

export function buildMobileWebHeaders(accessToken?: string): Record<string, string> {
  return {
    ...(accessToken ? { Authorization: `${WEB_AUTH_TOKEN_TYPE} ${accessToken}` } : {}),
    "X-Client-Platform": MOBILE_WEB_CLIENT_PLATFORM,
  };
}

async function resolveValidWebAccessToken(): Promise<string | null> {
  const resolved = await resolveWebSession({
    getAccessToken: getStoredWebAccessToken,
    getExpiresAt: getStoredWebAccessExpiresAt,
    onExpired: clearStoredWebSession,
  });
  if (resolved.state !== "active") return null;
  return resolved.accessToken;
}

async function resolveApiBaseUrl(): Promise<string> {
  const storedBaseUrl = await getStoredApiBaseUrl();
  if (storedBaseUrl) {
    return assertSecureApiBaseUrl(normalizeApiBaseUrl(storedBaseUrl));
  }
  return assertSecureApiBaseUrl(envBaseURL);
}

export async function resolveRequestAuth({
  method,
  path,
  bodyHash,
}: {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  bodyHash: string;
}): Promise<{ path: string; headers: Record<string, string>; mode: "web" }> {
  void method;
  void bodyHash;
  const normalizedPath = normalizePath(path);
  const webAccessToken = await resolveValidWebAccessToken();
  if (!webAccessToken) {
    throw new Error(
      "Sesion web requerida. Inicia sesion para continuar (Bearer) y vuelve a intentar.",
    );
  }

  return {
    path: ensureWebPath(normalizedPath),
    headers: buildMobileWebHeaders(webAccessToken),
    mode: "web",
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
  if (!baseURL) {
    throw new Error("API Base URL no configurada. Ve a Configuracion y acceso.");
  }
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
    const status = axiosErr.response?.status;
    if (apiMsg && status) return `${apiMsg} (HTTP ${status})`;
    if (apiMsg) return apiMsg;
    if (status) return `${axiosErr.message} (HTTP ${status})`;
    return axiosErr.message;
  }
  if (error instanceof Error) {
    const message = error.message || "";
    if (/failed to fetch|network request failed/i.test(message)) {
      return "No se pudo conectar con la API (Failed to fetch). Revisa URL base, CORS y conectividad.";
    }
    return message;
  }
  return String(error);
}
