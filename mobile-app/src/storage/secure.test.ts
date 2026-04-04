import { beforeEach, describe, expect, it, vi } from "vitest";

const secureStoreState = vi.hoisted(() => new Map<string, string>());
const secureStoreMocks = vi.hoisted(() => ({
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: "after_first_unlock_this_device_only",
  setItemAsync: vi.fn(async (key: string, value: string) => {
    secureStoreState.set(key, value);
  }),
  getItemAsync: vi.fn(async (key: string) => secureStoreState.get(key) ?? null),
  deleteItemAsync: vi.fn(async (key: string) => {
    secureStoreState.delete(key);
  }),
}));

vi.mock("expo-secure-store", () => secureStoreMocks);

import {
  clearStoredCaseSecret,
  clearStoredIncidentEvidenceSecret,
  clearStoredIncidentSecret,
  clearStoredLinkedTechnician,
  clearStoredPhotoSecret,
  clearStoredWebSession,
  getStoredCaseSecret,
  getStoredIncidentEvidenceSecret,
  getStoredIncidentSecret,
  getStoredLinkedTechnician,
  getStoredPhotoSecret,
  getStoredWebSession,
  getStoredWebAccessRole,
  getStoredWebAccessToken,
  getStoredWebAccessUsername,
  redactStoredSensitiveValue,
  setStoredWebAccessRole,
  setStoredCaseSecret,
  setStoredIncidentEvidenceSecret,
  setStoredIncidentSecret,
  setStoredLinkedTechnician,
  setStoredPhotoSecret,
  setStoredWebSession,
  setStoredWebAccessToken,
  setStoredWebAccessUsername,
} from "./secure";

describe("secure storage hardening", () => {
  beforeEach(() => {
    secureStoreState.clear();
    secureStoreMocks.setItemAsync.mockClear();
    secureStoreMocks.getItemAsync.mockClear();
    secureStoreMocks.deleteItemAsync.mockClear();
    delete (globalThis as { window?: unknown }).window;
  });

  it("treats undefined username as empty and clears the stored value", async () => {
    await setStoredWebAccessUsername(" Diego ");
    await expect(getStoredWebAccessUsername()).resolves.toBe("Diego");

    await expect(
      setStoredWebAccessUsername(undefined as unknown as string),
    ).resolves.toBeUndefined();

    await expect(getStoredWebAccessUsername()).resolves.toBeNull();
    expect(secureStoreMocks.deleteItemAsync).toHaveBeenCalled();
  });

  it("treats undefined role as empty and clears the stored value", async () => {
    await setStoredWebAccessRole(" admin ");
    await expect(getStoredWebAccessRole()).resolves.toBe("admin");

    await expect(setStoredWebAccessRole(undefined as unknown as string)).resolves.toBeUndefined();

    await expect(getStoredWebAccessRole()).resolves.toBeNull();
    expect(secureStoreMocks.deleteItemAsync).toHaveBeenCalled();
  });

  it("writes native secrets with hardened secure store options", async () => {
    await setStoredWebAccessToken("token-123");

    expect(secureStoreMocks.setItemAsync).toHaveBeenCalledWith(
      "dm_web_access_token",
      "token-123",
      expect.objectContaining({
        keychainAccessible: "after_first_unlock_this_device_only",
      }),
    );
  });

  it("stores incident-sensitive fields in secure storage instead of SQLite-ready plaintext", async () => {
    await setStoredIncidentSecret("incident-local-1", {
      reporterUsername: "driver.user",
      note: "Choque leve en porton principal",
      gpsCaptureNote: "GPS aproximado",
      resolutionNote: "Cambio de fusible",
      evidenceNote: "Foto del gabinete",
    });

    await expect(getStoredIncidentSecret("incident-local-1")).resolves.toEqual({
      reporterUsername: "driver.user",
      note: "Choque leve en porton principal",
      gpsCaptureNote: "GPS aproximado",
      resolutionNote: "Cambio de fusible",
      evidenceNote: "Foto del gabinete",
    });
    expect(redactStoredSensitiveValue()).toBe("__secure_store__");

    await clearStoredIncidentSecret("incident-local-1");
    await expect(getStoredIncidentSecret("incident-local-1")).resolves.toBeNull();
  });

  it("stores case-sensitive fields in secure storage for future offline case flows", async () => {
    await setStoredCaseSecret("case-local-1", {
      clientName: "Cliente Reservado SA",
      notes: "Contacto: +598 99 000 000",
    });

    await expect(getStoredCaseSecret("case-local-1")).resolves.toEqual({
      clientName: "Cliente Reservado SA",
      notes: "Contacto: +598 99 000 000",
    });

    await clearStoredCaseSecret("case-local-1");
    await expect(getStoredCaseSecret("case-local-1")).resolves.toBeNull();
  });

  it("stores photo-sensitive metadata in secure storage instead of Watermelon fields", async () => {
    await setStoredPhotoSecret("photo-local-1", {
      localPath: "file:///data/user/0/app/cache/customer-claim.jpg",
      fileName: "customer-claim.jpg",
    });

    await expect(getStoredPhotoSecret("photo-local-1")).resolves.toEqual({
      localPath: "file:///data/user/0/app/cache/customer-claim.jpg",
      fileName: "customer-claim.jpg",
    });

    await clearStoredPhotoSecret("photo-local-1");
    await expect(getStoredPhotoSecret("photo-local-1")).resolves.toBeNull();
  });

  it("sanitizes dynamic SecureStore keys to Android-safe characters", async () => {
    await setStoredPhotoSecret("photo:local/1 #retry", {
      localPath: "file:///data/user/0/app/cache/customer-claim.jpg",
      fileName: "customer-claim.jpg",
    });

    expect(secureStoreMocks.setItemAsync).toHaveBeenCalledWith(
      "dm_photo_secret__photo_local_1_retry",
      expect.any(String),
      expect.any(Object),
    );
  });

  it("stores incident evidence payloads in secure storage for retryable offline sync", async () => {
    await setStoredIncidentEvidenceSecret("evidence-local-1", {
      checklistItems: ["Equipo identificado", "Diagnostico inicial registrado"],
      evidenceNote: "Se documenta evidencia inicial del tecnico",
      remoteIncidentId: 55,
    });

    await expect(getStoredIncidentEvidenceSecret("evidence-local-1")).resolves.toEqual({
      checklistItems: ["Equipo identificado", "Diagnostico inicial registrado"],
      evidenceNote: "Se documenta evidencia inicial del tecnico",
      remoteIncidentId: 55,
      localIncidentLocalId: null,
    });

    await clearStoredIncidentEvidenceSecret("evidence-local-1");
    await expect(getStoredIncidentEvidenceSecret("evidence-local-1")).resolves.toBeNull();
  });

  it("stores linked technician context for offline queue fallback", async () => {
    await setStoredLinkedTechnician({
      id: 12,
      tenantId: "tenant-a",
      webUserId: 9,
      displayName: "Luis Rivera",
      employeeCode: "TEC-22",
      isActive: true,
    });

    await expect(getStoredLinkedTechnician()).resolves.toEqual({
      id: 12,
      tenantId: "tenant-a",
      webUserId: 9,
      displayName: "Luis Rivera",
      employeeCode: "TEC-22",
      isActive: true,
    });

    await clearStoredLinkedTechnician();
    await expect(getStoredLinkedTechnician()).resolves.toBeNull();
  });

  it("keeps browser access tokens out of web storage while preserving session metadata", async () => {
    const localStorageState = new Map<string, string>();
    const sessionStorageState = new Map<string, string>();
    const localStorageMock = {
      getItem: vi.fn((key: string) => localStorageState.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => {
        localStorageState.set(key, value);
      }),
      removeItem: vi.fn((key: string) => {
        localStorageState.delete(key);
      }),
    };
    const sessionStorageMock = {
      getItem: vi.fn((key: string) => sessionStorageState.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => {
        sessionStorageState.set(key, value);
      }),
      removeItem: vi.fn((key: string) => {
        sessionStorageState.delete(key);
      }),
    };

    (globalThis as { window?: unknown }).window = {
      localStorage: localStorageMock,
      sessionStorage: sessionStorageMock,
    };

    await setStoredWebSession({
      accessToken: " token-123 ",
      expiresAt: "2030-01-01T00:00:00.000Z",
      username: " admin ",
      role: " viewer ",
    });

    await expect(getStoredWebAccessToken()).resolves.toBeNull();
    await expect(getStoredWebSession()).resolves.toEqual({
      accessToken: null,
      expiresAt: "2030-01-01T00:00:00.000Z",
      username: "admin",
      role: "solo_lectura",
    });
    expect(sessionStorageMock.setItem).not.toHaveBeenCalledWith("dm_web_access_token", "token-123");
    expect(localStorageMock.setItem).not.toHaveBeenCalled();

    await clearStoredWebSession();

    expect(sessionStorageMock.removeItem).toHaveBeenCalledWith("dm_web_access_token");
    expect(localStorageMock.removeItem).toHaveBeenCalledWith("dm_web_access_token");
  });

  it("clears legacy browser tokens instead of migrating them into sessionStorage", async () => {
    const localStorageState = new Map<string, string>();
    const sessionStorageState = new Map<string, string>();
    const localStorageMock = {
      getItem: vi.fn((key: string) => localStorageState.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => {
        localStorageState.set(key, value);
      }),
      removeItem: vi.fn((key: string) => {
        localStorageState.delete(key);
      }),
    };
    const sessionStorageMock = {
      getItem: vi.fn((key: string) => sessionStorageState.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => {
        sessionStorageState.set(key, value);
      }),
      removeItem: vi.fn((key: string) => {
        sessionStorageState.delete(key);
      }),
    };

    (globalThis as { window?: unknown }).window = {
      localStorage: localStorageMock,
      sessionStorage: sessionStorageMock,
    };

    localStorageState.set("dm_web_access_token", "legacy-token");

    await expect(getStoredWebAccessToken()).resolves.toBeNull();
    expect(sessionStorageMock.setItem).not.toHaveBeenCalledWith("dm_web_access_token", "legacy-token");
    expect(localStorageMock.removeItem).toHaveBeenCalledWith("dm_web_access_token");
  });
});
