import { describe, expect, it, vi } from "vitest";

import { evaluateWebSession, resolveWebSession } from "./webSession";

describe("webSession helpers", () => {
  it("returns missing state when token is absent", () => {
    const resolved = evaluateWebSession(null, "2030-01-01T00:00:00.000Z");
    expect(resolved).toEqual({
      state: "missing",
      accessToken: null,
    });
  });

  it("returns expired state when expiry is invalid", () => {
    const resolved = evaluateWebSession("token-123", "invalid-date", 1000);
    expect(resolved).toEqual({
      state: "expired",
      accessToken: null,
    });
  });

  it("returns active state when token exists and expiry is valid", () => {
    const now = Date.parse("2026-02-22T10:00:00.000Z");
    const resolved = evaluateWebSession(
      "token-123",
      "2026-02-22T11:00:00.000Z",
      now,
    );
    expect(resolved).toEqual({
      state: "active",
      accessToken: "token-123",
    });
  });

  it("runs onExpired callback for expired sessions", async () => {
    const onExpired = vi.fn(async () => undefined);
    vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-02-22T10:00:00.000Z"));

    const resolved = await resolveWebSession({
      getAccessToken: async () => "expired-token",
      getExpiresAt: async () => "2026-02-22T09:00:00.000Z",
      onExpired,
    });

    expect(resolved.state).toBe("expired");
    expect(onExpired).toHaveBeenCalledOnce();
  });
});
