import { beforeEach, describe, expect, it, vi } from "vitest";

const clientMocks = vi.hoisted(() => ({
  signedJsonRequest: vi.fn(),
  extractApiError: vi.fn((error: unknown) =>
    error instanceof Error ? error.message : String(error),
  ),
}));

const secureStoreMocks = vi.hoisted(() => ({
  getStoredWebAccessToken: vi.fn(),
  getStoredWebAccessExpiresAt: vi.fn(),
}));

vi.mock("./client", () => clientMocks);
vi.mock("../storage/secure", () => secureStoreMocks);

import { registerDeviceToken } from "./devices";

describe("devices api", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-02-21T00:00:00.000Z"));
  });

  it("returns false when there is no active web session", async () => {
    secureStoreMocks.getStoredWebAccessToken.mockResolvedValueOnce(null);
    secureStoreMocks.getStoredWebAccessExpiresAt.mockResolvedValueOnce(null);

    const registered = await registerDeviceToken({
      fcmToken: "token-12345",
      platform: "android",
    });

    expect(registered).toBe(false);
    expect(clientMocks.signedJsonRequest).not.toHaveBeenCalled();
  });

  it("returns false when web session is expired", async () => {
    secureStoreMocks.getStoredWebAccessToken.mockResolvedValueOnce("access-token");
    secureStoreMocks.getStoredWebAccessExpiresAt.mockResolvedValueOnce(
      "2026-02-20T23:59:00.000Z",
    );

    const registered = await registerDeviceToken({
      fcmToken: "token-12345",
      platform: "android",
    });

    expect(registered).toBe(false);
    expect(clientMocks.signedJsonRequest).not.toHaveBeenCalled();
  });

  it("registers token through /devices when web session is active", async () => {
    secureStoreMocks.getStoredWebAccessToken.mockResolvedValueOnce("access-token");
    secureStoreMocks.getStoredWebAccessExpiresAt.mockResolvedValueOnce(
      "2026-02-21T01:00:00.000Z",
    );
    clientMocks.signedJsonRequest.mockResolvedValueOnce({
      success: true,
      registered: true,
    });

    const registered = await registerDeviceToken({
      fcmToken: "token-12345",
      deviceModel: "Pixel 8",
      appVersion: "1.0.0",
      platform: "android",
    });

    expect(registered).toBe(true);
    expect(clientMocks.signedJsonRequest).toHaveBeenCalledWith({
      method: "POST",
      path: "/devices",
      data: {
        fcm_token: "token-12345",
        device_model: "Pixel 8",
        app_version: "1.0.0",
        platform: "android",
      },
    });
  });

  it("rejects empty token input", async () => {
    await expect(registerDeviceToken({ fcmToken: "   " })).rejects.toThrow(/fcmToken/i);
  });
});
