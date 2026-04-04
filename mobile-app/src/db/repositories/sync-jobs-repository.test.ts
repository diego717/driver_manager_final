import { beforeEach, describe, expect, it, vi } from "vitest";

type SyncJobRecord = {
  id: string;
  entityType: string;
  entityLocalId: string;
  operation: string;
  dependsOnJobId: string | null;
  jobStatus: "pending" | "syncing" | "failed" | "synced";
  attemptCount: number;
  nextRetryAt: number;
  lastError: string | null;
  priority: number;
  createdAt: Date;
  updatedAt: number;
  markSyncing: () => Promise<void>;
  markSynced: () => Promise<void>;
  markFailed: (error: string) => Promise<void>;
  scheduleRetry: (nextRetryAt: number) => Promise<void>;
};

const dbState = vi.hoisted(() => ({
  jobs: [] as SyncJobRecord[],
  nextId: 1,
}));

function buildSyncJobRecord(): SyncJobRecord {
  const record = {
    id: `job-${dbState.nextId++}`,
    entityType: "",
    entityLocalId: "",
    operation: "",
    dependsOnJobId: null,
    jobStatus: "pending" as const,
    attemptCount: 0,
    nextRetryAt: 0,
    lastError: null,
    priority: 10,
    createdAt: new Date("2026-04-04T00:00:00.000Z"),
    updatedAt: 0,
    markSyncing: async () => {
      record.jobStatus = "syncing";
      record.updatedAt = Date.now();
    },
    markSynced: async () => {
      record.jobStatus = "synced";
      record.lastError = null;
      record.updatedAt = Date.now();
    },
    markFailed: async (error: string) => {
      record.jobStatus = "failed";
      record.attemptCount += 1;
      record.lastError = error;
      record.updatedAt = Date.now();
    },
    scheduleRetry: async (nextRetryAt: number) => {
      record.jobStatus = "pending";
      record.attemptCount += 1;
      record.nextRetryAt = nextRetryAt;
      record.updatedAt = Date.now();
    },
  };
  return record;
}

vi.mock("../index", () => ({
  database: {
    write: async (work: () => unknown) => await work(),
    get: (table: string) => {
      if (table !== "sync_jobs") throw new Error(`Unknown table ${table}`);
      return {
        create: async (builder: (record: SyncJobRecord) => void) => {
          const record = buildSyncJobRecord();
          builder(record);
          dbState.jobs.push(record);
          return record;
        },
        query: () => ({
          fetch: async () => dbState.jobs,
        }),
        find: async (id: string) => {
          const match = dbState.jobs.find((job) => job.id === id);
          if (!match) throw new Error("not found");
          return match;
        },
      };
    },
  },
}));

import { syncJobsRepository } from "./sync-jobs-repository";

describe("sync-jobs-repository", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbState.jobs = [];
    dbState.nextId = 1;
    vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
  });

  it("creates pending jobs with defaults", async () => {
    const job = await syncJobsRepository.createJob({
      entityType: "incident",
      entityLocalId: "incident-local-1",
      operation: "create_incident",
    });

    expect(job.jobStatus).toBe("pending");
    expect(job.priority).toBe(10);
    expect(job.updatedAt).toBe(1_700_000_000_000);
  });

  it("returns runnable jobs sorted by priority and creation date", async () => {
    const late = buildSyncJobRecord();
    late.id = "job-late";
    late.priority = 20;
    late.createdAt = new Date("2026-04-04T09:00:00.000Z");
    late.jobStatus = "pending";

    const early = buildSyncJobRecord();
    early.id = "job-early";
    early.priority = 5;
    early.createdAt = new Date("2026-04-04T08:00:00.000Z");
    early.jobStatus = "syncing";

    const blocked = buildSyncJobRecord();
    blocked.id = "job-blocked";
    blocked.priority = 1;
    blocked.createdAt = new Date("2026-04-04T07:00:00.000Z");
    blocked.jobStatus = "pending";
    blocked.nextRetryAt = 1_700_000_000_500;

    dbState.jobs.push(late, early, blocked);

    const pending = await syncJobsRepository.getPendingJobs(1_700_000_000_000);

    expect(pending.map((job) => job.id)).toEqual(["job-early", "job-late"]);
  });

  it("includes retry-blocked jobs when force is enabled", async () => {
    const blocked = buildSyncJobRecord();
    blocked.id = "job-blocked";
    blocked.jobStatus = "pending";
    blocked.nextRetryAt = 9999999999999;
    dbState.jobs.push(blocked);

    const pending = await syncJobsRepository.getPendingJobs(Date.now(), { force: true });

    expect(pending.map((job) => job.id)).toEqual(["job-blocked"]);
  });

  it("updates job state through mark helpers and counts pending jobs", async () => {
    const job = await syncJobsRepository.createJob({
      entityType: "photo",
      entityLocalId: "photo-1",
      operation: "upload_photo",
    });

    await syncJobsRepository.markSyncing(job.id);
    expect(job.jobStatus).toBe("syncing");

    await syncJobsRepository.scheduleRetry(job.id, 1234);
    expect(job.jobStatus).toBe("pending");
    expect(job.attemptCount).toBe(1);

    await syncJobsRepository.markSynced(job.id);
    expect(job.jobStatus).toBe("synced");
    expect(await syncJobsRepository.getTotalPendingCount()).toBe(0);
  });

  it("resolves dependencies only when parent jobs are synced", async () => {
    const parent = await syncJobsRepository.createJob({
      entityType: "case",
      entityLocalId: "case-1",
      operation: "create_case",
    });

    expect(await syncJobsRepository.isDependencyResolved(parent.id)).toBe(false);

    await syncJobsRepository.markSynced(parent.id);

    expect(await syncJobsRepository.isDependencyResolved(parent.id)).toBe(true);
    expect(await syncJobsRepository.isDependencyResolved(null)).toBe(true);
    expect(await syncJobsRepository.getJobById("missing")).toBeNull();
  });
});
