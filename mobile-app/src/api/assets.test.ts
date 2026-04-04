import { beforeEach, describe, expect, it, vi } from "vitest";

const clientMocks = vi.hoisted(() => ({
  signedJsonRequest: vi.fn(),
}));

vi.mock("./client", () => clientMocks);

import {
  deleteAsset,
  getAssetIncidents,
  linkAssetToInstallation,
  listAssets,
  resolveAssetByExternalCode,
  updateAsset,
} from "./assets";

describe("assets api", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects empty external codes before hitting the API", async () => {
    await expect(resolveAssetByExternalCode("   ")).rejects.toThrow(
      "Codigo externo de equipo requerido.",
    );
    expect(clientMocks.signedJsonRequest).not.toHaveBeenCalled();
  });

  it("trims external code and forwards optional resolve payload", async () => {
    clientMocks.signedJsonRequest.mockResolvedValueOnce({ success: true });

    await resolveAssetByExternalCode(" EQ-44 ", { client_name: "Cliente Demo" });

    expect(clientMocks.signedJsonRequest).toHaveBeenCalledWith({
      method: "POST",
      path: "/assets/resolve",
      data: {
        external_code: "EQ-44",
        client_name: "Cliente Demo",
      },
    });
  });

  it("builds filtered asset list queries and falls back to an empty list", async () => {
    clientMocks.signedJsonRequest.mockResolvedValueOnce({ items: null });

    const items = await listAssets({
      code: " EQ-1 ",
      search: " cliente ",
      status: " active ",
      limit: 20,
    });

    expect(items).toEqual([]);
    expect(clientMocks.signedJsonRequest).toHaveBeenCalledWith({
      method: "GET",
      path: "/assets?code=EQ-1&search=cliente&status=active&limit=20",
    });
  });

  it("trims notes when linking an asset to an installation", async () => {
    clientMocks.signedJsonRequest.mockResolvedValueOnce({ success: true });

    await linkAssetToInstallation(11, 45, "  desde mobile  ");

    expect(clientMocks.signedJsonRequest).toHaveBeenCalledWith({
      method: "POST",
      path: "/assets/11/link-installation",
      data: {
        installation_id: 45,
        notes: "desde mobile",
      },
    });
  });

  it("adds incident limit only when it is a positive integer", async () => {
    clientMocks.signedJsonRequest.mockResolvedValueOnce({ success: true });
    await getAssetIncidents(9, { limit: 5 });
    expect(clientMocks.signedJsonRequest).toHaveBeenLastCalledWith({
      method: "GET",
      path: "/assets/9/incidents?limit=5",
    });

    clientMocks.signedJsonRequest.mockResolvedValueOnce({ success: true });
    await getAssetIncidents(9, { limit: 0 });
    expect(clientMocks.signedJsonRequest).toHaveBeenLastCalledWith({
      method: "GET",
      path: "/assets/9/incidents",
    });
  });

  it("uses patch and delete routes for asset updates", async () => {
    clientMocks.signedJsonRequest.mockResolvedValue({ success: true });

    await updateAsset(33, { status: "inactive" });
    await deleteAsset(33);

    expect(clientMocks.signedJsonRequest).toHaveBeenNthCalledWith(1, {
      method: "PATCH",
      path: "/assets/33",
      data: { status: "inactive" },
    });
    expect(clientMocks.signedJsonRequest).toHaveBeenNthCalledWith(2, {
      method: "DELETE",
      path: "/assets/33",
    });
  });
});
