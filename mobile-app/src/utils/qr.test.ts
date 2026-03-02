import { describe, expect, test } from "vitest";
import { buildQrPayload, normalizeAssetCodeForQr } from "./qr";

describe("qr payload utils", () => {
  test("builds installation payload", () => {
    expect(buildQrPayload("installation", "42")).toBe("dm://installation/42");
  });

  test("builds asset payload", () => {
    expect(buildQrPayload("asset", "EQ-ABC-001")).toBe("dm://asset/EQ-ABC-001");
  });

  test("normalizes and truncates asset code", () => {
    const raw = `  EQ     ${"A".repeat(200)}  `;
    const value = normalizeAssetCodeForQr(raw);
    expect(value.startsWith("EQ A")).toBe(true);
    expect(value.length).toBe(128);
  });

  test("throws on invalid installation id", () => {
    expect(() => buildQrPayload("installation", "abc")).toThrow(/entero positivo/i);
  });
});
