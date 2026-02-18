import * as SecureStore from "expo-secure-store";

const API_TOKEN_KEY = "dm_api_token";
const API_SECRET_KEY = "dm_api_secret";
const API_BASE_URL_KEY = "dm_api_base_url";
const WEB_ACCESS_TOKEN_KEY = "dm_web_access_token";
const WEB_ACCESS_EXPIRES_AT_KEY = "dm_web_access_expires_at";

function cleanValue(value: string): string {
  return value.trim();
}

function hasWebStorage(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

async function setItem(key: string, value: string): Promise<void> {
  if (hasWebStorage()) {
    window.localStorage.setItem(key, value);
    return;
  }
  await SecureStore.setItemAsync(key, value);
}

async function getItem(key: string): Promise<string | null> {
  if (hasWebStorage()) {
    return window.localStorage.getItem(key);
  }
  return SecureStore.getItemAsync(key);
}

async function deleteItem(key: string): Promise<void> {
  if (hasWebStorage()) {
    window.localStorage.removeItem(key);
    return;
  }
  await SecureStore.deleteItemAsync(key);
}

async function setOrDelete(key: string, value: string): Promise<void> {
  const normalized = cleanValue(value);
  if (!normalized) {
    await deleteItem(key);
    return;
  }
  await setItem(key, normalized);
}

export async function setStoredApiToken(token: string): Promise<void> {
  await setOrDelete(API_TOKEN_KEY, token);
}

export async function getStoredApiToken(): Promise<string | null> {
  return getItem(API_TOKEN_KEY);
}

export async function setStoredApiSecret(secret: string): Promise<void> {
  await setOrDelete(API_SECRET_KEY, secret);
}

export async function getStoredApiSecret(): Promise<string | null> {
  return getItem(API_SECRET_KEY);
}

export async function clearStoredAuth(): Promise<void> {
  await deleteItem(API_TOKEN_KEY);
  await deleteItem(API_SECRET_KEY);
}

export async function setStoredApiBaseUrl(baseUrl: string): Promise<void> {
  await setOrDelete(API_BASE_URL_KEY, baseUrl);
}

export async function getStoredApiBaseUrl(): Promise<string | null> {
  return getItem(API_BASE_URL_KEY);
}

export async function clearStoredApiBaseUrl(): Promise<void> {
  await deleteItem(API_BASE_URL_KEY);
}

export async function setStoredWebAccessToken(token: string): Promise<void> {
  await setOrDelete(WEB_ACCESS_TOKEN_KEY, token);
}

export async function getStoredWebAccessToken(): Promise<string | null> {
  return getItem(WEB_ACCESS_TOKEN_KEY);
}

export async function setStoredWebAccessExpiresAt(expiresAtIso: string): Promise<void> {
  await setOrDelete(WEB_ACCESS_EXPIRES_AT_KEY, expiresAtIso);
}

export async function getStoredWebAccessExpiresAt(): Promise<string | null> {
  return getItem(WEB_ACCESS_EXPIRES_AT_KEY);
}

export async function clearStoredWebSession(): Promise<void> {
  await deleteItem(WEB_ACCESS_TOKEN_KEY);
  await deleteItem(WEB_ACCESS_EXPIRES_AT_KEY);
}
