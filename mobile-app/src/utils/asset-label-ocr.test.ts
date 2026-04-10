import { describe, expect, it } from "vitest";

import { parseAssetLabelCandidateFromTextLines, parseAssetLabelFromTextLines } from "./asset-label-ocr";

describe("asset-label ocr parser", () => {
  it("extracts labeled fields from common asset tags", () => {
    const parsed = parseAssetLabelFromTextLines([
      "Marca: Entrust",
      "Modelo: Sigma SL3",
      "Serial: SN-98765",
      "Codigo externo: ATM-0009",
      "Cliente: Banco Norte",
    ]);

    expect(parsed).toEqual({
      external_code: "ATM-0009",
      brand: "Entrust",
      model: "Sigma SL3",
      serial_number: "SN-98765",
      client_name: "Banco Norte",
      notes: "Marca: Entrust | Modelo: Sigma SL3 | Serial: SN-98765 | Codigo externo: ATM-0009",
    });
  });

  it("falls back to token detection when no explicit labels are present", () => {
    const parsed = parseAssetLabelFromTextLines([
      "SITIO 14",
      "EQUIPO ATM-8821",
      "PLANTA CENTRO",
    ]);

    expect(parsed).toEqual({
      external_code: "ATM-8821",
      brand: "",
      model: "",
      serial_number: "ATM-8821",
      client_name: "",
      notes: "SITIO 14 | EQUIPO ATM-8821 | PLANTA CENTRO",
    });
  });

  it("returns null when no usable code can be extracted", () => {
    expect(parseAssetLabelFromTextLines(["Etiqueta ilegible", "Sin datos"])).toBeNull();
  });

  it("computes high confidence when multiple labeled fields are detected", () => {
    const parsed = parseAssetLabelCandidateFromTextLines([
      "Codigo externo: ATM-0009",
      "Serial: SN-98765",
      "Marca: Entrust",
      "Modelo: Sigma SL3",
      "Cliente: Banco Norte",
    ]);

    expect(parsed.label?.external_code).toBe("ATM-0009");
    expect(parsed.confidence).toBeGreaterThanOrEqual(0.85);
  });

  it("computes lower confidence when only fallback token exists", () => {
    const parsed = parseAssetLabelCandidateFromTextLines([
      "Equipo ATM-8821",
    ]);

    expect(parsed.label?.external_code).toBe("ATM-8821");
    expect(parsed.confidence).toBeLessThanOrEqual(0.5);
  });
});
