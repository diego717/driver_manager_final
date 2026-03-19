import * as SecureStore from "expo-secure-store";
import { getWebLocalStorage, getWebSessionStorage } from "./runtime";

const API_BASE_URL_KEY = "dm_api_base_url";
const WEB_ACCESS_TOKEN_KEY = "dm_web_access_token";
const WEB_ACCESS_EXPIRES_AT_KEY = "dm_web_access_expires_at";
const WEB_ACCESS_USERNAME_KEY = "dm_web_access_username";
const WEB_ACCESS_ROLE_KEY = "dm_web_access_role";
const WEB_SESSION_BLOB_KEY = "dm_web_session";
const THEME_MODE_KEY = "dm_theme_mode";

export const WEB_SESSION_STORAGE_KEYS = [
  WEB_ACCESS_TOKEN_KEY,
  WEB_ACCESS_EXPIRES_AT_KEY,
  WEB_ACCESS_USERNAME_KEY,
  WEB_ACCESS_ROLE_KEY,
  WEB_SESSION_BLOB_KEY,
] as const;

export type ThemeMode = "system" | "light" | "dark";
export type StoredWebSession = {
  accessToken: string | null;
  expiresAt: string | null;
  username: string | null;
  role: string | null;
};

function cleanValue(value: unknown): string {
  if (typeof value === "string") {
    return value.trim();
  }
  if (value === null || value === undefined) {
    return "";
  }
  return String(value).trim();
}

async function setItem(key: string, value: string): Promise<void> {
  const webStorage = getWebStorageForKey(key);
  if (webStorage) {
    webStorage.setItem(key, value);
    return;
  }
  await SecureStore.setItemAsync(key, value);
}

async function getItem(key: string): Promise<string | null> {
  const webStorage = getWebStorageForKey(key);
  if (webStorage) {
    const currentValue = webStorage.getItem(key);
    if (currentValue !== null || !isStoredWebSessionKey(key)) {
      return currentValue;
    }

    const legacyStorage = getLegacyWebStorageForKey(key);
    if (legacyStorage && legacyStorage !== webStorage) {
      const legacyValue = legacyStorage.getItem(key);
      if (legacyValue !== null) {
        webStorage.setItem(key, legacyValue);
        legacyStorage.removeItem(key);
        return legacyValue;
      }
    }
    return null;
  }
  return SecureStore.getItemAsync(key);
}

async function deleteItem(key: string): Promise<void> {
  const webStorage = getWebStorageForKey(key);
  if (webStorage) {
    webStorage.removeItem(key);
    return;
  }
  await SecureStore.deleteItemAsync(key);
}

export function isStoredWebSessionKey(key: string | null | undefined): boolean {
  return (
    typeof key === "string" &&
    WEB_SESSION_STORAGE_KEYS.includes(key as (typeof WEB_SESSION_STORAGE_KEYS)[number])
  );
}

function getWebStorageForKey(key: string): Storage | null {
  if (isStoredWebSessionKey(key)) {
    return getWebSessionStorage();
  }
  return getWebSessionStorage();
}

function getLegacyWebStorageForKey(key: string): Storage | null {
  if (isStoredWebSessionKey(key)) {
    return getWebLocalStorage();
  }
  return null;
}

function normalizeStoredWebSession(
  value: Partial<StoredWebSession> | null | undefined,
): StoredWebSession {
  return {
    accessToken: cleanValue(value?.accessToken) || null,
    expiresAt: cleanValue(value?.expiresAt) || null,
    username: cleanValue(value?.username) || null,
    role: cleanValue(value?.role) || null,
  };
}

function hasStoredWebSessionValue(session: StoredWebSession): boolean {
  return Boolean(session.accessToken || session.expiresAt || session.username || session.role);
}

async function readStoredWebSessionBlob(): Promise<StoredWebSession | null> {
  const raw = await getItem(WEB_SESSION_BLOB_KEY);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as Partial<StoredWebSession>;
    const normalized = normalizeStoredWebSession(parsed);
    return hasStoredWebSessionValue(normalized) ? normalized : null;
  } catch {
    return null;
  }
}

async function writeStoredWebSessionBlob(session: StoredWebSession): Promise<void> {
  if (!hasStoredWebSessionValue(session)) {
    await deleteItem(WEB_SESSION_BLOB_KEY);
    return;
  }

  await setItem(WEB_SESSION_BLOB_KEY, JSON.stringify(session));
}

async function readLegacyStoredWebSession(): Promise<StoredWebSession | null> {
  const [accessToken, expiresAt, username, role] = await Promise.all([
    getItem(WEB_ACCESS_TOKEN_KEY),
    getItem(WEB_ACCESS_EXPIRES_AT_KEY),
    getItem(WEB_ACCESS_USERNAME_KEY),
    getItem(WEB_ACCESS_ROLE_KEY),
  ]);

  const normalized = normalizeStoredWebSession({
    accessToken,
    expiresAt,
    username,
    role,
  });
  return hasStoredWebSessionValue(normalized) ? normalized : null;
}

async function setOrDelete(key: string, value: unknown): Promise<void> {
  const normalized = cleanValue(value);
  if (!normalized) {
    await deleteItem(key);
    return;
  }
  await setItem(key, normalized);
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
  const current = (await getStoredWebSession()) ?? normalizeStoredWebSession({});
  const next = normalizeStoredWebSession({
    ...current,
    accessToken: token,
  });
  await Promise.all([
    setOrDelete(WEB_ACCESS_TOKEN_KEY, token),
    writeStoredWebSessionBlob(next),
  ]);
}

export async function getStoredWebAccessToken(): Promise<string | null> {
  const session = await getStoredWebSession();
  return session?.accessToken ?? null;
}

export async function setStoredWebAccessExpiresAt(expiresAtIso: string): Promise<void> {
  const current = (await getStoredWebSession()) ?? normalizeStoredWebSession({});
  const next = normalizeStoredWebSession({
    ...current,
    expiresAt: expiresAtIso,
  });
  await Promise.all([
    setOrDelete(WEB_ACCESS_EXPIRES_AT_KEY, expiresAtIso),
    writeStoredWebSessionBlob(next),
  ]);
}

export async function getStoredWebAccessExpiresAt(): Promise<string | null> {
  const session = await getStoredWebSession();
  return session?.expiresAt ?? null;
}

export async function setStoredWebAccessUsername(username: string): Promise<void> {
  const current = (await getStoredWebSession()) ?? normalizeStoredWebSession({});
  const next = normalizeStoredWebSession({
    ...current,
    username,
  });
  await Promise.all([
    setOrDelete(WEB_ACCESS_USERNAME_KEY, username),
    writeStoredWebSessionBlob(next),
  ]);
}

export async function getStoredWebAccessUsername(): Promise<string | null> {
  const session = await getStoredWebSession();
  return session?.username ?? null;
}

export async function setStoredWebAccessRole(role: string): Promise<void> {
  const current = (await getStoredWebSession()) ?? normalizeStoredWebSession({});
  const next = normalizeStoredWebSession({
    ...current,
    role,
  });
  await Promise.all([
    setOrDelete(WEB_ACCESS_ROLE_KEY, role),
    writeStoredWebSessionBlob(next),
  ]);
}

export async function getStoredWebAccessRole(): Promise<string | null> {
  const session = await getStoredWebSession();
  return session?.role ?? null;
}

export async function setStoredWebSession(session: Partial<StoredWebSession>): Promise<void> {
  const normalized = normalizeStoredWebSession(session);
  await Promise.all([
    setOrDelete(WEB_ACCESS_TOKEN_KEY, normalized.accessToken),
    setOrDelete(WEB_ACCESS_EXPIRES_AT_KEY, normalized.expiresAt),
    setOrDelete(WEB_ACCESS_USERNAME_KEY, normalized.username),
    setOrDelete(WEB_ACCESS_ROLE_KEY, normalized.role),
    writeStoredWebSessionBlob(normalized),
  ]);
}

export async function getStoredWebSession(): Promise<StoredWebSession | null> {
  const blobSession = await readStoredWebSessionBlob();
  if (blobSession) {
    return blobSession;
  }

  const legacySession = await readLegacyStoredWebSession();
  if (legacySession) {
    await writeStoredWebSessionBlob(legacySession);
    return legacySession;
  }

  return null;
}

export async function clearStoredWebSession(): Promise<void> {
  await Promise.all([
    deleteItem(WEB_ACCESS_TOKEN_KEY),
    deleteItem(WEB_ACCESS_EXPIRES_AT_KEY),
    deleteItem(WEB_ACCESS_USERNAME_KEY),
    deleteItem(WEB_ACCESS_ROLE_KEY),
    deleteItem(WEB_SESSION_BLOB_KEY),
  ]);
}

export async function setStoredThemeMode(mode: ThemeMode): Promise<void> {
  await setOrDelete(THEME_MODE_KEY, mode);
}

export async function getStoredThemeMode(): Promise<ThemeMode | null> {
  const raw = await getItem(THEME_MODE_KEY);
  if (!raw) return null;
  if (raw === "system" || raw === "light" || raw === "dark") return raw;
  return null;
}
