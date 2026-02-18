import { extractApiError, getResolvedApiBaseUrl } from "./client";
import {
  clearStoredWebSession,
  getStoredWebAccessExpiresAt,
  getStoredWebAccessToken,
  setStoredWebAccessExpiresAt,
  setStoredWebAccessToken,
} from "../storage/secure";
import { ensureNonEmpty } from "../utils/validation";

export interface WebLoginResponse {
  success: boolean;
  access_token: string;
  token_type: "Bearer";
  expires_in: number;
  expires_at: string;
}

function extractErrorMessage(body: unknown, fallback: string): string {
  if (typeof body !== "object" || body === null) return fallback;
  const payload = body as { error?: { message?: string } };
  return payload.error?.message || fallback;
}

export async function loginWebSession(password: string): Promise<WebLoginResponse> {
  const apiBaseUrl = await getResolvedApiBaseUrl();
  ensureNonEmpty(apiBaseUrl, "EXPO_PUBLIC_API_BASE_URL");
  ensureNonEmpty(password, "password");

  try {
    const response = await fetch(`${apiBaseUrl}/web/auth/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ password: password.trim() }),
    });
    const body = (await response.json()) as WebLoginResponse | { error?: { message?: string } };

    if (!response.ok) {
      throw new Error(extractErrorMessage(body, "Login web fallido."));
    }

    const login = body as WebLoginResponse;
    await Promise.all([
      setStoredWebAccessToken(login.access_token),
      setStoredWebAccessExpiresAt(login.expires_at),
    ]);

    return login;
  } catch (error) {
    throw new Error(extractApiError(error));
  }
}

export async function readStoredWebSession(): Promise<{
  accessToken: string | null;
  expiresAt: string | null;
}> {
  const [accessToken, expiresAt] = await Promise.all([
    getStoredWebAccessToken(),
    getStoredWebAccessExpiresAt(),
  ]);
  return { accessToken, expiresAt };
}

export async function clearWebSession(): Promise<void> {
  await clearStoredWebSession();
}
