import { extractApiError, signedJsonRequest } from "./client";
import {
  getStoredWebAccessExpiresAt,
  getStoredWebAccessToken,
} from "../storage/secure";

export interface RegisterDeviceTokenInput {
  fcmToken: string;
  deviceModel?: string | null;
  appVersion?: string | null;
  platform?: string | null;
}

export interface RegisterDeviceTokenResponse {
  success: boolean;
  registered: boolean;
}

function hasValidSessionExpiry(expiresAtIso: string | null): boolean {
  if (!expiresAtIso) return false;
  const expiresAtMs = Date.parse(expiresAtIso);
  return Number.isFinite(expiresAtMs) && expiresAtMs > Date.now() + 5000;
}

async function hasActiveWebSession(): Promise<boolean> {
  const [accessToken, expiresAt] = await Promise.all([
    getStoredWebAccessToken(),
    getStoredWebAccessExpiresAt(),
  ]);

  if (!accessToken) return false;
  return hasValidSessionExpiry(expiresAt);
}

function normalizeDeviceString(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const normalized = value.trim();
  return normalized ? normalized : null;
}

export async function registerDeviceToken(input: RegisterDeviceTokenInput): Promise<boolean> {
  const fcmToken = normalizeDeviceString(input.fcmToken);
  if (!fcmToken) {
    throw new Error("fcmToken es obligatorio.");
  }

  if (!(await hasActiveWebSession())) {
    return false;
  }

  try {
    const response = await signedJsonRequest<RegisterDeviceTokenResponse>({
      method: "POST",
      path: "/devices",
      data: {
        fcm_token: fcmToken,
        device_model: normalizeDeviceString(input.deviceModel),
        app_version: normalizeDeviceString(input.appVersion),
        platform: normalizeDeviceString(input.platform) || "android",
      },
    });

    return response.success && response.registered;
  } catch (error) {
    throw new Error(extractApiError(error));
  }
}
