import { describe, expect, test } from "vitest";
import { buildQrPayload, normalizeAssetCodeForQr } from "./qr";

describe("qr payload utils", () => {
  test("builds installation payload", () => {
    expect(buildQrPayload("installation", "42")).toBe("dm://installation/42");
  });

  test("builds asset payload", () => {
    expect(buildQrPayload("asset", "EQ-ABC-001")).toBe("dm://asset/EQ-ABC-001");
  });

  test("builds enriched asset payload with embedded metadata", () => {
    expect(
      buildQrPayload("asset", "EQ-ABC-001", {
        brand: "Entrust",
        model: "Sigma SL3",
        serial_number: "SN-001",
        client_name: "QA Bank",
      }),
    ).toBe(
      "dm://asset/EQ-ABC-001?v=2&brand=Entrust&model=Sigma+SL3&serial_number=SN-001&client_name=QA+Bank",
    );
  });

  test("normalizes and truncates asset code", () => {
    const raw = `  EQ     ${"A".repeat(200)}  `;
    const value = normalizeAssetCodeForQr(raw);
    expect(value.startsWith("EQ A")).toBe(true);
    expect(value.length).toBe(128);
  });

  test("drops metadata when all fields are empty after normalization", () => {
    expect(
      buildQrPayload("asset", "EQ-ABC-001", {
        brand: "   ",
        model: "",
        serial_number: "",
        client_name: "",
        notes: "",
      }),
    ).toBe("dm://asset/EQ-ABC-001");
  });

  test("throws on invalid installation id", () => {
    expect(() => buildQrPayload("installation", "abc")).toThrow(/entero positivo/i);
  });
});
