import { describe, expect, it } from "vitest";

import { parseScannedPayload } from "./scan";

describe("scan payload parser", () => {
  it("parses installation dm uri", () => {
    expect(parseScannedPayload("dm://installation/42")).toEqual({
      type: "installation",
      raw: "dm://installation/42",
      installationId: 42,
    });
  });

  it("parses asset dm uri", () => {
    expect(parseScannedPayload("dm://asset/EQ-ABC-001")).toEqual({
      type: "asset",
      raw: "dm://asset/EQ-ABC-001",
      externalCode: "EQ-ABC-001",
    });
  });

  it("accepts plain positive number as installation id", () => {
    expect(parseScannedPayload("88")).toEqual({
      type: "installation",
      raw: "88",
      installationId: 88,
    });
  });

  it("rejects invalid payload", () => {
    expect(parseScannedPayload("dm://installation/abc")).toBeNull();
    expect(parseScannedPayload("http://example.com")).toBeNull();
    expect(parseScannedPayload("   ")).toBeNull();
  });
});
