import { beforeEach, describe, expect, it, vi } from "vitest";

const clientMocks = vi.hoisted(() => ({
  getResolvedApiBaseUrl: vi.fn(async () => "https://worker.example"),
  extractApiError: vi.fn((error: unknown) =>
    error instanceof Error ? error.message : String(error),
  ),
}));

const secureMocks = vi.hoisted(() => ({
  clearStoredWebSession: vi.fn(async (): Promise<void> => undefined),
  getStoredWebAccessExpiresAt: vi.fn(async (): Promise<string | null> => null),
  getStoredWebAccessRole: vi.fn(async (): Promise<string | null> => null),
  getStoredWebAccessToken: vi.fn(async (): Promise<string | null> => null),
  getStoredWebAccessUsername: vi.fn(async (): Promise<string | null> => null),
  setStoredWebAccessExpiresAt: vi.fn(async (): Promise<void> => undefined),
  setStoredWebAccessRole: vi.fn(async (): Promise<void> => undefined),
  setStoredWebAccessToken: vi.fn(async (): Promise<void> => undefined),
  setStoredWebAccessUsername: vi.fn(async (): Promise<void> => undefined),
}));

vi.mock("./client", () => clientMocks);
vi.mock("../storage/secure", () => secureMocks);

import {
  clearWebSession,
  listWebUsers,
  loginWebSession,
} from "./webAuth";

describe("webAuth", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    clientMocks.getResolvedApiBaseUrl.mockClear();
    clientMocks.extractApiError.mockClear();
    secureMocks.clearStoredWebSession.mockClear();
    secureMocks.getStoredWebAccessExpiresAt.mockClear();
    secureMocks.getStoredWebAccessRole.mockClear();
    secureMocks.getStoredWebAccessToken.mockClear();
    secureMocks.getStoredWebAccessUsername.mockClear();
    secureMocks.setStoredWebAccessExpiresAt.mockClear();
    secureMocks.setStoredWebAccessRole.mockClear();
    secureMocks.setStoredWebAccessToken.mockClear();
    secureMocks.setStoredWebAccessUsername.mockClear();
    vi.stubGlobal("fetch", vi.fn());
  });

  it("preserves password whitespace in login payload", async () => {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
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

  it("clears stored session via clearWebSession", async () => {
    await clearWebSession();
    expect(secureMocks.clearStoredWebSession).toHaveBeenCalledOnce();
  });
});
