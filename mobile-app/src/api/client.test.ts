import { beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.EXPO_PUBLIC_API_BASE_URL = "https://worker.example";
});

const secureStoreMocks = vi.hoisted(() => ({
  getStoredApiBaseUrl: vi.fn(async (): Promise<string | null> => null),
  getStoredApiToken: vi.fn(async (): Promise<string | null> => null),
  getStoredApiSecret: vi.fn(async (): Promise<string | null> => null),
  getStoredWebAccessToken: vi.fn(async (): Promise<string | null> => null),
  getStoredWebAccessExpiresAt: vi.fn(async (): Promise<string | null> => null),
  clearStoredWebSession: vi.fn(async (): Promise<void> => undefined),
}));

vi.mock("../storage/secure", () => secureStoreMocks);

import { hmacSha256Hex } from "./auth";
import { apiClient, extractApiError, signedJsonRequest } from "./client";

describe("api client", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    secureStoreMocks.getStoredApiBaseUrl.mockClear();
    secureStoreMocks.getStoredApiToken.mockClear();
    secureStoreMocks.getStoredApiSecret.mockClear();
    secureStoreMocks.getStoredWebAccessToken.mockClear();
    secureStoreMocks.getStoredWebAccessExpiresAt.mockClear();
    secureStoreMocks.clearStoredWebSession.mockClear();
    process.env.EXPO_PUBLIC_API_TOKEN = "token-123";
    process.env.EXPO_PUBLIC_API_SECRET = "secret-abc";
  });

  it("sends signed json request with normalized path", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1700000000000);
    const requestSpy = vi
      .spyOn(apiClient, "request")
      .mockResolvedValue({ data: { success: true } });

    const response = await signedJsonRequest<{ success: boolean }>({
      method: "POST",
      path: "installations",
      data: { ok: true },
    });

    expect(response).toEqual({ success: true });
    expect(requestSpy).toHaveBeenCalledOnce();
    expect(secureStoreMocks.getStoredApiBaseUrl).toHaveBeenCalledOnce();
    expect(secureStoreMocks.getStoredApiToken).not.toHaveBeenCalled();
    expect(secureStoreMocks.getStoredApiSecret).not.toHaveBeenCalled();

    const call = requestSpy.mock.calls[0][0];
    const expectedBodyHash =
      "4062edaf750fb8074e7e83e0c9028c94e32468a8b6f1614774328ef045150f93";
    const expectedCanonical =
      `POST|/installations|1700000000|${expectedBodyHash}`;

    expect(call.url).toBe("/installations");
    expect(call.baseURL).toBe("https://worker.example");
    expect(call.headers).toMatchObject({
      "Content-Type": "application/json",
      "X-API-Token": "token-123",
      "X-Request-Timestamp": "1700000000",
      "X-Request-Signature": hmacSha256Hex("secret-abc", expectedCanonical),
    });
  });

  it("uses stored API base URL when present", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1700000000000);
    secureStoreMocks.getStoredApiBaseUrl.mockResolvedValueOnce("https://stored-worker.example/");
    const requestSpy = vi
      .spyOn(apiClient, "request")
      .mockResolvedValue({ data: { ok: true } });

    await signedJsonRequest<{ ok: boolean }>({
      method: "GET",
      path: "/installations",
    });

    expect(requestSpy).toHaveBeenCalledOnce();
    const call = requestSpy.mock.calls[0][0];
    expect(call.baseURL).toBe("https://stored-worker.example");
  });

  it("uses web bearer session and /web path when session token exists", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1700000000000);
    secureStoreMocks.getStoredWebAccessToken.mockResolvedValueOnce("web-access-token");
    secureStoreMocks.getStoredWebAccessExpiresAt.mockResolvedValueOnce("2030-01-01T00:00:00.000Z");

    const requestSpy = vi
      .spyOn(apiClient, "request")
      .mockResolvedValue({ data: [{ id: 1 }] });

    await signedJsonRequest<Array<{ id: number }>>({
      method: "GET",
      path: "/installations",
    });

    expect(requestSpy).toHaveBeenCalledOnce();
    const call = requestSpy.mock.calls[0][0];
    const headers = (call.headers ?? {}) as Record<string, unknown>;
    expect(call.url).toBe("/web/installations");
    expect(headers).toMatchObject({
      Authorization: "Bearer web-access-token",
    });
    expect(headers["X-API-Token"]).toBeUndefined();
    expect(headers["X-Request-Signature"]).toBeUndefined();
  });

  it("extracts message from axios-like API error payload", () => {
    const err = {
      isAxiosError: true,
      message: "Request failed",
      response: {
        data: {
          error: {
            message: "API says no",
          },
        },
      },
    };

    expect(extractApiError(err)).toBe("API says no");
  });

  it("extracts message from generic error instances", () => {
    expect(extractApiError(new Error("boom"))).toBe("boom");
  });
});
