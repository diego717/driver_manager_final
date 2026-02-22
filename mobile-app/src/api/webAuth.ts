import { extractApiError, getResolvedApiBaseUrl } from "./client";
import {
  clearStoredWebSession,
  getStoredWebAccessExpiresAt,
  getStoredWebAccessRole,
  getStoredWebAccessToken,
  getStoredWebAccessUsername,
  setStoredWebAccessExpiresAt,
  setStoredWebAccessRole,
  setStoredWebAccessToken,
  setStoredWebAccessUsername,
} from "../storage/secure";
import { ensureNonEmpty } from "../utils/validation";
import { resolveWebSession } from "./webSession";

export interface WebSessionUser {
  id?: number;
  username: string;
  role: string;
  legacy?: boolean;
}

export interface WebLoginResponse {
  success: boolean;
  access_token: string;
  token_type: "Bearer";
  expires_in: number;
  expires_at: string;
  user: WebSessionUser;
}

export interface WebBootstrapResponse {
  success: boolean;
  bootstrapped: boolean;
  access_token: string;
  token_type: "Bearer";
  expires_in: number;
  expires_at: string;
  user: WebSessionUser;
}

export interface WebManagedUser {
  id: number;
  username: string;
  role: "admin" | "viewer" | "super_admin";
  is_active: boolean;
  created_at: string;
  updated_at: string;
  last_login_at: string | null;
}

interface WebUsersListResponse {
  success: boolean;
  users: WebManagedUser[];
}

interface WebUserMutationResponse {
  success: boolean;
  user: WebManagedUser;
}

function extractErrorMessage(body: unknown, fallback: string): string {
  if (typeof body !== "object" || body === null) return fallback;
  const payload = body as { error?: { message?: string } };
  return payload.error?.message || fallback;
}

async function resolveActiveWebToken(): Promise<string> {
  const resolved = await resolveWebSession({
    getAccessToken: getStoredWebAccessToken,
    getExpiresAt: getStoredWebAccessExpiresAt,
    onExpired: clearStoredWebSession,
  });

  if (resolved.state !== "active") {
    if (resolved.state === "missing") {
      throw new Error("Falta token Bearer para autenticacion web.");
    }
    throw new Error("Sesion web expirada. Inicia sesion nuevamente.");
  }

  return resolved.accessToken;
}

async function authorizedWebFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const apiBaseUrl = await getResolvedApiBaseUrl();
  ensureNonEmpty(apiBaseUrl, "EXPO_PUBLIC_API_BASE_URL");

  const token = await resolveActiveWebToken();
  const headers = new Headers(init.headers ?? {});
  headers.set("Authorization", `Bearer ${token}`);
  if (!headers.has("Content-Type") && init.body !== undefined) {
    headers.set("Content-Type", "application/json");
  }

  return fetch(`${apiBaseUrl}${path}`, {
    ...init,
    headers,
  });
}

async function persistWebSession(login: WebLoginResponse | WebBootstrapResponse): Promise<void> {
  await Promise.all([
    setStoredWebAccessToken(login.access_token),
    setStoredWebAccessExpiresAt(login.expires_at),
    setStoredWebAccessUsername(login.user.username),
    setStoredWebAccessRole(login.user.role),
  ]);
}

export async function loginWebSession(
  username: string,
  password: string,
): Promise<WebLoginResponse> {
  const apiBaseUrl = await getResolvedApiBaseUrl();
  ensureNonEmpty(apiBaseUrl, "EXPO_PUBLIC_API_BASE_URL");
  ensureNonEmpty(username, "username");
  ensureNonEmpty(password, "password");

  try {
    const response = await fetch(`${apiBaseUrl}/web/auth/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        username: username.trim().toLowerCase(),
        password,
      }),
    });
    const body = (await response.json()) as WebLoginResponse | { error?: { message?: string } };

    if (!response.ok) {
      throw new Error(extractErrorMessage(body, "Login web fallido."));
    }

    const login = body as WebLoginResponse;
    await persistWebSession(login);

    return login;
  } catch (error) {
    throw new Error(extractApiError(error));
  }
}

export async function bootstrapWebUser(params: {
  bootstrapPassword: string;
  username: string;
  password: string;
  role?: "admin" | "viewer" | "super_admin";
}): Promise<WebBootstrapResponse> {
  const apiBaseUrl = await getResolvedApiBaseUrl();
  ensureNonEmpty(apiBaseUrl, "EXPO_PUBLIC_API_BASE_URL");
  ensureNonEmpty(params.bootstrapPassword, "bootstrapPassword");
  ensureNonEmpty(params.username, "username");
  ensureNonEmpty(params.password, "password");

  try {
    const response = await fetch(`${apiBaseUrl}/web/auth/bootstrap`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        bootstrap_password: params.bootstrapPassword,
        username: params.username.trim().toLowerCase(),
        password: params.password,
        role: params.role || "admin",
      }),
    });
    const body = (await response.json()) as WebBootstrapResponse | { error?: { message?: string } };

    if (!response.ok) {
      throw new Error(extractErrorMessage(body, "Bootstrap web fallido."));
    }

    const login = body as WebBootstrapResponse;
    await persistWebSession(login);
    return login;
  } catch (error) {
    throw new Error(extractApiError(error));
  }
}

export async function readStoredWebSession(): Promise<{
  accessToken: string | null;
  expiresAt: string | null;
  username: string | null;
  role: string | null;
}> {
  const [accessToken, expiresAt, username, role] = await Promise.all([
    getStoredWebAccessToken(),
    getStoredWebAccessExpiresAt(),
    getStoredWebAccessUsername(),
    getStoredWebAccessRole(),
  ]);
  return { accessToken, expiresAt, username, role };
}

export async function clearWebSession(): Promise<void> {
  await clearStoredWebSession();
}

export async function listWebUsers(): Promise<WebManagedUser[]> {
  try {
    const response = await authorizedWebFetch("/web/auth/users", {
      method: "GET",
    });
    const body = (await response.json()) as WebUsersListResponse | { error?: { message?: string } };

    if (!response.ok) {
      throw new Error(extractErrorMessage(body, "No se pudieron listar usuarios web."));
    }

    return (body as WebUsersListResponse).users;
  } catch (error) {
    throw new Error(extractApiError(error));
  }
}

export async function updateWebUser(params: {
  userId: number;
  role?: "admin" | "viewer" | "super_admin";
  isActive?: boolean;
}): Promise<WebManagedUser> {
  ensureNonEmpty(String(params.userId), "userId");
  if (params.role === undefined && params.isActive === undefined) {
    throw new Error("Debes enviar role o isActive.");
  }

  try {
    const payload: Record<string, unknown> = {};
    if (params.role !== undefined) payload.role = params.role;
    if (params.isActive !== undefined) payload.is_active = params.isActive;

    const response = await authorizedWebFetch(`/web/auth/users/${params.userId}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    });
    const body = (await response.json()) as WebUserMutationResponse | { error?: { message?: string } };

    if (!response.ok) {
      throw new Error(extractErrorMessage(body, "No se pudo actualizar el usuario web."));
    }

    return (body as WebUserMutationResponse).user;
  } catch (error) {
    throw new Error(extractApiError(error));
  }
}

export async function forceWebUserPassword(params: {
  userId: number;
  newPassword: string;
}): Promise<WebManagedUser> {
  ensureNonEmpty(String(params.userId), "userId");
  ensureNonEmpty(params.newPassword, "newPassword");

  try {
    const response = await authorizedWebFetch(`/web/auth/users/${params.userId}/force-password`, {
      method: "POST",
      body: JSON.stringify({
        new_password: params.newPassword,
      }),
    });
    const body = (await response.json()) as WebUserMutationResponse | { error?: { message?: string } };

    if (!response.ok) {
      throw new Error(extractErrorMessage(body, "No se pudo forzar cambio de contrasena."));
    }

    return (body as WebUserMutationResponse).user;
  } catch (error) {
    throw new Error(extractApiError(error));
  }
}
