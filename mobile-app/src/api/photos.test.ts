import { beforeEach, describe, expect, it, vi } from "vitest";

const fileSystemMock = vi.hoisted(() => ({
  readAsStringAsync: vi.fn(),
  getInfoAsync: vi.fn(),
  EncodingType: { Base64: "base64" },
}));

const clientMock = vi.hoisted(() => ({
  getResolvedApiBaseUrl: vi.fn(),
  resolveRequestAuth: vi.fn(),
}));

vi.mock("expo-file-system/legacy", () => fileSystemMock);
vi.mock("./client", () => clientMock);

import { uploadIncidentPhoto } from "./photos";
import { fetchIncidentPhotoDataUri } from "./photos";

describe("photos api", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clientMock.getResolvedApiBaseUrl.mockResolvedValue("https://worker.example");
    clientMock.resolveRequestAuth.mockResolvedValue({
      path: "/web/incidents/11/photos",
      headers: {
        Authorization: "Bearer web-token",
        "X-Client-Platform": "mobile",
      },
    });
    vi.stubGlobal("fetch", vi.fn());
  });

  it("rejects too-small image payload before upload", async () => {
    const payload = new Uint8Array(512);
    payload.set([0xff, 0xd8, 0xff], 0);
    fileSystemMock.getInfoAsync.mockResolvedValue({ exists: true, size: payload.byteLength });

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
    fileSystemMock.getInfoAsync.mockResolvedValue({ exists: true, size: payload.byteLength });

    const fetchMock = vi.mocked(globalThis.fetch);
    fetchMock.mockImplementation(async (url) => {
      if (url === "file://photo.jpg") {
        return {
          ok: true,
          status: 200,
          arrayBuffer: async () => payload.buffer,
          headers: new Headers(),
        } as Response;
      }
      return {
        ok: true,
        json: async () => ({ success: true, photo: { id: 21 } }),
      } as Response;
    });

    const response = await uploadIncidentPhoto({
      incidentId: 11,
      fileUri: "file://photo.jpg",
      fileName: "photo.jpg",
      contentType: "image/jpeg",
    });

    expect(response.photo.id).toBe(21);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [url, requestInit] = fetchMock.mock.calls[1];
    expect(url).toBe("https://worker.example/web/incidents/11/photos");
    expect(requestInit?.method).toBe("POST");
    expect((requestInit?.headers as Record<string, string>)["Content-Type"]).toBe("image/jpeg");
    expect((requestInit?.headers as Record<string, string>)["X-File-Name"]).toBe("photo.jpg");
  });

  it("downloads incident photo as data URI with resolved auth headers", async () => {
    clientMock.resolveRequestAuth.mockResolvedValueOnce({
      path: "/photos/44",
      headers: {
        Authorization: "Bearer web-token",
      },
    });

    const pngBytes = Uint8Array.from([0x89, 0x50, 0x4e, 0x47]);
    const fetchMock = vi.mocked(globalThis.fetch);
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({
        "Content-Type": "image/png",
      }),
      arrayBuffer: async () => pngBytes.buffer,
    } as Response);

    const dataUri = await fetchIncidentPhotoDataUri(44);

    expect(dataUri).toBe("data:image/png;base64,iVBORw==");
    expect(clientMock.resolveRequestAuth).toHaveBeenCalledWith({
      method: "GET",
      path: "/photos/44",
      bodyHash:
        "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    });
    expect(fetchMock).toHaveBeenCalledWith("https://worker.example/photos/44", {
      method: "GET",
      headers: {
        Authorization: "Bearer web-token",
      },
    });
  });

  it("throws explicit HTTP error when photo download fails", async () => {
    clientMock.resolveRequestAuth.mockResolvedValueOnce({
      path: "/web/photos/99",
      headers: {},
    });

    const fetchMock = vi.mocked(globalThis.fetch);
    fetchMock.mockResolvedValue({
      ok: false,
      status: 404,
      headers: new Headers(),
      arrayBuffer: async () => new ArrayBuffer(0),
    } as Response);

    await expect(fetchIncidentPhotoDataUri(99)).rejects.toThrow(
      "No se pudo descargar foto #99 (HTTP 404).",
    );
  });
});
