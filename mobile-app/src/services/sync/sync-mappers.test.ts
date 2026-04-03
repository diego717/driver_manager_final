import { beforeEach, describe, expect, it, vi } from "vitest";

const secureStoreState = vi.hoisted(() => new Map<string, string>());
const secureStoreMocks = vi.hoisted(() => ({
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: "after_first_unlock_this_device_only",
  setItemAsync: vi.fn(async (key: string, value: string) => {
    secureStoreState.set(key, value);
  }),
  getItemAsync: vi.fn(async (key: string) => secureStoreState.get(key) ?? null),
  deleteItemAsync: vi.fn(async (key: string) => {
    secureStoreState.delete(key);
  }),
}));

vi.mock("expo-secure-store", () => secureStoreMocks);

import { setStoredIncidentSecret } from "../../storage/secure";
import { incidentToApiPayload } from "./sync-mappers";

describe("incidentToApiPayload", () => {
  beforeEach(() => {
    secureStoreState.clear();
    secureStoreMocks.setItemAsync.mockClear();
    secureStoreMocks.getItemAsync.mockClear();
    secureStoreMocks.deleteItemAsync.mockClear();
  });

  it("hydrates redacted incident fields from the secure vault", async () => {
    await setStoredIncidentSecret("incident-local-1", {
      reporterUsername: "driver.user",
      note: "Choque leve en porton principal",
      gpsCaptureNote: "GPS aproximado",
    });

    const payload = await incidentToApiPayload({
      localId: "incident-local-1",
      note: "__secure_store__",
      reporterUsername: "__secure_store__",
      timeAdjustmentSeconds: 30,
      severity: "high",
      source: "mobile",
      gpsCaptureStatus: "captured",
      gpsCaptureSource: "device",
      gpsLat: -34.9,
      gpsLng: -56.2,
      gpsAccuracyM: 8,
      gpsCapturedAt: "2026-04-01T12:00:00.000Z",
      gpsCaptureNote: "__secure_store__",
      clientRequestId: "client-request-1",
    } as never);

    expect(payload).toMatchObject({
      note: "Choque leve en porton principal",
      reporter_username: "driver.user",
      client_request_id: "client-request-1",
    });
    expect(payload.gps).toMatchObject({
      note: "GPS aproximado",
      status: "captured",
      source: "device",
    });
  });
});
