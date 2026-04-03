import { beforeEach, describe, expect, it, vi } from "vitest";

const photoRepoMocks = vi.hoisted(() => ({
  createPendingUpload: vi.fn(),
  getByLocalId: vi.fn(),
  updateSyncStatus: vi.fn(),
  resolveSensitiveFields: vi.fn(),
  resolveRemoteIncidentId: vi.fn(),
  updateRemoteId: vi.fn(),
}));

const syncJobsRepoMocks = vi.hoisted(() => ({
  createJob: vi.fn(),
}));

const syncEngineMocks = vi.hoisted(() => ({
  registerExecutor: vi.fn(),
}));

const uploadPhotoMocks = vi.hoisted(() => ({
  uploadIncidentPhoto: vi.fn(),
}));

vi.mock("../../db/repositories/photos-repository", () => ({
  photosRepository: photoRepoMocks,
}));

vi.mock("../../db/repositories/sync-jobs-repository", () => ({
  syncJobsRepository: syncJobsRepoMocks,
}));

vi.mock("./sync-engine", () => syncEngineMocks);

vi.mock("../../api/photos", () => uploadPhotoMocks);

import {
  enqueueUploadIncidentPhoto,
  executeUploadPhoto,
  registerPhotoExecutors,
} from "./photo-outbox-service";

describe("photo-outbox-service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    syncJobsRepoMocks.createJob.mockResolvedValue({ id: "job-1" });
  });

  it("enqueues a local photo upload job", async () => {
    const result = await enqueueUploadIncidentPhoto({
      remoteIncidentId: 44,
      localPath: "file:///evidence-1.jpg",
      fileName: "evidence-1.jpg",
      contentType: "image/jpeg",
      sizeBytes: 2048,
      dependsOnJobId: "parent-job-1",
    });

    expect(result.jobId).toBe("job-1");
    expect(photoRepoMocks.createPendingUpload).toHaveBeenCalledOnce();
    expect(syncJobsRepoMocks.createJob).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: "photo",
        operation: "upload_photo",
        dependsOnJobId: "parent-job-1",
      }),
    );
  });

  it("uploads a queued photo through the executor and marks it synced", async () => {
    photoRepoMocks.getByLocalId.mockResolvedValue({
      localId: "photo-local-1",
      localSyncStatus: "pending",
      remotePhotoId: null,
      contentType: "image/jpeg",
      remoteIncidentId: 44,
      localIncidentLocalId: null,
      localPath: "__secure_store__",
      fileName: "__secure_store__",
    });
    photoRepoMocks.resolveSensitiveFields.mockResolvedValue({
      localPath: "file:///evidence-1.jpg",
      fileName: "evidence-1.jpg",
    });
    photoRepoMocks.resolveRemoteIncidentId.mockResolvedValue(44);
    uploadPhotoMocks.uploadIncidentPhoto.mockResolvedValue({
      success: true,
      photo: {
        id: 501,
        r2_key: "r2/photos/501.jpg",
        sha256: "abc123",
      },
    });

    await executeUploadPhoto({
      entityLocalId: "photo-local-1",
    } as never);

    expect(photoRepoMocks.updateSyncStatus).toHaveBeenCalledWith("photo-local-1", "syncing");
    expect(uploadPhotoMocks.uploadIncidentPhoto).toHaveBeenCalledWith({
      incidentId: 44,
      fileUri: "file:///evidence-1.jpg",
      fileName: "evidence-1.jpg",
      contentType: "image/jpeg",
    });
    expect(photoRepoMocks.updateRemoteId).toHaveBeenCalledWith(
      "photo-local-1",
      501,
      "r2/photos/501.jpg",
      "abc123",
    );
  });

  it("registers the upload_photo executor once", () => {
    registerPhotoExecutors();
    registerPhotoExecutors();

    expect(syncEngineMocks.registerExecutor).toHaveBeenCalledTimes(1);
    expect(syncEngineMocks.registerExecutor).toHaveBeenCalledWith(
      "upload_photo",
      expect.any(Function),
    );
  });
});
