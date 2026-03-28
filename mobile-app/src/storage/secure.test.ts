import { beforeEach, describe, expect, it, vi } from "vitest";

const secureStoreState = vi.hoisted(() => new Map<string, string>());
const secureStoreMocks = vi.hoisted(() => ({
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
  clearStoredWebSession,
  getStoredWebSession,
  getStoredWebAccessRole,
  getStoredWebAccessToken,
  getStoredWebAccessUsername,
  setStoredWebAccessRole,
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
      role: "viewer",
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
