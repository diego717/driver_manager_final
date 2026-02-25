import { describe, expect, it } from "vitest";

import { sha256HexFromBytes, sha256HexFromString } from "./auth";

describe("auth hash helpers", () => {
  it("computes SHA256 from string", () => {
    expect(sha256HexFromString("hello")).toBe(
      "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
    );
  });

  it("computes SHA256 from bytes", () => {
    const bytes = Uint8Array.from([104, 101, 108, 108, 111]);
    expect(sha256HexFromBytes(bytes)).toBe(
      "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
    );
  });
});
