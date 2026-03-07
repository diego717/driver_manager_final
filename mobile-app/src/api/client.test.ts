import { beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.EXPO_PUBLIC_API_BASE_URL = "https://worker.example";
  process.env.EXPO_PUBLIC_ALLOWED_API_ORIGINS =
    "https://worker.example,https://stored-worker.example";
});

const secureStoreMocks = vi.hoisted(() => ({
  getStoredApiBaseUrl: vi.fn(async (): Promise<string | null> => null),
  getStoredWebAccessToken: vi.fn(async (): Promise<string | null> => null),
  getStoredWebAccessExpiresAt: vi.fn(async (): Promise<string | null> => null),
  clearStoredWebSession: vi.fn(async (): Promise<void> => undefined),
}));

vi.mock("../storage/secure", () => secureStoreMocks);

import { hmacSha256Hex } from "./auth";
import {
  apiClient,
  assertSecureApiBaseUrl,
  assertTrustedApiBaseUrl,
  extractApiError,
  normalizeApiBaseUrl,
  signedJsonRequest,
} from "./client";

describe("api client", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    secureStoreMocks.getStoredApiBaseUrl.mockClear();
    secureStoreMocks.getStoredWebAccessToken.mockClear();
    secureStoreMocks.getStoredWebAccessExpiresAt.mockClear();
    secureStoreMocks.clearStoredWebSession.mockClear();
  });

  it("sends bearer request using normalized /web path", async () => {
    secureStoreMocks.getStoredWebAccessToken.mockResolvedValueOnce("web-access-token");
    secureStoreMocks.getStoredWebAccessExpiresAt.mockResolvedValueOnce("2030-01-01T00:00:00.000Z");

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

    const call = requestSpy.mock.calls[0][0];
    expect(call.url).toBe("/web/installations");
    expect(call.baseURL).toBe("https://worker.example");
    expect(call.headers).toMatchObject({
      "Content-Type": "application/json",
      Authorization: "Bearer web-access-token",
      "X-Client-Platform": "mobile",
    });
  });

  it("fails when there is no active bearer session", async () => {
    secureStoreMocks.getStoredWebAccessToken.mockResolvedValueOnce(null);
    secureStoreMocks.getStoredWebAccessExpiresAt.mockResolvedValueOnce(null);

    await expect(
      signedJsonRequest<{ ok: boolean }>({
        method: "GET",
        path: "/installations",
      }),
    ).rejects.toThrow(/Sesion web requerida/i);
  });

  it("uses stored API base URL when present", async () => {
    secureStoreMocks.getStoredApiBaseUrl.mockResolvedValueOnce("https://stored-worker.example/");
    secureStoreMocks.getStoredWebAccessToken.mockResolvedValueOnce("web-access-token");
    secureStoreMocks.getStoredWebAccessExpiresAt.mockResolvedValueOnce("2030-01-01T00:00:00.000Z");
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

  it("rejects stored API base URL when origin is not in allowlist", async () => {
    secureStoreMocks.getStoredApiBaseUrl.mockResolvedValueOnce("https://evil.example");
    secureStoreMocks.getStoredWebAccessToken.mockResolvedValueOnce("web-access-token");
    secureStoreMocks.getStoredWebAccessExpiresAt.mockResolvedValueOnce("2030-01-01T00:00:00.000Z");

    await expect(
      signedJsonRequest<{ ok: boolean }>({
        method: "GET",
        path: "/installations",
      }),
    ).rejects.toThrow(/no confiable/i);
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

  it("maps network fetch errors to actionable message", () => {
    expect(extractApiError(new Error("Failed to fetch"))).toMatch(/No se pudo conectar con la API/i);
  });

  it("normalizes base URL when /web is included by mistake", () => {
    expect(normalizeApiBaseUrl("https://worker.example/web")).toBe("https://worker.example");
    expect(normalizeApiBaseUrl("https://worker.example/web/")).toBe("https://worker.example");
    expect(normalizeApiBaseUrl("https://worker.example/web/installations")).toBe(
      "https://worker.example",
    );
  });

  it("accepts https API base URLs", () => {
    expect(assertSecureApiBaseUrl("https://worker.example")).toBe("https://worker.example");
  });

  it("rejects http API base URLs outside debug local", () => {
    expect(() =>
      assertSecureApiBaseUrl("http://worker.example", {
        isDevRuntime: false,
        allowHttpInDebug: false,
      }),
    ).toThrow(/se requiere https en release/i);
  });

  it("allows local http API base URL only in debug with explicit override", () => {
    expect(
      assertSecureApiBaseUrl("http://localhost:8787", {
        isDevRuntime: true,
        allowHttpInDebug: true,
      }),
    ).toBe("http://localhost:8787");
  });

  it("rejects local http API base URL if override is disabled", () => {
    expect(() =>
      assertSecureApiBaseUrl("http://localhost:8787", {
        isDevRuntime: true,
        allowHttpInDebug: false,
      }),
    ).toThrow(/se requiere https en release/i);
  });

  it("rejects non-allowlisted https origins", () => {
    expect(() => assertTrustedApiBaseUrl("https://unknown.example")).toThrow(/no confiable/i);
  });
});
