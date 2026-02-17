import { beforeEach, describe, expect, it, vi } from "vitest";

const clientMocks = vi.hoisted(() => ({
  signedJsonRequest: vi.fn(),
}));

vi.mock("./client", () => clientMocks);

import {
  createIncident,
  createInstallationRecord,
  listIncidentsByInstallation,
  listInstallations,
} from "./incidents";

describe("incidents api", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates standalone installation record via /records", async () => {
    clientMocks.signedJsonRequest.mockResolvedValue({
      success: true,
      record: { id: 50 },
    });

    const response = await createInstallationRecord({
      client_name: "Cliente A",
      notes: "Manual",
    });

    expect(response.record.id).toBe(50);
    expect(clientMocks.signedJsonRequest).toHaveBeenCalledWith({
      method: "POST",
      path: "/records",
      data: {
        client_name: "Cliente A",
        notes: "Manual",
      },
    });
  });

  it("creates incident using /installations/:id/incidents", async () => {
    clientMocks.signedJsonRequest.mockResolvedValue({ success: true, incident: { id: 1 } });

    await createIncident(10, { note: "test" });

    expect(clientMocks.signedJsonRequest).toHaveBeenCalledWith({
      method: "POST",
      path: "/installations/10/incidents",
      data: { note: "test" },
    });
  });

  it("rejects invalid installation id when creating incident", async () => {
    await expect(createIncident(0, { note: "x" })).rejects.toThrow(/positive integer/i);
  });

  it("lists installations and incidents using expected routes", async () => {
    clientMocks.signedJsonRequest.mockResolvedValueOnce([]);
    clientMocks.signedJsonRequest.mockResolvedValueOnce({
      success: true,
      installation_id: 10,
      incidents: [],
    });

    await listInstallations();
    await listIncidentsByInstallation(10);

    expect(clientMocks.signedJsonRequest).toHaveBeenNthCalledWith(1, {
      method: "GET",
      path: "/installations",
    });
    expect(clientMocks.signedJsonRequest).toHaveBeenNthCalledWith(2, {
      method: "GET",
      path: "/installations/10/incidents",
    });
  });
});
