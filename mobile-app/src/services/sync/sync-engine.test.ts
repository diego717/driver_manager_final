import { beforeEach, describe, expect, it, vi } from "vitest";

const syncJobsRepoMocks = vi.hoisted(() => ({
  getPendingJobs: vi.fn(),
  isDependencyResolved: vi.fn(),
  markSyncing: vi.fn(),
  markSynced: vi.fn(),
  markFailed: vi.fn(),
  scheduleRetry: vi.fn(),
  getTotalPendingCount: vi.fn(),
}));

const incidentsRepoMocks = vi.hoisted(() => ({
  updateSyncStatus: vi.fn(),
}));

const photosRepoMocks = vi.hoisted(() => ({
  updateSyncStatus: vi.fn(),
}));

const casesRepoMocks = vi.hoisted(() => ({
  updateSyncStatus: vi.fn(),
}));

vi.mock("../../db/repositories/sync-jobs-repository", () => ({
  syncJobsRepository: syncJobsRepoMocks,
}));
vi.mock("../../db/repositories/incidents-repository", () => ({
  incidentsRepository: incidentsRepoMocks,
}));
vi.mock("../../db/repositories/photos-repository", () => ({
  photosRepository: photosRepoMocks,
}));
vi.mock("../../db/repositories/cases-repository", () => ({
  casesRepository: casesRepoMocks,
}));

import { flush, registerExecutor } from "./sync-engine";

describe("sync-engine", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    syncJobsRepoMocks.isDependencyResolved.mockResolvedValue(true);
    syncJobsRepoMocks.getTotalPendingCount.mockResolvedValue(0);
  });

  it("returns local entities to pending when a retry is scheduled", async () => {
    registerExecutor("upload_photo", vi.fn(async () => {
      throw new Error("Network request failed");
    }));
    syncJobsRepoMocks.getPendingJobs.mockResolvedValue([
      {
        id: "job-photo-1",
        entityLocalId: "photo-local-1",
        operation: "upload_photo",
        attemptCount: 0,
        dependsOnJobId: null,
      },
    ]);

    await flush();

    expect(syncJobsRepoMocks.markSyncing).toHaveBeenCalledWith("job-photo-1");
    expect(syncJobsRepoMocks.scheduleRetry).toHaveBeenCalledTimes(1);
    expect(photosRepoMocks.updateSyncStatus).toHaveBeenCalledWith(
      "photo-local-1",
      "pending",
      expect.stringContaining("[retry]"),
    );
  });

  it("marks the local entity as failed when the executor throws a terminal error", async () => {
    registerExecutor("create_incident", vi.fn(async () => {
      const error = new Error("Payload invalido");
      (error as any).response = { status: 422 };
      throw error;
    }));
    syncJobsRepoMocks.getPendingJobs.mockResolvedValue([
      {
        id: "job-incident-1",
        entityLocalId: "incident-local-1",
        operation: "create_incident",
        attemptCount: 0,
        dependsOnJobId: null,
      },
    ]);

    await flush();

    expect(syncJobsRepoMocks.markFailed).toHaveBeenCalledWith(
      "job-incident-1",
      expect.stringContaining("[terminal]"),
    );
    expect(incidentsRepoMocks.updateSyncStatus).toHaveBeenCalledWith(
      "incident-local-1",
      "failed",
      expect.stringContaining("[terminal]"),
    );
  });
});
