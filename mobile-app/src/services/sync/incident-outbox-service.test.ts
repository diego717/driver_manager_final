import { beforeEach, describe, expect, it, vi } from "vitest";

const incidentRepoMocks = vi.hoisted(() => ({
  createLocalIncident: vi.fn(),
  getByLocalId: vi.fn(),
  updateSyncStatus: vi.fn(),
  updateRemoteId: vi.fn(),
}));

const caseRepoMocks = vi.hoisted(() => ({
  getByLocalId: vi.fn(),
}));

const syncJobsRepoMocks = vi.hoisted(() => ({
  createJob: vi.fn(),
}));

const syncEngineMocks = vi.hoisted(() => ({
  registerExecutor: vi.fn(),
}));

const syncMapperMocks = vi.hoisted(() => ({
  incidentToApiPayload: vi.fn(),
}));

const incidentApiMocks = vi.hoisted(() => ({
  createIncident: vi.fn(),
}));

vi.mock("../../db/repositories/incidents-repository", () => ({
  incidentsRepository: incidentRepoMocks,
}));
vi.mock("../../db/repositories/cases-repository", () => ({
  casesRepository: caseRepoMocks,
}));
vi.mock("../../db/repositories/sync-jobs-repository", () => ({
  syncJobsRepository: syncJobsRepoMocks,
}));
vi.mock("./sync-engine", () => syncEngineMocks);
vi.mock("./sync-mappers", () => syncMapperMocks);
vi.mock("../../api/incidents", () => incidentApiMocks);

import { executeCreateIncident } from "./incident-outbox-service";

describe("incident-outbox-service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("resolves remote installation id from a queued local case dependency", async () => {
    incidentRepoMocks.getByLocalId.mockResolvedValue({
      localSyncStatus: "pending",
      remoteId: null,
      remoteInstallationId: null,
      installationId: 0,
      localCaseLocalId: "case-local-1",
    });
    caseRepoMocks.getByLocalId.mockResolvedValue({
      remoteId: 902,
    });
    syncMapperMocks.incidentToApiPayload.mockResolvedValue({
      note: "offline incident",
    });
    incidentApiMocks.createIncident.mockResolvedValue({
      incident: { id: 7001 },
    });

    await executeCreateIncident({
      entityLocalId: "incident-local-1",
    } as never);

    expect(caseRepoMocks.getByLocalId).toHaveBeenCalledWith("case-local-1");
    expect(incidentApiMocks.createIncident).toHaveBeenCalledWith(902, {
      note: "offline incident",
    });
    expect(incidentRepoMocks.updateRemoteId).toHaveBeenCalledWith("incident-local-1", 7001);
  });
});
