import { beforeEach, describe, expect, it, vi } from "vitest";

const clientMocks = vi.hoisted(() => ({
  getResolvedApiBaseUrl: vi.fn(async () => "https://worker.example"),
  extractApiError: vi.fn((error: unknown) =>
    error instanceof Error ? error.message : String(error),
  ),
  buildMobileWebHeaders: vi.fn((accessToken?: string) => ({
    ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    "X-Client-Platform": "mobile",
  })),
  WEB_AUTH_TOKEN_TYPE: "Bearer",
}));

const secureMocks = vi.hoisted(() => ({
  clearStoredWebSession: vi.fn(async (): Promise<void> => undefined),
  getStoredWebSession: vi.fn(async (): Promise<{
    accessToken: string | null;
    expiresAt: string | null;
    username: string | null;
    role: string | null;
  } | null> => null),
  getStoredWebAccessExpiresAt: vi.fn(async (): Promise<string | null> => null),
  getStoredWebAccessRole: vi.fn(async (): Promise<string | null> => null),
  getStoredWebAccessToken: vi.fn(async (): Promise<string | null> => null),
  getStoredWebAccessUsername: vi.fn(async (): Promise<string | null> => null),
  setStoredWebSession: vi.fn(async (): Promise<void> => undefined),
}));

vi.mock("./client", () => clientMocks);
vi.mock("../storage/secure", () => secureMocks);

import {
  clearWebSession,
  listWebUsers,
  getCurrentWebSession,
  loginWebSession,
} from "./webAuth";

describe("webAuth", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    clientMocks.getResolvedApiBaseUrl.mockClear();
    clientMocks.extractApiError.mockClear();
    secureMocks.clearStoredWebSession.mockClear();
    secureMocks.getStoredWebSession.mockClear();
    secureMocks.getStoredWebAccessExpiresAt.mockClear();
    secureMocks.getStoredWebAccessRole.mockClear();
    secureMocks.getStoredWebAccessToken.mockClear();
    secureMocks.getStoredWebAccessUsername.mockClear();
    secureMocks.setStoredWebSession.mockClear();
    delete (globalThis as { window?: unknown }).window;
    vi.stubGlobal("fetch", vi.fn());
  });

  it("preserves password whitespace in login payload", async () => {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        authenticated: true,
        access_token: "token-123",
        token_type: "Bearer",
        expires_in: 3600,
        expires_at: "2030-01-01T00:00:00.000Z",
        user: { username: "admin", role: "admin" },
      }),
    });

    await loginWebSession(" Admin ", "  pass with spaces  ");

    expect(fetchMock).toHaveBeenCalledOnce();
    const body = JSON.parse(
      (fetchMock.mock.calls[0]?.[1] as RequestInit)?.body as string,
    ) as Record<string, string>;
    expect(body.username).toBe("admin");
    expect(body.password).toBe("  pass with spaces  ");
    const headers = new Headers((fetchMock.mock.calls[0]?.[1] as RequestInit)?.headers);
    expect(headers.get("X-Client-Platform")).toBe("mobile");
  });

  it("throws API error message on 401 login response", async () => {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue({
      ok: false,
      json: async () => ({
        error: { message: "Credenciales invalidas." },
      }),
    });

    await expect(loginWebSession("admin", "bad-pass")).rejects.toThrow(
      "Credenciales invalidas.",
    );
  });

  it("injects bearer authorization header for web user listing", async () => {
    secureMocks.getStoredWebAccessToken.mockResolvedValueOnce("web-token-123");
    secureMocks.getStoredWebAccessExpiresAt.mockResolvedValueOnce(
      "2030-01-01T00:00:00.000Z",
    );
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, users: [] }),
    });

    await listWebUsers();

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://worker.example/web/auth/users");
    const headers = new Headers(init.headers);
    expect(headers.get("Authorization")).toBe("Bearer web-token-123");
    expect(headers.get("X-Client-Platform")).toBe("mobile");
  });

  it("uses cookie-backed web session requests without Authorization in browser runtime", async () => {
    (globalThis as { window?: unknown }).window = {
      sessionStorage: {
        getItem: vi.fn(() => null),
        setItem: vi.fn(),
        removeItem: vi.fn(),
      },
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, users: [] }),
    });

    await listWebUsers();

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = new Headers(init.headers);
    expect(headers.get("Authorization")).toBeNull();
    expect(headers.get("X-Client-Platform")).toBe("mobile");
    expect(init.credentials).toBe("include");
  });

  it("clears session when token is expired before making authorized request", async () => {
    secureMocks.getStoredWebAccessToken.mockResolvedValueOnce("expired-token");
    secureMocks.getStoredWebAccessExpiresAt.mockResolvedValueOnce(
      "2020-01-01T00:00:00.000Z",
    );
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;

    await expect(listWebUsers()).rejects.toThrow(
      "Sesion web expirada. Inicia sesion nuevamente.",
    );
    expect(secureMocks.clearStoredWebSession).toHaveBeenCalledOnce();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refreshes stored metadata from /web/auth/me without clearing native bearer state", async () => {
    secureMocks.getStoredWebAccessToken.mockResolvedValue("native-token-123");
    secureMocks.getStoredWebAccessExpiresAt.mockResolvedValue(
      "2030-01-01T00:30:00.000Z",
    );
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        authenticated: true,
        token_type: "Bearer",
        expires_in: 3600,
        expires_at: "2030-01-01T01:00:00.000Z",
        user: { username: "admin", role: "admin" },
      }),
    });

    await expect(getCurrentWebSession()).resolves.toMatchObject({
      authenticated: true,
      user: { username: "admin", role: "admin" },
    });
    expect(secureMocks.setStoredWebSession).toHaveBeenCalledWith({
      accessToken: "native-token-123",
      expiresAt: "2030-01-01T01:00:00.000Z",
      username: "admin",
      role: "admin",
    });
  });

  it("clears stored session via clearWebSession", async () => {
    await clearWebSession();
    expect(secureMocks.clearStoredWebSession).toHaveBeenCalledOnce();
  });
});
