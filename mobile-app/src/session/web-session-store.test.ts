import { beforeEach, describe, expect, it, vi } from "vitest";

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
};

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const webAuthMocks = vi.hoisted(() => ({
  clearWebSession: vi.fn(async (): Promise<void> => undefined),
  readStoredWebSession: vi.fn(),
}));

const startupSessionPolicyMocks = vi.hoisted(() => ({
  consumeForceLoginOnOpenFlag: vi.fn(() => false),
}));

const secureStorageMocks = vi.hoisted(() => ({
  isStoredWebSessionKey: vi.fn((key: string | null | undefined) =>
    key === "dm_web_access_token" ||
    key === "dm_web_access_expires_at" ||
    key === "dm_web_access_username" ||
    key === "dm_web_access_role",
  ),
}));

vi.mock("../api/webAuth", () => webAuthMocks);
vi.mock("../security/startup-session-policy", () => startupSessionPolicyMocks);
vi.mock("../storage/secure", () => secureStorageMocks);

import {
  __getSharedWebSessionSnapshotForTests,
  __resetSharedWebSessionStoreForTests,
  refreshSharedWebSessionState,
} from "./web-session-store";

describe("web session store", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    webAuthMocks.clearWebSession.mockClear();
    webAuthMocks.readStoredWebSession.mockReset();
    startupSessionPolicyMocks.consumeForceLoginOnOpenFlag.mockReset();
    startupSessionPolicyMocks.consumeForceLoginOnOpenFlag.mockReturnValue(false);
    __resetSharedWebSessionStoreForTests();
    delete (globalThis as { window?: unknown }).window;
  });

  it("ignores stale refresh results that finish after a newer login state", async () => {
    const staleRead = createDeferred<{
      accessToken: string | null;
      expiresAt: string | null;
      username: string | null;
      role: string | null;
    }>();

    webAuthMocks.readStoredWebSession
      .mockImplementationOnce(() => staleRead.promise)
      .mockResolvedValueOnce({
        accessToken: "fresh-token",
        expiresAt: "2030-01-01T00:00:00.000Z",
        username: "admin",
        role: "admin",
      });

    const firstRefresh = refreshSharedWebSessionState({ showLoader: true });
    const secondRefresh = refreshSharedWebSessionState();

    await expect(secondRefresh).resolves.toBe(true);
    expect(__getSharedWebSessionSnapshotForTests()).toMatchObject({
      checkingSession: false,
      hasActiveSession: true,
    });

    staleRead.resolve({
      accessToken: null,
      expiresAt: null,
      username: null,
      role: null,
    });

    await expect(firstRefresh).resolves.toBe(true);
    expect(__getSharedWebSessionSnapshotForTests()).toMatchObject({
      checkingSession: false,
      hasActiveSession: true,
    });
  });

  it("does not try to register browser storage listeners on native-like window shims", async () => {
    (globalThis as { window?: unknown }).window = {
      localStorage: {
        getItem: vi.fn(() => null),
        setItem: vi.fn(),
        removeItem: vi.fn(),
      },
    };
    webAuthMocks.readStoredWebSession.mockResolvedValueOnce({
      accessToken: null,
      expiresAt: null,
      username: null,
      role: null,
    });

    await expect(refreshSharedWebSessionState()).resolves.toBe(false);
    expect(__getSharedWebSessionSnapshotForTests()).toMatchObject({
      checkingSession: false,
      hasActiveSession: false,
    });
  });
});
