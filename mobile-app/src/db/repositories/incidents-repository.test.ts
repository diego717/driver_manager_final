import { beforeEach, describe, expect, it, vi } from "vitest";

type IncidentRecord = {
  id: string;
  localId: string;
  installationId: number;
  assetId: number | null;
  remoteInstallationId: number | null;
  localCaseLocalId: string | null;
  reporterUsername: string;
  note: string;
  timeAdjustmentSeconds: number;
  severity: string;
  source: string;
  createdAt: Date;
  isSynced: boolean;
  remoteId: number | null;
  localSyncStatus: "pending" | "syncing" | "failed" | "synced";
  syncAttempts: number;
  lastSyncError: string | null;
  clientRequestId: string;
  gpsCaptureStatus: string;
  gpsCaptureSource: string;
  gpsLat: number | null;
  gpsLng: number | null;
  gpsAccuracyM: number | null;
  gpsCapturedAt: string | null;
  gpsCaptureNote: string;
  incidentStatus: string;
  statusUpdatedAt: string | null;
  statusUpdatedBy: string | null;
  estimatedDurationSeconds: number | null;
  workStartedAt: string | null;
  workEndedAt: string | null;
  actualDurationSeconds: number | null;
  resolvedAt: string | null;
  resolvedBy: string | null;
  resolutionNote: string | null;
  targetLat: number | null;
  targetLng: number | null;
  targetLabel: string | null;
  targetSource: string | null;
  targetUpdatedAt: string | null;
  targetUpdatedBy: string | null;
  dispatchRequired: boolean;
  dispatchPlaceName: string | null;
  dispatchAddress: string | null;
  dispatchReference: string | null;
  dispatchContactName: string | null;
  dispatchContactPhone: string | null;
  dispatchNotes: string | null;
  checklistItemsJson: string | null;
  evidenceNote: string | null;
  _raw: { created_at: number };
  update: (updater: (record: IncidentRecord) => void) => Promise<void>;
  markAsDeleted: () => Promise<void>;
  destroyPermanently: () => Promise<void>;
};

const dbState = vi.hoisted(() => ({
  incidents: [] as IncidentRecord[],
  nextId: 1,
}));

const secureMocks = vi.hoisted(() => ({
  secrets: new Map<string, Record<string, unknown>>(),
  setStoredIncidentSecret: vi.fn(async (localId: string, payload: Record<string, unknown>) => {
    secureMocks.secrets.set(localId, payload);
  }),
  getStoredIncidentSecret: vi.fn(async (localId: string) => secureMocks.secrets.get(localId) ?? null),
  redactStoredSensitiveValue: vi.fn(() => "[redacted]"),
}));

const sanitizeMocks = vi.hoisted(() => ({
  sanitizeStoredSyncMessage: vi.fn((value?: string | null) =>
    value ? `[safe] ${value}` : null,
  ),
}));

function buildIncidentRecord(): IncidentRecord {
  const record = {
    id: `incident-${dbState.nextId++}`,
    localId: "",
    installationId: 0,
    assetId: null,
    remoteInstallationId: null,
    localCaseLocalId: null,
    reporterUsername: "",
    note: "",
    timeAdjustmentSeconds: 0,
    severity: "",
    source: "",
    createdAt: new Date("2026-04-04T00:00:00.000Z"),
    isSynced: false,
    remoteId: null,
    localSyncStatus: "pending" as const,
    syncAttempts: 0,
    lastSyncError: null,
    clientRequestId: "",
    gpsCaptureStatus: "pending",
    gpsCaptureSource: "none",
    gpsLat: null,
    gpsLng: null,
    gpsAccuracyM: null,
    gpsCapturedAt: null,
    gpsCaptureNote: "",
    incidentStatus: "open",
    statusUpdatedAt: null,
    statusUpdatedBy: null,
    estimatedDurationSeconds: null,
    workStartedAt: null,
    workEndedAt: null,
    actualDurationSeconds: null,
    resolvedAt: null,
    resolvedBy: null,
    resolutionNote: null,
    targetLat: null,
    targetLng: null,
    targetLabel: null,
    targetSource: null,
    targetUpdatedAt: null,
    targetUpdatedBy: null,
    dispatchRequired: true,
    dispatchPlaceName: null,
    dispatchAddress: null,
    dispatchReference: null,
    dispatchContactName: null,
    dispatchContactPhone: null,
    dispatchNotes: null,
    checklistItemsJson: null,
    evidenceNote: null,
    _raw: { created_at: Date.parse("2026-04-04T00:00:00.000Z") },
    update: async (updater: (record: IncidentRecord) => void) => {
      updater(record);
    },
    markAsDeleted: vi.fn(async () => undefined),
    destroyPermanently: vi.fn(async () => {
      const index = dbState.incidents.indexOf(record);
      if (index >= 0) dbState.incidents.splice(index, 1);
    }),
  };
  return record;
}

vi.mock("../index", () => ({
  database: {
    write: async (work: () => unknown) => await work(),
    get: (table: string) => {
      if (table !== "incidents") throw new Error(`Unknown table ${table}`);
      return {
        create: async (builder: (record: IncidentRecord) => void) => {
          const record = buildIncidentRecord();
          builder(record);
          dbState.incidents.push(record);
          return record;
        },
        query: () => ({
          fetch: async () => dbState.incidents,
        }),
      };
    },
  },
}));

vi.mock("../../storage/secure", () => secureMocks);
vi.mock("../../services/sync/sync-errors", () => sanitizeMocks);

import { incidentsRepository } from "./incidents-repository";

describe("incidents-repository", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbState.incidents = [];
    dbState.nextId = 1;
    secureMocks.secrets.clear();
  });

  it("creates a local incident with redacted persisted fields and stored secrets", async () => {
    const incident = await incidentsRepository.createLocalIncident({
      localId: "incident-local-1",
      installationId: 45,
      remoteInstallationId: 45,
      localCaseLocalId: "case-local-1",
      reporterUsername: "tecnico_1",
      note: "Sin energia en el equipo",
      timeAdjustmentSeconds: 30,
      severity: "high",
      source: "mobile",
      clientRequestId: "req-1",
      gps: {
        status: "captured",
        source: "browser",
        lat: -34.9,
        lng: -56.1,
        accuracy_m: 12,
        captured_at: "2026-04-04T10:00:00.000Z",
        note: "",
      },
    });

    expect(incident.localId).toBe("incident-local-1");
    expect(incident.reporterUsername).toBe("[redacted]");
    expect(incident.note).toBe("[redacted]");
    expect(incident.gpsCaptureNote).toBe("[redacted]");
    expect(incident.localSyncStatus).toBe("pending");
    expect(secureMocks.setStoredIncidentSecret).toHaveBeenCalledWith("incident-local-1", {
      reporterUsername: "tecnico_1",
      note: "Sin energia en el equipo",
      gpsCaptureNote: "",
      resolutionNote: null,
      evidenceNote: null,
    });
  });

  it("marks failed sync attempts with sanitized messages and can list pending records", async () => {
    const incident = await incidentsRepository.createLocalIncident({
      localId: "incident-local-2",
      installationId: 45,
      reporterUsername: "tecnico_2",
      note: "Falla GPS",
      timeAdjustmentSeconds: 0,
      severity: "medium",
      source: "mobile",
      clientRequestId: "req-2",
      gps: {
        status: "override",
        source: "override",
        note: "sin senal",
      },
    } as any);

    await incidentsRepository.updateSyncStatus("incident-local-2", "failed", "sqlite path c:\\secret");

    expect(incident.syncAttempts).toBe(1);
    expect(incident.lastSyncError).toBe("[safe] sqlite path c:\\secret");
    expect(await incidentsRepository.getPendingIncidents()).toHaveLength(1);
  });

  it("upserts remote snapshots and maps cached incidents back with secure secrets", async () => {
    await incidentsRepository.upsertRemoteIncidentSnapshot({
      id: 77,
      installation_id: 45,
      asset_id: "9",
      reporter_username: "ops-user",
      note: "Incidencia remota",
      time_adjustment_seconds: 15,
      severity: "critical",
      source: "web",
      created_at: "2026-04-04T12:00:00.000Z",
      incident_status: "resolved",
      resolved_at: "2026-04-04T13:00:00.000Z",
      resolved_by: "ops-user",
      resolution_note: "Resuelto en sitio",
      checklist_items: ["foto", "firma"],
      evidence_note: "Evidencia remota",
      photos: [],
    } as any);

    const cached = await incidentsRepository.getCachedIncidentByRemoteId(77);

    expect(cached).toEqual(
      expect.objectContaining({
        id: 77,
        installation_id: 45,
        asset_id: 9,
        reporter_username: "ops-user",
        note: "Incidencia remota",
        resolution_note: "Resuelto en sitio",
        evidence_note: "Evidencia remota",
        severity: "critical",
        incident_status: "resolved",
        checklist_items: ["foto", "firma"],
      }),
    );
  });

  it("removes stale synced snapshots when replacing an installation cache", async () => {
    const stale = buildIncidentRecord();
    stale.localId = "remote-incident-10";
    stale.remoteId = 10;
    stale.remoteInstallationId = 45;
    stale.installationId = 45;
    stale.localSyncStatus = "synced";
    dbState.incidents.push(stale);

    await incidentsRepository.replaceRemoteInstallationSnapshots(45, [
      {
        id: 11,
        installation_id: 45,
        reporter_username: "nuevo",
        note: "vigente",
        created_at: "2026-04-04T14:00:00.000Z",
        incident_status: "open",
        checklist_items: [],
        photos: [],
      } as any,
    ]);

    expect(dbState.incidents.some((record) => record.remoteId === 10)).toBe(false);
    expect(dbState.incidents.some((record) => record.remoteId === 11)).toBe(true);
    expect(stale.markAsDeleted).toHaveBeenCalledTimes(1);
  });

  it("lists cached incidents by installation using remote ids only", async () => {
    await incidentsRepository.upsertRemoteIncidentSnapshot({
      id: 21,
      installation_id: 45,
      reporter_username: "one",
      note: "uno",
      created_at: "2026-04-04T08:00:00.000Z",
      incident_status: "open",
      checklist_items: [],
      photos: [],
    } as any);
    await incidentsRepository.createLocalIncident({
      localId: "local-only",
      installationId: 45,
      reporterUsername: "draft",
      note: "draft",
      timeAdjustmentSeconds: 0,
      severity: "low",
      source: "mobile",
      clientRequestId: "draft-1",
      gps: { status: "pending", source: "none", note: "" },
    } as any);

    const cached = await incidentsRepository.listCachedIncidentsByInstallation(45);

    expect(cached).toHaveLength(1);
    expect(cached[0].id).toBe(21);
  });
});
