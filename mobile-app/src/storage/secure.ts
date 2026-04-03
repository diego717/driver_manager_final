import * as SecureStore from "expo-secure-store";
import { getWebLocalStorage, getWebSessionStorage, isWebBrowserRuntime } from "./runtime";

const API_BASE_URL_KEY = "dm_api_base_url";
const WEB_ACCESS_TOKEN_KEY = "dm_web_access_token";
const WEB_ACCESS_EXPIRES_AT_KEY = "dm_web_access_expires_at";
const WEB_ACCESS_USERNAME_KEY = "dm_web_access_username";
const WEB_ACCESS_ROLE_KEY = "dm_web_access_role";
const WEB_SESSION_BLOB_KEY = "dm_web_session";
const THEME_MODE_KEY = "dm_theme_mode";
const INCIDENT_SECRET_PREFIX = "dm_incident_secret";
const INCIDENT_EVIDENCE_SECRET_PREFIX = "dm_incident_evidence_secret";
const CASE_SECRET_PREFIX = "dm_case_secret";
const PHOTO_SECRET_PREFIX = "dm_photo_secret";
const LINKED_TECHNICIAN_KEY = "dm_linked_technician";
const SECURE_REDACTED_VALUE = "__secure_store__";

const SECURE_STORE_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
};

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
export type StoredIncidentSecret = {
  reporterUsername: string | null;
  note: string | null;
  gpsCaptureNote: string | null;
  resolutionNote: string | null;
  evidenceNote: string | null;
};
export type StoredCaseSecret = {
  clientName: string | null;
  notes: string | null;
};
export type StoredPhotoSecret = {
  localPath: string | null;
  fileName: string | null;
};
export type StoredIncidentEvidenceSecret = {
  checklistItems: string[];
  evidenceNote: string | null;
  remoteIncidentId: number | null;
  localIncidentLocalId: string | null;
};
export type StoredLinkedTechnician = {
  id: number | null;
  tenantId: string | null;
  webUserId: number | null;
  displayName: string | null;
  employeeCode: string | null;
  isActive: boolean | null;
};

function isWebSessionTokenKey(key: string): boolean {
  return key === WEB_ACCESS_TOKEN_KEY;
}

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
  if (isWebBrowserRuntime() && isWebSessionTokenKey(key)) {
    clearLegacyWebTokenStorage();
    return;
  }
  const webStorage = getWebStorageForKey(key);
  if (webStorage) {
    webStorage.setItem(key, value);
    return;
  }
  await SecureStore.setItemAsync(key, value, SECURE_STORE_OPTIONS);
}

async function getItem(key: string): Promise<string | null> {
  if (isWebBrowserRuntime() && isWebSessionTokenKey(key)) {
    clearLegacyWebTokenStorage();
    return null;
  }
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
  if (isWebBrowserRuntime() && isWebSessionTokenKey(key)) {
    clearLegacyWebTokenStorage();
    return;
  }
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

function clearLegacyWebTokenStorage(): void {
  const storages = [getWebSessionStorage(), getWebLocalStorage()];
  for (const storage of storages) {
    storage?.removeItem(WEB_ACCESS_TOKEN_KEY);
  }
}

function buildIncidentSecretKey(localId: string): string {
  return `${INCIDENT_SECRET_PREFIX}:${cleanValue(localId)}`;
}

function buildCaseSecretKey(localId: string): string {
  return `${CASE_SECRET_PREFIX}:${cleanValue(localId)}`;
}

function buildIncidentEvidenceSecretKey(localId: string): string {
  return `${INCIDENT_EVIDENCE_SECRET_PREFIX}:${cleanValue(localId)}`;
}

function buildPhotoSecretKey(localId: string): string {
  return `${PHOTO_SECRET_PREFIX}:${cleanValue(localId)}`;
}

function normalizeStoredIncidentSecret(
  value: Partial<StoredIncidentSecret> | null | undefined,
): StoredIncidentSecret {
  return {
    reporterUsername: cleanValue(value?.reporterUsername) || null,
    note: cleanValue(value?.note) || null,
    gpsCaptureNote: cleanValue(value?.gpsCaptureNote) || null,
    resolutionNote: cleanValue(value?.resolutionNote) || null,
    evidenceNote: cleanValue(value?.evidenceNote) || null,
  };
}

function hasStoredIncidentSecretValue(secret: StoredIncidentSecret): boolean {
  return Boolean(
    secret.reporterUsername ||
    secret.note ||
    secret.gpsCaptureNote ||
    secret.resolutionNote ||
    secret.evidenceNote,
  );
}

function normalizeStoredCaseSecret(
  value: Partial<StoredCaseSecret> | null | undefined,
): StoredCaseSecret {
  return {
    clientName: cleanValue(value?.clientName) || null,
    notes: cleanValue(value?.notes) || null,
  };
}

function hasStoredCaseSecretValue(secret: StoredCaseSecret): boolean {
  return Boolean(secret.clientName || secret.notes);
}

function normalizeStoredPhotoSecret(
  value: Partial<StoredPhotoSecret> | null | undefined,
): StoredPhotoSecret {
  return {
    localPath: cleanValue(value?.localPath) || null,
    fileName: cleanValue(value?.fileName) || null,
  };
}

function hasStoredPhotoSecretValue(secret: StoredPhotoSecret): boolean {
  return Boolean(secret.localPath || secret.fileName);
}

function normalizeStoredIncidentEvidenceSecret(
  value: Partial<StoredIncidentEvidenceSecret> | null | undefined,
): StoredIncidentEvidenceSecret {
  const checklistItems = Array.isArray(value?.checklistItems)
    ? value.checklistItems
        .map((item) => cleanValue(item))
        .filter(Boolean)
    : [];

  const remoteIncidentId = Number(value?.remoteIncidentId)

  return {
    checklistItems,
    evidenceNote: cleanValue(value?.evidenceNote) || null,
    remoteIncidentId: Number.isInteger(remoteIncidentId) && remoteIncidentId > 0
      ? remoteIncidentId
      : null,
    localIncidentLocalId: cleanValue(value?.localIncidentLocalId) || null,
  };
}

function hasStoredIncidentEvidenceSecretValue(secret: StoredIncidentEvidenceSecret): boolean {
  return Boolean(
    secret.checklistItems.length ||
    secret.evidenceNote ||
    secret.remoteIncidentId ||
    secret.localIncidentLocalId,
  );
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

function normalizeStoredLinkedTechnician(
  value: Partial<StoredLinkedTechnician> | null | undefined,
): StoredLinkedTechnician {
  const id = Number(value?.id)
  const webUserId = Number(value?.webUserId)
  return {
    id: Number.isInteger(id) && id > 0 ? id : null,
    tenantId: cleanValue(value?.tenantId) || null,
    webUserId: Number.isInteger(webUserId) && webUserId > 0 ? webUserId : null,
    displayName: cleanValue(value?.displayName) || null,
    employeeCode: cleanValue(value?.employeeCode) || null,
    isActive:
      typeof value?.isActive === "boolean"
        ? value.isActive
        : value?.isActive === null || value?.isActive === undefined
          ? null
          : Boolean(value?.isActive),
  };
}

function hasStoredLinkedTechnicianValue(value: StoredLinkedTechnician): boolean {
  return Boolean(value.id || value.displayName || value.webUserId);
}

function hasStoredWebSessionValue(session: StoredWebSession): boolean {
  return Boolean(session.accessToken || session.expiresAt || session.username || session.role);
}

function normalizePersistedWebSession(session: StoredWebSession): StoredWebSession {
  if (!isWebBrowserRuntime()) {
    return session;
  }

  return {
    ...session,
    accessToken: null,
  };
}

async function readStoredWebSessionBlob(): Promise<StoredWebSession | null> {
  const raw = await getItem(WEB_SESSION_BLOB_KEY);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as Partial<StoredWebSession>;
    const normalized = normalizePersistedWebSession(normalizeStoredWebSession(parsed));
    if (isWebBrowserRuntime() && parsed.accessToken) {
      await writeStoredWebSessionBlob(normalized);
    }
    return hasStoredWebSessionValue(normalized) ? normalized : null;
  } catch {
    return null;
  }
}

async function writeStoredWebSessionBlob(session: StoredWebSession): Promise<void> {
  const persisted = normalizePersistedWebSession(session);
  if (!hasStoredWebSessionValue(persisted)) {
    await deleteItem(WEB_SESSION_BLOB_KEY);
    return;
  }

  await setItem(WEB_SESSION_BLOB_KEY, JSON.stringify(persisted));
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

export function redactStoredSensitiveValue(): string {
  return SECURE_REDACTED_VALUE;
}

export function isStoredSensitiveValueRedacted(value: string | null | undefined): boolean {
  return cleanValue(value) === SECURE_REDACTED_VALUE;
}

export async function setStoredIncidentSecret(
  localId: string,
  payload: Partial<StoredIncidentSecret>,
): Promise<void> {
  const normalizedLocalId = cleanValue(localId);
  if (!normalizedLocalId) {
    throw new Error("localId requerido para guardar datos sensibles del incidente.");
  }

  const normalizedPayload = normalizeStoredIncidentSecret(payload);
  if (!hasStoredIncidentSecretValue(normalizedPayload)) {
    await deleteItem(buildIncidentSecretKey(normalizedLocalId));
    return;
  }

  await setItem(buildIncidentSecretKey(normalizedLocalId), JSON.stringify(normalizedPayload));
}

export async function getStoredIncidentSecret(localId: string): Promise<StoredIncidentSecret | null> {
  const normalizedLocalId = cleanValue(localId);
  if (!normalizedLocalId) return null;

  const raw = await getItem(buildIncidentSecretKey(normalizedLocalId));
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as Partial<StoredIncidentSecret>;
    const normalized = normalizeStoredIncidentSecret(parsed);
    return hasStoredIncidentSecretValue(normalized) ? normalized : null;
  } catch {
    return null;
  }
}

export async function clearStoredIncidentSecret(localId: string): Promise<void> {
  const normalizedLocalId = cleanValue(localId);
  if (!normalizedLocalId) return;
  await deleteItem(buildIncidentSecretKey(normalizedLocalId));
}

export async function setStoredIncidentEvidenceSecret(
  localId: string,
  payload: Partial<StoredIncidentEvidenceSecret>,
): Promise<void> {
  const normalizedLocalId = cleanValue(localId);
  if (!normalizedLocalId) {
    throw new Error("localId requerido para guardar evidencia sensible de la incidencia.");
  }

  const normalizedPayload = normalizeStoredIncidentEvidenceSecret(payload);
  if (!hasStoredIncidentEvidenceSecretValue(normalizedPayload)) {
    await deleteItem(buildIncidentEvidenceSecretKey(normalizedLocalId));
    return;
  }

  await setItem(buildIncidentEvidenceSecretKey(normalizedLocalId), JSON.stringify(normalizedPayload));
}

export async function getStoredIncidentEvidenceSecret(
  localId: string,
): Promise<StoredIncidentEvidenceSecret | null> {
  const normalizedLocalId = cleanValue(localId);
  if (!normalizedLocalId) return null;

  const raw = await getItem(buildIncidentEvidenceSecretKey(normalizedLocalId));
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as Partial<StoredIncidentEvidenceSecret>;
    const normalized = normalizeStoredIncidentEvidenceSecret(parsed);
    return hasStoredIncidentEvidenceSecretValue(normalized) ? normalized : null;
  } catch {
    return null;
  }
}

export async function clearStoredIncidentEvidenceSecret(localId: string): Promise<void> {
  const normalizedLocalId = cleanValue(localId);
  if (!normalizedLocalId) return;
  await deleteItem(buildIncidentEvidenceSecretKey(normalizedLocalId));
}

export async function setStoredCaseSecret(
  localId: string,
  payload: Partial<StoredCaseSecret>,
): Promise<void> {
  const normalizedLocalId = cleanValue(localId);
  if (!normalizedLocalId) {
    throw new Error("localId requerido para guardar datos sensibles del caso.");
  }

  const normalizedPayload = normalizeStoredCaseSecret(payload);
  if (!hasStoredCaseSecretValue(normalizedPayload)) {
    await deleteItem(buildCaseSecretKey(normalizedLocalId));
    return;
  }

  await setItem(buildCaseSecretKey(normalizedLocalId), JSON.stringify(normalizedPayload));
}

export async function getStoredCaseSecret(localId: string): Promise<StoredCaseSecret | null> {
  const normalizedLocalId = cleanValue(localId);
  if (!normalizedLocalId) return null;

  const raw = await getItem(buildCaseSecretKey(normalizedLocalId));
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as Partial<StoredCaseSecret>;
    const normalized = normalizeStoredCaseSecret(parsed);
    return hasStoredCaseSecretValue(normalized) ? normalized : null;
  } catch {
    return null;
  }
}

export async function clearStoredCaseSecret(localId: string): Promise<void> {
  const normalizedLocalId = cleanValue(localId);
  if (!normalizedLocalId) return;
  await deleteItem(buildCaseSecretKey(normalizedLocalId));
}

export async function setStoredPhotoSecret(
  localId: string,
  payload: Partial<StoredPhotoSecret>,
): Promise<void> {
  const normalizedLocalId = cleanValue(localId);
  if (!normalizedLocalId) {
    throw new Error("localId requerido para guardar datos sensibles de la foto.");
  }

  const normalizedPayload = normalizeStoredPhotoSecret(payload);
  if (!hasStoredPhotoSecretValue(normalizedPayload)) {
    await deleteItem(buildPhotoSecretKey(normalizedLocalId));
    return;
  }

  await setItem(buildPhotoSecretKey(normalizedLocalId), JSON.stringify(normalizedPayload));
}

export async function getStoredPhotoSecret(localId: string): Promise<StoredPhotoSecret | null> {
  const normalizedLocalId = cleanValue(localId);
  if (!normalizedLocalId) return null;

  const raw = await getItem(buildPhotoSecretKey(normalizedLocalId));
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as Partial<StoredPhotoSecret>;
    const normalized = normalizeStoredPhotoSecret(parsed);
    return hasStoredPhotoSecretValue(normalized) ? normalized : null;
  } catch {
    return null;
  }
}

export async function clearStoredPhotoSecret(localId: string): Promise<void> {
  const normalizedLocalId = cleanValue(localId);
  if (!normalizedLocalId) return;
  await deleteItem(buildPhotoSecretKey(normalizedLocalId));
}

export async function setStoredLinkedTechnician(
  payload: Partial<StoredLinkedTechnician> | null | undefined,
): Promise<void> {
  const normalized = normalizeStoredLinkedTechnician(payload);
  if (!hasStoredLinkedTechnicianValue(normalized)) {
    await deleteItem(LINKED_TECHNICIAN_KEY);
    return;
  }
  await setItem(LINKED_TECHNICIAN_KEY, JSON.stringify(normalized));
}

export async function getStoredLinkedTechnician(): Promise<StoredLinkedTechnician | null> {
  const raw = await getItem(LINKED_TECHNICIAN_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<StoredLinkedTechnician>;
    const normalized = normalizeStoredLinkedTechnician(parsed);
    return hasStoredLinkedTechnicianValue(normalized) ? normalized : null;
  } catch {
    return null;
  }
}

export async function clearStoredLinkedTechnician(): Promise<void> {
  await deleteItem(LINKED_TECHNICIAN_KEY);
}
