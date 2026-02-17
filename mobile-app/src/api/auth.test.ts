import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildAuthHeaders,
  buildCanonical,
  getAuthMaterial,
  hmacSha256Hex,
  sha256HexFromString,
} from "./auth";

describe("auth helpers", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    delete process.env.EXPO_PUBLIC_API_TOKEN;
    delete process.env.EXPO_PUBLIC_API_SECRET;
  });

  it("reads auth material from env", () => {
    process.env.EXPO_PUBLIC_API_TOKEN = "token-123";
    process.env.EXPO_PUBLIC_API_SECRET = "secret-abc";

    expect(getAuthMaterial()).toEqual({
      token: "token-123",
      secret: "secret-abc",
    });
  });

  it("builds dev headers when token/secret are missing", () => {
    vi.spyOn(Date, "now").mockReturnValue(1700000000000);

    const headers = buildAuthHeaders({
      method: "GET",
      path: "/installations",
      bodyHash: sha256HexFromString(""),
    });

    expect(headers["X-Request-Timestamp"]).toBe("1700000000");
    expect(headers["X-Request-Signature"]).toBe("dev-signature");
    expect(headers["X-API-Token"]).toBeUndefined();
  });

  it("builds signed headers when token/secret are provided", () => {
    vi.spyOn(Date, "now").mockReturnValue(1700000000000);
    const bodyHash = sha256HexFromString('{"ok":true}');

    const headers = buildAuthHeaders({
      method: "POST",
      path: "/installations",
      bodyHash,
      token: "token-123",
      secret: "secret-abc",
    });

    const canonical = buildCanonical({
      method: "POST",
      path: "/installations",
      timestamp: "1700000000",
      bodyHash,
    });

    expect(headers).toEqual({
      "X-API-Token": "token-123",
      "X-Request-Timestamp": "1700000000",
      "X-Request-Signature": hmacSha256Hex("secret-abc", canonical),
    });
  });
});
