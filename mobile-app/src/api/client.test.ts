import { beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.EXPO_PUBLIC_API_BASE_URL = "https://worker.example";
});

const secureStoreMocks = vi.hoisted(() => ({
  getStoredApiToken: vi.fn(async () => null),
  getStoredApiSecret: vi.fn(async () => null),
}));

vi.mock("../storage/secure", () => secureStoreMocks);

import { hmacSha256Hex } from "./auth";
import { apiClient, extractApiError, signedJsonRequest } from "./client";

describe("api client", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    secureStoreMocks.getStoredApiToken.mockClear();
    secureStoreMocks.getStoredApiSecret.mockClear();
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
    expect(secureStoreMocks.getStoredApiToken).not.toHaveBeenCalled();
    expect(secureStoreMocks.getStoredApiSecret).not.toHaveBeenCalled();

    const call = requestSpy.mock.calls[0][0];
    const expectedBodyHash =
      "4062edaf750fb8074e7e83e0c9028c94e32468a8b6f1614774328ef045150f93";
    const expectedCanonical =
      `POST|/installations|1700000000|${expectedBodyHash}`;

    expect(call.url).toBe("/installations");
    expect(call.headers).toMatchObject({
      "Content-Type": "application/json",
      "X-API-Token": "token-123",
      "X-Request-Timestamp": "1700000000",
      "X-Request-Signature": hmacSha256Hex("secret-abc", expectedCanonical),
    });
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
