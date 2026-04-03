import { beforeEach, describe, expect, it, vi } from "vitest";

const clientMocks = vi.hoisted(() => ({
  signedJsonRequest: vi.fn(),
}));

const incidentsRepoMocks = vi.hoisted(() => ({
  replaceRemoteInstallationSnapshots: vi.fn(),
  listCachedIncidentsByInstallation: vi.fn(),
  upsertRemoteIncidentSnapshot: vi.fn(),
  getCachedIncidentByRemoteId: vi.fn(),
}));

vi.mock("./client", () => clientMocks);
vi.mock("../db/repositories/incidents-repository", () => ({
  incidentsRepository: incidentsRepoMocks,
}));

import {
  clearInstallationsCache,
  createIncident,
  createInstallationRecord,
  deleteIncident,
  getIncidentById,
  listIncidentsByInstallation,
  listInstallations,
} from "./incidents";

describe("incidents api", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearInstallationsCache();
    incidentsRepoMocks.replaceRemoteInstallationSnapshots.mockResolvedValue(undefined);
    incidentsRepoMocks.listCachedIncidentsByInstallation.mockResolvedValue([]);
    incidentsRepoMocks.upsertRemoteIncidentSnapshot.mockResolvedValue(undefined);
    incidentsRepoMocks.getCachedIncidentByRemoteId.mockResolvedValue(null);
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

  it("deletes incident using /incidents/:id", async () => {
    clientMocks.signedJsonRequest.mockResolvedValue({
      success: true,
      incident_id: 77,
      deleted_at: "2026-03-21T10:00:00.000Z",
    });

    const response = await deleteIncident(77);

    expect(response.incident_id).toBe(77);
    expect(clientMocks.signedJsonRequest).toHaveBeenCalledWith({
      method: "DELETE",
      path: "/incidents/77",
    });
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

  it("normalizes dispatch target fields on incident detail", async () => {
    clientMocks.signedJsonRequest.mockResolvedValue({
      success: true,
      incident: {
        id: 15,
        installation_id: 10,
        reporter_username: "ops",
        note: "Destino operativo",
        time_adjustment_seconds: 60,
        severity: "high",
        source: "web",
        created_at: "2026-04-03T12:00:00.000Z",
        incident_status: "open",
        dispatch_required: 0,
        target_lat: "-34.9011",
        target_lng: "-56.1645",
        target_label: " ATM-009 acceso principal ",
        target_source: "MANUAL_MAP",
        dispatch_place_name: " ATM-009 ",
        dispatch_address: " Av. Italia 2456 ",
        dispatch_reference: " Hall principal ",
        dispatch_contact_name: " Marta Perez ",
        dispatch_contact_phone: " +59899111222 ",
        dispatch_notes: " Coordinar ingreso ",
        photos: [],
      },
    });

    const incident = await getIncidentById(15);

    expect(incident).toEqual(
      expect.objectContaining({
        target_lat: -34.9011,
        target_lng: -56.1645,
        dispatch_required: false,
        target_label: "ATM-009 acceso principal",
        target_source: "manual_map",
        dispatch_place_name: "ATM-009",
        dispatch_address: "Av. Italia 2456",
        dispatch_reference: "Hall principal",
        dispatch_contact_name: "Marta Perez",
        dispatch_contact_phone: "+59899111222",
        dispatch_notes: "Coordinar ingreso",
      }),
    );
  });

  it("falls back to cached installation incidents when the network request fails", async () => {
    clientMocks.signedJsonRequest.mockRejectedValueOnce(new Error("offline"));
    incidentsRepoMocks.listCachedIncidentsByInstallation.mockResolvedValueOnce([
      {
        id: 22,
        installation_id: 10,
        reporter_username: "cached.user",
        note: "Cache local",
        time_adjustment_seconds: 30,
        severity: "medium",
        source: "mobile",
        created_at: "2026-04-03T12:00:00.000Z",
        incident_status: "paused",
        dispatch_place_name: "ATM-009",
        photos: [],
      },
    ]);

    const response = await listIncidentsByInstallation(10);

    expect(response.incidents[0]).toEqual(
      expect.objectContaining({
        id: 22,
        incident_status: "paused",
        dispatch_place_name: "ATM-009",
      }),
    );
  });

  it("falls back to cached incident detail when the network request fails", async () => {
    clientMocks.signedJsonRequest.mockRejectedValueOnce(new Error("offline"));
    incidentsRepoMocks.getCachedIncidentByRemoteId.mockResolvedValueOnce({
      id: 15,
      installation_id: 10,
      reporter_username: "cached.user",
      note: "Detalle cacheado",
      time_adjustment_seconds: 60,
      severity: "high",
      source: "web",
      created_at: "2026-04-03T12:00:00.000Z",
      incident_status: "open",
      dispatch_address: "Av. Italia 2456",
      photos: [],
    });

    const incident = await getIncidentById(15);

    expect(incident.note).toBe("Detalle cacheado");
    expect(incident.dispatch_address).toBe("Av. Italia 2456");
  });
});
