import { describe, expect, it } from "vitest";

import {
  normalizeAssetIdentifierForCompare,
  normalizePreviewLabelDraft,
  validatePreviewLabelDraft,
} from "./asset-label-preview";

describe("asset label preview utils", () => {
  it("normalizes identifiers and text fields", () => {
    expect(normalizePreviewLabelDraft({
      external_code: " eq- 99 ",
      brand: "  Entrust   ",
      model: " Sigma   SL3 ",
      serial_number: " sn-  77 ",
      client_name: " Banco  Norte ",
      notes: "  etiqueta  lateral ",
    })).toEqual({
      external_code: "EQ-99",
      brand: "Entrust",
      model: "Sigma SL3",
      serial_number: "SN-77",
      client_name: "Banco Norte",
      notes: "etiqueta lateral",
    });
  });

  it("fills serial with external code when missing", () => {
    expect(normalizePreviewLabelDraft({
      external_code: "atm-4",
      brand: "",
      model: "",
      serial_number: "",
      client_name: "",
      notes: "",
    }).serial_number).toBe("ATM-4");
  });

  it("returns validation errors for required fields", () => {
    const validation = validatePreviewLabelDraft({
      external_code: " ",
      brand: "",
      model: "",
      serial_number: " ",
      client_name: "",
      notes: "",
    });

    expect(validation.isValid).toBe(false);
    expect(validation.errors).toEqual({
      external_code: "Codigo externo requerido.",
      serial_number: "Serie requerida.",
    });
  });

  it("normalizes compare identifiers consistently", () => {
    expect(normalizeAssetIdentifierForCompare(" sn- 001 ")).toBe("SN-001");
  });
});

