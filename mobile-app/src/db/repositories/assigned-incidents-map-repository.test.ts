import { beforeEach, describe, expect, it, vi } from "vitest";

type AssignedIncidentCacheRecord = {
  id: string;
  incidentRemoteId: number;
  installationId: number;
  assetId: number | null;
  severity: string;
  incidentStatus: string;
  createdAtIso: string;
  targetLat: number | null;
  targetLng: number | null;
  targetLabel: string | null;
  dispatchPlaceName: string | null;
  dispatchAddress: string | null;
  dispatchReference: string | null;
  dispatchContactName: string | null;
  dispatchContactPhone: string | null;
  dispatchNotes: string | null;
  installationClientName: string | null;
  installationLabel: string | null;
  assetCode: string | null;
  assignmentRole: string | null;
  assignmentSource: string | null;
  assignedAt: string | null;
  cachedAt: Date | null;
  markAsDeleted: ReturnType<typeof vi.fn>;
  destroyPermanently: ReturnType<typeof vi.fn>;
};

const state = {
  records: [] as AssignedIncidentCacheRecord[],
  nextId: 1,
};

function buildRecord(): AssignedIncidentCacheRecord {
  const record = {
    id: `assigned-${state.nextId++}`,
    incidentRemoteId: 0,
    installationId: 0,
    assetId: null,
    severity: "",
    incidentStatus: "",
    createdAtIso: "",
    targetLat: null,
    targetLng: null,
    targetLabel: null,
    dispatchPlaceName: null,
    dispatchAddress: null,
    dispatchReference: null,
    dispatchContactName: null,
    dispatchContactPhone: null,
    dispatchNotes: null,
    installationClientName: null,
    installationLabel: null,
    assetCode: null,
    assignmentRole: null,
    assignmentSource: null,
    assignedAt: null,
    cachedAt: null,
    markAsDeleted: vi.fn(async () => undefined),
    destroyPermanently: vi.fn(async () => {
      const index = state.records.indexOf(record);
      if (index >= 0) state.records.splice(index, 1);
    }),
  };
  return record;
}

async function loadRepository() {
  vi.resetModules();
  vi.doUnmock("@/src/db/repositories/assigned-incidents-map-repository");
  vi.doMock("../index", () => ({
    database: {
      write: async (work: () => unknown) => await work(),
      get: (table: string) => {
        if (table !== "assigned_incidents_map_cache") throw new Error(`Unknown table ${table}`);
        return {
          create: async (builder: (record: AssignedIncidentCacheRecord) => void) => {
            const record = buildRecord();
            builder(record);
            state.records.push(record);
            return record;
          },
          query: () => ({
            fetch: async () => state.records,
          }),
        };
      },
    },
  }));
  return import("@/src/db/repositories/assigned-incidents-map-repository");
}

describe("assigned-incidents-map-repository", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.records.length = 0;
    state.nextId = 1;
    vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
  });

  it("replaces the full cache and normalizes nullable fields", async () => {
    const { assignedIncidentsMapRepository } = await loadRepository();

    await assignedIncidentsMapRepository.replaceAll([
      {
        id: 22,
        installation_id: 45,
        asset_id: "9" as any,
        note: "ignored",
        severity: "high",
        incident_status: "in_progress",
        created_at: "2026-04-04T12:00:00.000Z",
        target_lat: "-34.9" as any,
        target_lng: "-56.1" as any,
        target_label: " Cliente Norte ",
        dispatch_place_name: " Base ",
        dispatch_address: " Calle 1 ",
        dispatch_reference: " porteria ",
        dispatch_contact_name: " Ana ",
        dispatch_contact_phone: " 099 ",
        dispatch_notes: " urgente ",
        installation_client_name: " Cliente ",
        installation_label: " Inst-45 ",
        asset_code: " EQ-9 ",
        assignment_role: "assistant",
        assignment_source: "installation",
        assigned_at: "2026-04-04T12:10:00.000Z",
      } as any,
    ]);

    expect(state.records).toHaveLength(1);
    expect(state.records[0]).toEqual(
      expect.objectContaining({
        incidentRemoteId: 22,
        installationId: 45,
        assetId: 9,
        targetLat: -34.9,
        targetLng: -56.1,
        targetLabel: "Cliente Norte",
        dispatchPlaceName: "Base",
        assignmentRole: "assistant",
        assignmentSource: "installation",
        cachedAt: new Date(1_700_000_000_000),
      }),
    );
  });

  it("lists all cached incidents mapped back to API shape", async () => {
    const { assignedIncidentsMapRepository } = await loadRepository();

    await assignedIncidentsMapRepository.replaceAll([
      {
        id: 44,
        installation_id: 10,
        asset_id: null,
        note: "ignored",
        severity: "",
        incident_status: "",
        created_at: "",
        assignment_role: "",
      } as any,
    ]);

    const items = await assignedIncidentsMapRepository.listAll();

    expect(items).toEqual([
      expect.objectContaining({
        id: 44,
        installation_id: 10,
        asset_id: null,
        note: "",
        severity: "low",
        incident_status: "open",
        created_at: "",
        assignment_role: "owner",
      }),
    ]);
  });

  it("returns a single incident by remote id or null when missing", async () => {
    const { assignedIncidentsMapRepository } = await loadRepository();

    await assignedIncidentsMapRepository.replaceAll([
      {
        id: 77,
        installation_id: 11,
        note: "",
        severity: "medium",
        incident_status: "open",
        created_at: "2026-04-04T09:00:00.000Z",
      } as any,
    ]);

    const found = await assignedIncidentsMapRepository.getByRemoteIncidentId(77);
    const missing = await assignedIncidentsMapRepository.getByRemoteIncidentId(99);

    expect(found).toEqual(expect.objectContaining({ id: 77, installation_id: 11 }));
    expect(missing).toBeNull();
  });
});
