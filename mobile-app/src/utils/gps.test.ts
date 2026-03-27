import { describe, expect, it } from "vitest";

import {
  evaluateGeofencePreview,
  formatGeofenceSummary,
  formatGpsStatusLabel,
  formatGpsSummary,
  hasInstallationSiteConfig,
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

  it("detects configured geofence sites", () => {
    expect(
      hasInstallationSiteConfig({
        site_lat: -34.9,
        site_lng: -56.16,
        site_radius_m: 120,
      }),
    ).toBe(true);
  });

  it("evaluates when a capture is inside the site radius", () => {
    const preview = evaluateGeofencePreview(
      {
        status: "captured",
        source: "browser",
        lat: -34.901,
        lng: -56.1644,
        accuracy_m: 10,
      },
      {
        site_lat: -34.9011,
        site_lng: -56.1645,
        site_radius_m: 80,
      },
    );

    expect(preview.result).toBe("inside");
    expect(formatGeofenceSummary(preview)).toContain("Dentro del radio");
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
