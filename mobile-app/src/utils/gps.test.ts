import { describe, expect, it } from "vitest";

import {
  formatGpsStatusLabel,
  formatGpsSummary,
} from "./gps";

describe("gps utils", () => {
  it("formats captured gps summaries", () => {
    expect(
      formatGpsSummary({
        status: "captured",
        source: "browser",
        lat: -34.9011,
        lng: -56.1645,
        accuracy_m: 14.4,
      }),
    ).toContain("Precision 14 m");
  });

  it("formats fallback labels for pending or overridden gps", () => {
    expect(formatGpsStatusLabel("pending")).toBe("GPS pendiente");
    expect(
      formatGpsSummary({
        status: "override",
        source: "override",
        note: "Cliente pidio cierre remoto.",
      }).toLowerCase(),
    ).toContain("cierre manual");
  });
});
