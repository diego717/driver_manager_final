import { beforeEach, describe, expect, it, vi } from "vitest";

const clientMocks = vi.hoisted(() => ({
  signedJsonRequest: vi.fn(),
}));

vi.mock("./client", () => clientMocks);

import {
  clearInstallationsCache,
  createIncident,
  createInstallationRecord,
  listIncidentsByInstallation,
  listInstallations,
} from "./incidents";

describe("incidents api", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearInstallationsCache();
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

  it("normalizes created record id when API returns string id", async () => {
    clientMocks.signedJsonRequest.mockResolvedValue({
      success: true,
      record: { id: "51" },
    });

    const response = await createInstallationRecord({
      client_name: "Cliente B",
    });

    expect(response.record.id).toBe(51);
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

  it("uses shared installations cache within ttl", async () => {
    clientMocks.signedJsonRequest.mockResolvedValue([{ id: 10 }]);

    const first = await listInstallations();
    const second = await listInstallations();

    expect(first).toEqual([{ id: 10 }]);
    expect(second).toEqual([{ id: 10 }]);
    expect(clientMocks.signedJsonRequest).toHaveBeenCalledTimes(1);
  });

  it("normalizes installation ids returned as strings", async () => {
    clientMocks.signedJsonRequest.mockResolvedValueOnce([{ id: "10" }]);

    const records = await listInstallations();

    expect(records).toEqual([{ id: 10 }]);
  });

  it("normalizes paused counters and incident runtime fields from API", async () => {
    clientMocks.signedJsonRequest
      .mockResolvedValueOnce([
        {
          id: "10",
          incident_paused_count: "2",
        },
      ])
      .mockResolvedValueOnce({
        success: true,
        installation_id: 10,
        incidents: [
          {
            id: 3,
            installation_id: 10,
            reporter_username: "ops",
            note: "Pausa QA",
            time_adjustment_seconds: 60,
            severity: "medium",
            source: "mobile",
            created_at: "2026-03-20T10:00:00.000Z",
            incident_status: "paused",
            estimated_duration_seconds: "120",
            actual_duration_seconds: "75",
          },
        ],
      });

    const records = await listInstallations();
    const incidents = await listIncidentsByInstallation(10);

    expect(records[0].incident_paused_count).toBe(2);
    expect(incidents.incidents[0]).toEqual(
      expect.objectContaining({
        incident_status: "paused",
        estimated_duration_seconds: 120,
        actual_duration_seconds: 75,
      }),
    );
  });

  it("bypasses cache when forceRefresh is true", async () => {
    clientMocks.signedJsonRequest
      .mockResolvedValueOnce([{ id: 10 }])
      .mockResolvedValueOnce([{ id: 11 }]);

    const first = await listInstallations();
    const second = await listInstallations({ forceRefresh: true });

    expect(first).toEqual([{ id: 10 }]);
    expect(second).toEqual([{ id: 11 }]);
    expect(clientMocks.signedJsonRequest).toHaveBeenCalledTimes(2);
  });
});
