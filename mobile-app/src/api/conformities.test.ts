import { beforeEach, describe, expect, it, vi } from "vitest";

const clientMocks = vi.hoisted(() => ({
  signedJsonRequest: vi.fn(),
}));

vi.mock("./client", () => clientMocks);

import {
  createInstallationConformity,
  getInstallationConformity,
} from "./conformities";

describe("conformities api", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("normalizes create responses into typed numeric conformity fields", async () => {
    clientMocks.signedJsonRequest.mockResolvedValueOnce({
      success: true,
      conformity: {
        id: "9",
        installation_id: "45",
        generated_by_user_id: "18",
        session_version: "4",
        photo_count: "3",
        status: "emailed",
      },
    });

    const response = await createInstallationConformity(45, {
      recipient_email: "ops@example.com",
    } as any);

    expect(response.conformity).toEqual({
      id: 9,
      installation_id: 45,
      generated_by_user_id: 18,
      session_version: 4,
      photo_count: 3,
      status: "emailed",
    });
    expect(clientMocks.signedJsonRequest).toHaveBeenCalledWith({
      method: "POST",
      path: "/installations/45/conformity",
      data: {
        recipient_email: "ops@example.com",
      },
    });
  });

  it("maps unknown statuses to generated and null payloads to null", async () => {
    clientMocks.signedJsonRequest
      .mockResolvedValueOnce({
        conformity: {
          id: 7,
          installation_id: 45,
          generated_by_user_id: "",
          session_version: null,
          photo_count: -4,
          status: "queued",
        },
      })
      .mockResolvedValueOnce({
        conformity: null,
      });

    const conformity = await getInstallationConformity(45);
    const empty = await getInstallationConformity(45);

    expect(conformity).toEqual({
      id: 7,
      installation_id: 45,
      generated_by_user_id: null,
      session_version: null,
      photo_count: 0,
      status: "generated",
    });
    expect(empty).toBeNull();
  });

  it("throws when the API returns an invalid conformity id", async () => {
    clientMocks.signedJsonRequest.mockResolvedValueOnce({
      conformity: {
        id: "bad-id",
        installation_id: "45",
      },
    });

    await expect(getInstallationConformity(45)).rejects.toThrow(
      "conformity.id invalido recibido desde API.",
    );
  });
});
