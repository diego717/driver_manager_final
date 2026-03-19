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
  getStoredWebAccessRole,
  getStoredWebAccessToken,
  getStoredWebAccessUsername,
  setStoredWebAccessRole,
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

  it("stores web session keys in sessionStorage on web", async () => {
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

    await setStoredWebAccessToken(" token-123 ");

    await expect(getStoredWebAccessToken()).resolves.toBe("token-123");
    expect(sessionStorageMock.setItem).toHaveBeenCalledWith("dm_web_access_token", "token-123");
    expect(localStorageMock.setItem).not.toHaveBeenCalled();

    await clearStoredWebSession();

    expect(sessionStorageMock.removeItem).toHaveBeenCalledWith("dm_web_access_token");
    expect(localStorageMock.removeItem).not.toHaveBeenCalledWith("dm_web_access_token");
  });

  it("migrates legacy web session keys from localStorage into sessionStorage", async () => {
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

    await expect(getStoredWebAccessToken()).resolves.toBe("legacy-token");
    expect(sessionStorageMock.setItem).toHaveBeenCalledWith("dm_web_access_token", "legacy-token");
    expect(localStorageMock.removeItem).toHaveBeenCalledWith("dm_web_access_token");
  });
});
