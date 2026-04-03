import { beforeEach, describe, expect, it, vi } from "vitest";

const caseRepoMocks = vi.hoisted(() => ({
  createLocalCase: vi.fn(),
  getByLocalId: vi.fn(),
  resolveSensitiveFields: vi.fn(),
  updateSyncStatus: vi.fn(),
  updateRemoteId: vi.fn(),
}));

const syncJobsRepoMocks = vi.hoisted(() => ({
  createJob: vi.fn(),
}));

const syncEngineMocks = vi.hoisted(() => ({
  registerExecutor: vi.fn(),
}));

const incidentApiMocks = vi.hoisted(() => ({
  createInstallationRecord: vi.fn(),
}));

vi.mock("../../db/repositories/cases-repository", () => ({
  casesRepository: caseRepoMocks,
}));
vi.mock("../../db/repositories/sync-jobs-repository", () => ({
  syncJobsRepository: syncJobsRepoMocks,
}));
vi.mock("./sync-engine", () => syncEngineMocks);
vi.mock("../../api/incidents", () => incidentApiMocks);

import {
  enqueueCreateCase,
  executeCreateCase,
  registerCaseExecutors,
} from "./case-outbox-service";

describe("case-outbox-service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    syncJobsRepoMocks.createJob.mockResolvedValue({ id: "job-case-1" });
  });

  it("enqueues a local case for offline sync", async () => {
    const result = await enqueueCreateCase({
      clientName: "Cliente Reservado",
      notes: "Caso creado offline",
    });

    expect(result.jobId).toBe("job-case-1");
    expect(caseRepoMocks.createLocalCase).toHaveBeenCalledOnce();
    expect(syncJobsRepoMocks.createJob).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: "case",
        operation: "create_case",
      }),
    );
  });

  it("executes a queued case and persists its remote id", async () => {
    caseRepoMocks.getByLocalId.mockResolvedValue({
      localSyncStatus: "pending",
      remoteId: null,
    });
    caseRepoMocks.resolveSensitiveFields.mockResolvedValue({
      clientName: "Cliente Reservado",
      notes: "Caso creado offline",
    });
    incidentApiMocks.createInstallationRecord.mockResolvedValue({
      record: { id: 1201 },
    });

    await executeCreateCase({
      entityLocalId: "case-local-1",
    } as never);

    expect(caseRepoMocks.updateSyncStatus).toHaveBeenCalledWith("case-local-1", "syncing");
    expect(incidentApiMocks.createInstallationRecord).toHaveBeenCalledOnce();
    expect(caseRepoMocks.updateRemoteId).toHaveBeenCalledWith("case-local-1", 1201);
  });

  it("registers the create_case executor once", () => {
    registerCaseExecutors();
    registerCaseExecutors();

    expect(syncEngineMocks.registerExecutor).toHaveBeenCalledTimes(1);
    expect(syncEngineMocks.registerExecutor).toHaveBeenCalledWith(
      "create_case",
      expect.any(Function),
    );
  });
});
