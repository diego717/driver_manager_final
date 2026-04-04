import { beforeEach, describe, expect, it, vi } from "vitest";

const runnerMocks = vi.hoisted(() => ({
  flush: vi.fn(),
  getTotalPendingCount: vi.fn(),
  setPendingCount: vi.fn(),
  setError: vi.fn(),
  resolveWebSession: vi.fn(),
}));

vi.mock("./sync-engine", () => ({
  flush: runnerMocks.flush,
}));

vi.mock("../../db/repositories/sync-jobs-repository", () => ({
  syncJobsRepository: {
    getTotalPendingCount: runnerMocks.getTotalPendingCount,
  },
}));

vi.mock("./sync-state-store", () => ({
  syncStateStore: {
    setPendingCount: runnerMocks.setPendingCount,
    setError: runnerMocks.setError,
  },
}));

vi.mock("../../storage/secure", () => ({
  getStoredWebAccessExpiresAt: vi.fn(),
  getStoredWebAccessToken: vi.fn(),
}));

vi.mock("../../api/webSession", () => ({
  resolveWebSession: runnerMocks.resolveWebSession,
}));

import { runSync, runSyncAsync } from "./sync-runner";

describe("sync-runner", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    runnerMocks.getTotalPendingCount.mockResolvedValue(0);
    runnerMocks.resolveWebSession.mockResolvedValue({ state: "active" });
    runnerMocks.flush.mockResolvedValue(undefined);
  });

  it("skips session validation and flush when there is nothing pending", async () => {
    await runSyncAsync();

    expect(runnerMocks.setPendingCount).toHaveBeenCalledWith(0);
    expect(runnerMocks.resolveWebSession).not.toHaveBeenCalled();
    expect(runnerMocks.flush).not.toHaveBeenCalled();
  });

  it("blocks sync and surfaces an actionable error when the session is inactive", async () => {
    runnerMocks.getTotalPendingCount.mockResolvedValue(3);
    runnerMocks.resolveWebSession.mockResolvedValue({ state: "expired" });

    await runSyncAsync();

    expect(runnerMocks.setPendingCount).toHaveBeenCalledWith(3);
    expect(runnerMocks.flush).not.toHaveBeenCalled();
    expect(runnerMocks.setError).toHaveBeenCalledWith(
      "Sesion web requerida. Inicia sesion para continuar la sincronizacion.",
    );
  });

  it("flushes pending jobs when the web session is active", async () => {
    runnerMocks.getTotalPendingCount.mockResolvedValue(2);

    await runSyncAsync({ force: true });

    expect(runnerMocks.flush).toHaveBeenCalledWith({ force: true });
    expect(runnerMocks.setError).not.toHaveBeenCalled();
  });

  it("captures thrown errors from the flush pipeline", async () => {
    runnerMocks.getTotalPendingCount.mockResolvedValue(1);
    runnerMocks.flush.mockRejectedValue(new Error("network down"));

    await runSyncAsync();

    expect(runnerMocks.setError).toHaveBeenCalledWith("network down");
  });

  it("starts the async pipeline without requiring the caller to await it", async () => {
    runnerMocks.getTotalPendingCount.mockResolvedValue(1);

    runSync({ force: true });
    await Promise.resolve();
    await Promise.resolve();

    expect(runnerMocks.flush).toHaveBeenCalledWith({ force: true });
  });
});
