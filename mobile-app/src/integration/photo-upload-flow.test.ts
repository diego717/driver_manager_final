import { beforeEach, describe, expect, it, vi } from "vitest";

const fileSystemMock = vi.hoisted(() => ({
  readAsStringAsync: vi.fn(),
  EncodingType: { Base64: "base64" },
}));

const clientMock = vi.hoisted(() => ({
  getResolvedApiBaseUrl: vi.fn(),
  resolveRequestAuth: vi.fn(),
}));

vi.mock("expo-file-system/legacy", () => fileSystemMock);
vi.mock("../api/client", () => clientMock);

import { uploadIncidentPhoto } from "../api/photos";

function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

describe("critical integration flow: photo upload limits", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clientMock.getResolvedApiBaseUrl.mockResolvedValue("https://worker.example");
    clientMock.resolveRequestAuth.mockResolvedValue({
      path: "/incidents/33/photos",
      headers: {
        "X-API-Token": "token",
        "X-Request-Timestamp": "1",
        "X-Request-Signature": "sig",
      },
    });
    vi.stubGlobal("fetch", vi.fn());
  });

  it("rejects upload when image is larger than 5MB", async () => {
    const oversized = new Uint8Array((5 * 1024 * 1024) + 1);
    oversized.set([0xff, 0xd8, 0xff], 0);
    fileSystemMock.readAsStringAsync.mockResolvedValue(toBase64(oversized));

    await expect(
      uploadIncidentPhoto({
        incidentId: 33,
        fileUri: "file://oversized.jpg",
        fileName: "oversized.jpg",
        contentType: "image/jpeg",
      }),
    ).rejects.toThrow(/grande|maximo: 5mb/i);
  });

  it("accepts and uploads image between 1KB and 5MB", async () => {
    const valid = new Uint8Array(1500);
    valid.set([0xff, 0xd8, 0xff], 0);
    fileSystemMock.readAsStringAsync.mockResolvedValue(toBase64(valid));

    const fetchMock = vi.mocked(globalThis.fetch);
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, photo: { id: 501 } }),
    } as Response);

    const response = await uploadIncidentPhoto({
      incidentId: 33,
      fileUri: "file://valid.jpg",
      fileName: "valid.jpg",
      contentType: "image/jpeg",
    });

    expect(response.success).toBe(true);
    expect(response.photo.id).toBe(501);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
