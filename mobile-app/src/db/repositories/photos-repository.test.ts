import { beforeEach, describe, expect, it, vi } from "vitest";

type PhotoRecord = {
  id: string;
  incidentRecordId: string;
  r2Key: string | null;
  localPath: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  sha256: string | null;
  isSynced: boolean;
  remoteId: number | null;
  localId: string;
  remotePhotoId: number | null;
  remoteIncidentId: number | null;
  localIncidentLocalId: string | null;
  localSyncStatus: "pending" | "syncing" | "failed" | "synced";
  syncAttempts: number;
  lastSyncError: string | null;
  clientRequestId: string;
  update: (updater: (record: PhotoRecord) => void) => Promise<void>;
};

const dbState = vi.hoisted(() => ({
  photos: [] as PhotoRecord[],
  nextId: 1,
}));

const secureMocks = vi.hoisted(() => ({
  secrets: new Map<string, Record<string, unknown>>(),
  setStoredPhotoSecret: vi.fn(async (localId: string, payload: Record<string, unknown>) => {
    secureMocks.secrets.set(localId, payload);
  }),
  getStoredPhotoSecret: vi.fn(async (localId: string) => secureMocks.secrets.get(localId) ?? null),
  clearStoredPhotoSecret: vi.fn(async (localId: string) => {
    secureMocks.secrets.delete(localId);
  }),
  redactStoredSensitiveValue: vi.fn(() => "[redacted]"),
}));

const sanitizeMocks = vi.hoisted(() => ({
  sanitizeStoredSyncMessage: vi.fn((value?: string | null) =>
    value ? `[safe] ${value}` : null,
  ),
}));

const incidentRepoMocks = vi.hoisted(() => ({
  getByLocalId: vi.fn(),
}));

function buildPhotoRecord(): PhotoRecord {
  const record = {
    id: `photo-${dbState.nextId++}`,
    incidentRecordId: "",
    r2Key: null,
    localPath: "",
    fileName: "",
    contentType: "",
    sizeBytes: 0,
    sha256: null,
    isSynced: false,
    remoteId: null,
    localId: "",
    remotePhotoId: null,
    remoteIncidentId: null,
    localIncidentLocalId: null,
    localSyncStatus: "pending" as const,
    syncAttempts: 0,
    lastSyncError: null,
    clientRequestId: "",
    update: async (updater: (record: PhotoRecord) => void) => {
      updater(record);
    },
  };
  return record;
}

vi.mock("../index", () => ({
  database: {
    write: async (work: () => unknown) => await work(),
    get: (table: string) => {
      if (table !== "photos") throw new Error(`Unknown table ${table}`);
      return {
        create: async (builder: (record: PhotoRecord) => void) => {
          const record = buildPhotoRecord();
          builder(record);
          dbState.photos.push(record);
          return record;
        },
        query: () => ({
          fetch: async () => dbState.photos,
        }),
      };
    },
  },
}));

vi.mock("../../storage/secure", () => secureMocks);
vi.mock("../../services/sync/sync-errors", () => sanitizeMocks);
vi.mock("./incidents-repository", () => ({
  incidentsRepository: incidentRepoMocks,
}));

import { photosRepository } from "./photos-repository";

describe("photos-repository", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbState.photos = [];
    dbState.nextId = 1;
    secureMocks.secrets.clear();
    incidentRepoMocks.getByLocalId.mockResolvedValue(null);
  });

  it("creates pending uploads with redacted file metadata and derived incident ids", async () => {
    const photo = await photosRepository.createPendingUpload({
      localId: "photo-local-1",
      clientRequestId: "req-photo-1",
      localPath: "file:///secret/photo.jpg",
      fileName: "photo.jpg",
      contentType: "image/jpeg",
      sizeBytes: 2048,
      localIncidentLocalId: "incident-local-1",
    });

    expect(photo.localPath).toBe("[redacted]");
    expect(photo.fileName).toBe("[redacted]");
    expect(photo.incidentRecordId).toBe("local:incident-local-1");
    expect(secureMocks.setStoredPhotoSecret).toHaveBeenCalledWith("photo-local-1", {
      localPath: "file:///secret/photo.jpg",
      fileName: "photo.jpg",
    });
  });

  it("marks uploaded photos as synced and clears secure file metadata", async () => {
    await photosRepository.createPendingUpload({
      localId: "photo-local-2",
      clientRequestId: "req-photo-2",
      localPath: "file:///secret/two.jpg",
      fileName: "two.jpg",
      contentType: "image/jpeg",
      sizeBytes: 3000,
      remoteIncidentId: 77,
    });

    await photosRepository.updateRemoteId("photo-local-2", 501, "r2/key", "sha-1");
    const photo = await photosRepository.getByLocalId("photo-local-2");

    expect(photo).toEqual(
      expect.objectContaining({
        remotePhotoId: 501,
        remoteId: 501,
        r2Key: "r2/key",
        sha256: "sha-1",
        isSynced: true,
        localSyncStatus: "synced",
      }),
    );
    expect(secureMocks.clearStoredPhotoSecret).toHaveBeenCalledWith("photo-local-2");
  });

  it("sanitizes sync errors, resolves secrets and can infer remote incident ids from synced local incidents", async () => {
    await photosRepository.createPendingUpload({
      localId: "photo-local-3",
      clientRequestId: "req-photo-3",
      localPath: "file:///secret/three.jpg",
      fileName: "three.jpg",
      contentType: "image/jpeg",
      sizeBytes: 3000,
      localIncidentLocalId: "incident-local-3",
    });

    await photosRepository.updateSyncStatus("photo-local-3", "failed", "secret path c:\\tmp");
    const photo = await photosRepository.getByLocalId("photo-local-3");
    const sensitive = await photosRepository.resolveSensitiveFields(photo!);
    incidentRepoMocks.getByLocalId.mockResolvedValueOnce({ remoteId: 88 });
    const remoteIncidentId = await photosRepository.resolveRemoteIncidentId(photo!);

    expect(photo?.syncAttempts).toBe(1);
    expect(photo?.lastSyncError).toBe("[safe] secret path c:\\tmp");
    expect(sensitive).toEqual({
      localPath: "file:///secret/three.jpg",
      fileName: "three.jpg",
    });
    expect(remoteIncidentId).toBe(88);
  });
});
