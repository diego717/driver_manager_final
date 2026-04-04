import { beforeEach, describe, expect, it, vi } from "vitest";

const clientMocks = vi.hoisted(() => ({
  signedJsonRequest: vi.fn(),
}));

vi.mock("./client", () => clientMocks);

import {
  createInstallationPublicTrackingLink,
  deleteInstallationPublicTrackingLink,
  getInstallationPublicTrackingLink,
} from "./public-tracking";

describe("public-tracking api", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("normalizes nullable link fields from GET responses", async () => {
    clientMocks.signedJsonRequest.mockResolvedValueOnce({
      link: {
        installation_id: "45",
        active: true,
        token_id: 123,
        tracking_url: "",
      },
    });

    const link = await getInstallationPublicTrackingLink(45);

    expect(link).toEqual({
      installation_id: 45,
      active: true,
      token_id: null,
      tracking_url: "",
    });
    expect(clientMocks.signedJsonRequest).toHaveBeenCalledWith({
      method: "GET",
      path: "/installations/45/public-tracking-link",
    });
  });

  it("normalizes inactive create responses and keeps missing installation ids as null", async () => {
    clientMocks.signedJsonRequest.mockResolvedValueOnce({
      link: {
        installation_id: "",
        active: false,
        token_id: "token-1",
        tracking_url: "https://estado.example/track/ABC",
      },
    });

    const link = await createInstallationPublicTrackingLink(12);

    expect(link).toEqual({
      installation_id: null,
      active: false,
      token_id: "token-1",
      tracking_url: "https://estado.example/track/ABC",
    });
  });

  it("deletes the public tracking link using the installation route", async () => {
    clientMocks.signedJsonRequest.mockResolvedValueOnce({ success: true });

    await deleteInstallationPublicTrackingLink(7);

    expect(clientMocks.signedJsonRequest).toHaveBeenCalledWith({
      method: "DELETE",
      path: "/installations/7/public-tracking-link",
    });
  });
});
