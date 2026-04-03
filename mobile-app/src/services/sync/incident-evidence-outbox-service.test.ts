import { beforeEach, describe, expect, it, vi } from "vitest";

const secureStoreMocks = vi.hoisted(() => ({
  setStoredIncidentEvidenceSecret: vi.fn(),
  getStoredIncidentEvidenceSecret: vi.fn(),
  clearStoredIncidentEvidenceSecret: vi.fn(),
}));

const syncJobsRepoMocks = vi.hoisted(() => ({
  createJob: vi.fn(),
}));

const syncEngineMocks = vi.hoisted(() => ({
  registerExecutor: vi.fn(),
}));

const incidentApiMocks = vi.hoisted(() => ({
  updateIncidentEvidence: vi.fn(),
}));

vi.mock("../../storage/secure", () => secureStoreMocks);
vi.mock("../../db/repositories/sync-jobs-repository", () => ({
  syncJobsRepository: syncJobsRepoMocks,
}));
vi.mock("./sync-engine", () => syncEngineMocks);
vi.mock("../../api/incidents", () => incidentApiMocks);

import {
  enqueueUpdateIncidentEvidence,
  executeUpdateIncidentEvidence,
  registerIncidentEvidenceExecutors,
} from "./incident-evidence-outbox-service";

describe("incident-evidence-outbox-service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    syncJobsRepoMocks.createJob.mockResolvedValue({ id: "job-evidence-1" });
  });

  it("enqueues incident evidence metadata for offline sync", async () => {
    const result = await enqueueUpdateIncidentEvidence({
      remoteIncidentId: 77,
      checklistItems: ["Equipo identificado"],
      evidenceNote: "Nota operativa inicial",
    });

    expect(result.jobId).toBe("job-evidence-1");
    expect(secureStoreMocks.setStoredIncidentEvidenceSecret).toHaveBeenCalledOnce();
    expect(syncJobsRepoMocks.createJob).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: "incident_evidence",
        operation: "update_incident_evidence",
      }),
    );
  });

  it("executes queued incident evidence metadata and clears secure payload", async () => {
    secureStoreMocks.getStoredIncidentEvidenceSecret.mockResolvedValue({
      checklistItems: ["Equipo identificado", "Diagnostico inicial registrado"],
      evidenceNote: "Nota operativa inicial",
      remoteIncidentId: 77,
      localIncidentLocalId: null,
    });

    await executeUpdateIncidentEvidence({
      entityLocalId: "evidence-local-1",
    } as never);

    expect(incidentApiMocks.updateIncidentEvidence).toHaveBeenCalledWith(77, {
      checklist_items: ["Equipo identificado", "Diagnostico inicial registrado"],
      evidence_note: "Nota operativa inicial",
    });
    expect(secureStoreMocks.clearStoredIncidentEvidenceSecret).toHaveBeenCalledWith("evidence-local-1");
  });

  it("registers the update_incident_evidence executor once", () => {
    registerIncidentEvidenceExecutors();
    registerIncidentEvidenceExecutors();

    expect(syncEngineMocks.registerExecutor).toHaveBeenCalledTimes(1);
    expect(syncEngineMocks.registerExecutor).toHaveBeenCalledWith(
      "update_incident_evidence",
      expect.any(Function),
    );
  });
});
