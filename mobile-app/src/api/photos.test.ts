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
vi.mock("./client", () => clientMock);

import { uploadIncidentPhoto } from "./photos";

function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

describe("photos api", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clientMock.getResolvedApiBaseUrl.mockResolvedValue("https://worker.example");
    clientMock.resolveRequestAuth.mockResolvedValue({
      path: "/incidents/11/photos",
      headers: {
        "X-API-Token": "token",
        "X-Request-Timestamp": "1",
        "X-Request-Signature": "sig",
      },
    });
    vi.stubGlobal("fetch", vi.fn());
  });

  it("rejects too-small image payload before upload", async () => {
    const payload = new Uint8Array(512);
    payload.set([0xff, 0xd8, 0xff], 0);
    fileSystemMock.readAsStringAsync.mockResolvedValue(toBase64(payload));

    await expect(
      uploadIncidentPhoto({
        incidentId: 11,
        fileUri: "file://photo.jpg",
        fileName: "photo.jpg",
        contentType: "image/jpeg",
      }),
    ).rejects.toThrow(/pequena|corrupta/i);
  });

  it("uploads validated payload with signed headers", async () => {
    const payload = new Uint8Array(1500);
    payload.set([0xff, 0xd8, 0xff], 0);
    fileSystemMock.readAsStringAsync.mockResolvedValue(toBase64(payload));

    const fetchMock = vi.mocked(globalThis.fetch);
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, photo: { id: 21 } }),
    } as Response);

    const response = await uploadIncidentPhoto({
      incidentId: 11,
      fileUri: "file://photo.jpg",
      fileName: "photo.jpg",
      contentType: "image/jpeg",
    });

    expect(response.photo.id).toBe(21);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, requestInit] = fetchMock.mock.calls[0];
    expect(url).toBe("https://worker.example/incidents/11/photos");
    expect(requestInit?.method).toBe("POST");
    expect((requestInit?.headers as Record<string, string>)["Content-Type"]).toBe("image/jpeg");
    expect((requestInit?.headers as Record<string, string>)["X-File-Name"]).toBe("photo.jpg");
  });
});
