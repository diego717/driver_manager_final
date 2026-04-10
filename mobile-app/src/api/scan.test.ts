import { beforeEach, describe, expect, it, vi } from "vitest";

const clientMocks = vi.hoisted(() => ({
  signedJsonRequest: vi.fn(),
}));

vi.mock("./client", () => clientMocks);

import { extractAssetLabelFromImage, lookupCode } from "./scan";

describe("scan api", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls lookup endpoint for asset codes", async () => {
    clientMocks.signedJsonRequest.mockResolvedValueOnce({
      success: true,
      match: {
        type: "asset",
      },
    });

    await lookupCode(" EQ-01 ", "asset");

    expect(clientMocks.signedJsonRequest).toHaveBeenCalledWith({
      method: "GET",
      path: "/lookup?code=EQ-01&type=asset",
    });
  });

  it("posts image payload to scan asset-label endpoint", async () => {
    clientMocks.signedJsonRequest.mockResolvedValueOnce({
      success: true,
      provider: "openai",
      model: "gpt-4.1-mini",
      label: {
        external_code: "EQ-99",
        brand: "Acme",
        model: "Z3",
        serial_number: "SN-99",
        client_name: "",
        notes: "",
        confidence: 0.88,
      },
    });

    const response = await extractAssetLabelFromImage({
      imageBase64: "  YmFzZTY0LWRhdGE=  ",
      mimeType: "image/png",
    });

    expect(clientMocks.signedJsonRequest).toHaveBeenCalledWith({
      method: "POST",
      path: "/scan/asset-label",
      data: {
        image_base64: "YmFzZTY0LWRhdGE=",
        mime_type: "image/png",
      },
    });
    expect(response.label.external_code).toBe("EQ-99");
  });
});
