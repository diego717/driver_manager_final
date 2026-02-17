import { describe, expect, it } from "vitest";

import {
  contentTypeFromFileName,
  ensureNonEmpty,
  ensurePositiveInt,
} from "./validation";

describe("validation utils", () => {
  it("accepts positive integers", () => {
    expect(() => ensurePositiveInt(1, "id")).not.toThrow();
  });

  it("rejects non-positive integers", () => {
    expect(() => ensurePositiveInt(0, "id")).toThrow(/positive integer/i);
    expect(() => ensurePositiveInt(1.5, "id")).toThrow(/positive integer/i);
    expect(() => ensurePositiveInt(-2, "id")).toThrow(/positive integer/i);
  });

  it("rejects empty text values", () => {
    expect(() => ensureNonEmpty("", "name")).toThrow(/required/i);
    expect(() => ensureNonEmpty("   ", "name")).toThrow(/required/i);
  });

  it("detects content type by file extension", () => {
    expect(contentTypeFromFileName("photo.png")).toBe("image/png");
    expect(contentTypeFromFileName("photo.webp")).toBe("image/webp");
    expect(contentTypeFromFileName("photo.jpg")).toBe("image/jpeg");
    expect(contentTypeFromFileName("photo.unknown")).toBe("image/jpeg");
  });
});
