import { describe, expect, it } from "vitest";

import { sanitizeStoredSyncMessage } from "./sync-errors";

describe("sanitizeStoredSyncMessage", () => {
  it("redacts local file paths and file URIs before they reach SQLite", () => {
    const sanitized = sanitizeStoredSyncMessage(
      "Upload failed for file:///data/user/0/app/cache/customer-claim.jpg at C:\\Users\\Diego\\Desktop\\customer-claim.jpg",
    );

    expect(sanitized).toContain("[redacted-file]");
    expect(sanitized).toContain("[redacted-path]");
    expect(sanitized).not.toContain("customer-claim.jpg");
    expect(sanitized).not.toContain("C:\\Users\\Diego");
  });

  it("trims oversized error messages to a safe stored length", () => {
    const raw = `server said: ${"x".repeat(400)}`;
    const sanitized = sanitizeStoredSyncMessage(raw);

    expect(sanitized).not.toBeNull();
    expect((sanitized || "").length).toBeLessThanOrEqual(180);
  });
});
