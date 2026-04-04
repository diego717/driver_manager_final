import { beforeEach, describe, expect, it, vi } from "vitest";

const moduleState = vi.hoisted(() => ({
  nativeModuleAvailable: false,
}));

const expoLocationMocks = vi.hoisted(() => ({
  Accuracy: {
    Balanced: "balanced",
  },
  requestForegroundPermissionsAsync: vi.fn(async () => ({ granted: true })),
  getCurrentPositionAsync: vi.fn(async () => ({
    coords: {
      latitude: -34.9,
      longitude: -56.1,
      accuracy: 8,
    },
    timestamp: Date.parse("2026-04-04T12:00:00.000Z"),
  })),
}));

vi.mock("expo-modules-core", () => ({
  requireOptionalNativeModule: vi.fn(() =>
    moduleState.nativeModuleAvailable ? {} : null,
  ),
}));

vi.mock("expo-location", () => expoLocationMocks);

async function loadLocationModule() {
  vi.resetModules();
  return import("./location");
}

describe("location service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    moduleState.nativeModuleAvailable = false;
    expoLocationMocks.requestForegroundPermissionsAsync.mockResolvedValue({ granted: true });
    expoLocationMocks.getCurrentPositionAsync.mockResolvedValue({
      coords: {
        latitude: -34.9,
        longitude: -56.1,
        accuracy: 8,
      },
      timestamp: Date.parse("2026-04-04T12:00:00.000Z"),
    });
  });

  it("returns unavailable when the native location module is missing", async () => {
    const location = await loadLocationModule();

    await expect(location.captureCurrentGpsSnapshot()).resolves.toEqual({
      status: "unavailable",
      source: "browser",
      note: "El modulo nativo de ubicacion no esta disponible en esta build.",
    });
  });

  it("returns denied when foreground permission is not granted", async () => {
    moduleState.nativeModuleAvailable = true;
    expoLocationMocks.requestForegroundPermissionsAsync.mockResolvedValueOnce({
      granted: false,
    });
    const location = await loadLocationModule();

    await expect(location.captureCurrentGpsSnapshot()).resolves.toEqual({
      status: "denied",
      source: "browser",
      note: "No se concedio permiso de ubicacion.",
    });
  });

  it("returns captured gps payload when coordinates are valid", async () => {
    moduleState.nativeModuleAvailable = true;
    const location = await loadLocationModule();

    await expect(location.captureCurrentGpsSnapshot()).resolves.toEqual({
      status: "captured",
      source: "browser",
      lat: -34.9,
      lng: -56.1,
      accuracy_m: 8,
      captured_at: "2026-04-04T12:00:00.000Z",
      note: "",
    });
  });

  it("returns timeout when the location provider signals a timeout", async () => {
    moduleState.nativeModuleAvailable = true;
    expoLocationMocks.getCurrentPositionAsync.mockRejectedValueOnce(new Error("timeout"));
    const location = await loadLocationModule();

    await expect(location.captureCurrentGpsSnapshot()).resolves.toEqual({
      status: "timeout",
      source: "browser",
      note: "La captura GPS demoro demasiado.",
    });
  });
});
