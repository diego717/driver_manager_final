import { beforeEach, describe, expect, it, vi } from "vitest";

const secureStoreState = vi.hoisted(() => new Map<string, string>());
const secureStoreMocks = vi.hoisted(() => ({
  setItemAsync: vi.fn(async (key: string, value: string) => {
    secureStoreState.set(key, value);
  }),
  getItemAsync: vi.fn(async (key: string) => secureStoreState.get(key) ?? null),
}));

vi.mock("expo-secure-store", () => secureStoreMocks);

import { getBiometricEnabled, setBiometricEnabled } from "./app-preferences";

describe("app-preferences", () => {
  beforeEach(() => {
    secureStoreState.clear();
    secureStoreMocks.setItemAsync.mockClear();
    secureStoreMocks.getItemAsync.mockClear();
    delete (globalThis as { window?: unknown }).window;
  });

  it("returns false when biometric preference is missing", async () => {
    await expect(getBiometricEnabled()).resolves.toBe(false);
  });

  it("persists and reads enabled=true", async () => {
    await setBiometricEnabled(true);
    await expect(getBiometricEnabled()).resolves.toBe(true);
  });

  it("persists and reads enabled=false", async () => {
    await setBiometricEnabled(false);
    await expect(getBiometricEnabled()).resolves.toBe(false);
  });

  it("uses sessionStorage fallback on web", async () => {
    const storage = new Map<string, string>();
    const sessionStorageMock = {
      getItem: vi.fn((key: string) => storage.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => {
        storage.set(key, value);
      }),
    };

    (globalThis as { window?: unknown }).window = {
      sessionStorage: sessionStorageMock,
    };

    await setBiometricEnabled(true);
    await expect(getBiometricEnabled()).resolves.toBe(true);
    expect(sessionStorageMock.setItem).toHaveBeenCalled();
    expect(sessionStorageMock.getItem).toHaveBeenCalled();
    expect(secureStoreMocks.setItemAsync).not.toHaveBeenCalled();
    expect(secureStoreMocks.getItemAsync).not.toHaveBeenCalled();
  });
});
