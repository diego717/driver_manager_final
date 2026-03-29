import {
  buildMobileWebHeaders,
  extractApiError,
  getResolvedApiBaseUrl,
  WEB_AUTH_TOKEN_TYPE,
} from "./client";
import {
  clearStoredWebSession,
  getStoredWebSession,
  getStoredWebAccessExpiresAt,
  getStoredWebAccessRole,
  getStoredWebAccessToken,
  getStoredWebAccessUsername,
  setStoredWebSession,
} from "../storage/secure";
import { isWebBrowserRuntime } from "../storage/runtime";
import { ensureNonEmpty } from "../utils/validation";
import { resolveWebSession } from "./webSession";

export interface WebSessionUser {
  id?: number | null;
  username: string;
  role: string;
  tenant_id?: string;
  is_active?: boolean;
  created_at?: string;
  updated_at?: string;
  last_login_at?: string | null;
  legacy?: boolean;
}

interface WebSessionState {
  success: boolean;
  authenticated: true;
  token_type: typeof WEB_AUTH_TOKEN_TYPE;
  expires_in: number;
  expires_at: string;
  user: WebSessionUser;
}

export interface WebLoginResponse extends WebSessionState {
  access_token: string;
}

export interface WebBootstrapResponse extends WebLoginResponse {
  bootstrapped: boolean;
}

export type WebCurrentSessionResponse = WebSessionState;

export interface WebLogoutResponse {
  success: boolean;
  authenticated: false;
  logged_out: boolean;
}

export interface WebManagedUser {
  id: number;
  username: string;
  role: "admin" | "viewer" | "super_admin" | "platform_owner";
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

function sanitizeWebSessionUser(user: Partial<WebSessionUser> | null | undefined): WebSessionUser {
  const username =
    typeof user?.username === "string" && user.username.trim() ? user.username.trim() : "usuario";
  const role = typeof user?.role === "string" && user.role.trim() ? user.role.trim() : "viewer";
  const tenantId =
    typeof user?.tenant_id === "string" && user.tenant_id.trim() ? user.tenant_id.trim() : undefined;
  const createdAt =
    typeof user?.created_at === "string" && user.created_at.trim() ? user.created_at : undefined;
  const updatedAt =
    typeof user?.updated_at === "string" && user.updated_at.trim() ? user.updated_at : undefined;

  return {
    id: typeof user?.id === "number" ? user.id : user?.id === null ? null : undefined,
    username,
    role,
    tenant_id: tenantId,
    is_active: typeof user?.is_active === "boolean" ? user.is_active : undefined,
    created_at: createdAt,
    updated_at: updatedAt,
    last_login_at:
      typeof user?.last_login_at === "string" || user?.last_login_at === null
        ? user.last_login_at
        : undefined,
    legacy: Boolean(user?.legacy),
  };
}

function normalizeWebSessionResponse<
  T extends WebLoginResponse | WebBootstrapResponse | WebCurrentSessionResponse,
>(login: T): T {
  return {
    ...login,
    user: sanitizeWebSessionUser(login.user),
  } as T;
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

  const headers = new Headers(init.headers ?? {});
  const token = isWebBrowserRuntime() ? undefined : await resolveActiveWebToken();
  for (const [key, value] of Object.entries(buildMobileWebHeaders(token))) {
    headers.set(key, value);
  }
  if (!headers.has("Content-Type") && init.body !== undefined) {
    headers.set("Content-Type", "application/json");
  }

  return fetch(`${apiBaseUrl}${path}`, {
    ...init,
    credentials: init.credentials ?? "include",
    headers,
  });
}

async function persistWebSession(login: WebLoginResponse | WebBootstrapResponse): Promise<void> {
  await setStoredWebSession({
    accessToken: isWebBrowserRuntime() ? null : login.access_token,
    expiresAt: login.expires_at,
    username: login.user.username,
    role: login.user.role,
  });
}

async function syncStoredWebSessionMetadata(session: WebCurrentSessionResponse): Promise<void> {
  const currentToken = isWebBrowserRuntime() ? null : await getStoredWebAccessToken();
  await setStoredWebSession({
    accessToken: currentToken,
    expiresAt: session.expires_at,
    username: session.user.username,
    role: session.user.role,
  });
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
    const headers = new Headers({
      "Content-Type": "application/json",
    });
    for (const [key, value] of Object.entries(buildMobileWebHeaders())) {
      headers.set(key, value);
    }
    const response = await fetch(`${apiBaseUrl}/web/auth/login`, {
      method: "POST",
      credentials: "include",
      headers,
      body: JSON.stringify({
        username: username.trim().toLowerCase(),
        password,
      }),
    });
    const body = (await response.json()) as WebLoginResponse | { error?: { message?: string } };

    if (!response.ok) {
      throw new Error(extractErrorMessage(body, "Login web fallido."));
    }

    const login = normalizeWebSessionResponse(body as WebLoginResponse);
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
  role?: "admin" | "viewer" | "super_admin" | "platform_owner";
}): Promise<WebBootstrapResponse> {
  const apiBaseUrl = await getResolvedApiBaseUrl();
  ensureNonEmpty(apiBaseUrl, "EXPO_PUBLIC_API_BASE_URL");
  ensureNonEmpty(params.bootstrapPassword, "bootstrapPassword");
  ensureNonEmpty(params.username, "username");
  ensureNonEmpty(params.password, "password");

  try {
    const headers = new Headers({
      "Content-Type": "application/json",
    });
    for (const [key, value] of Object.entries(buildMobileWebHeaders())) {
      headers.set(key, value);
    }
    const response = await fetch(`${apiBaseUrl}/web/auth/bootstrap`, {
      method: "POST",
      credentials: "include",
      headers,
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

    const login = normalizeWebSessionResponse(body as WebBootstrapResponse);
    await persistWebSession(login);
    return login;
  } catch (error) {
    throw new Error(extractApiError(error));
  }
}

export async function getCurrentWebSession(): Promise<WebCurrentSessionResponse> {
  try {
    const response = await authorizedWebFetch("/web/auth/me", {
      method: "GET",
    });
    const body = (await response.json()) as WebCurrentSessionResponse | { error?: { message?: string } };

    if (!response.ok) {
      throw new Error(extractErrorMessage(body, "No se pudo validar la sesion web."));
    }

    const session = normalizeWebSessionResponse(body as WebCurrentSessionResponse);
    await syncStoredWebSessionMetadata(session);
    return session;
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
  const session = await getStoredWebSession();
  if (session) {
    return session;
  }

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

export async function logoutWebSession(): Promise<void> {
  try {
    const response = await authorizedWebFetch("/web/auth/logout", {
      method: "POST",
    });
    if (!response.ok) {
      // Best effort: always clear local session, even if server-side invalidation fails.
      await response.json().catch(() => undefined);
    }
  } catch {
    // Best effort: local cleanup still required.
  } finally {
    await clearStoredWebSession();
  }
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
  role?: "admin" | "viewer" | "super_admin" | "platform_owner";
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
