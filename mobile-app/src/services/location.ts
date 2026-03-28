import type { GpsCapturePayload } from "@/src/types/api";
import { requireOptionalNativeModule } from "expo-modules-core";

const GPS_CAPTURE_TIMEOUT_MS = 12_000;

function buildNonCapturedSnapshot(
  status: GpsCapturePayload["status"],
  note: string,
): GpsCapturePayload {
  return {
    status,
    source: status === "pending" ? "none" : "browser",
    note,
  };
}

type ExpoLocationModule = typeof import("expo-location");

async function loadExpoLocation(): Promise<ExpoLocationModule | null> {
  const nativeModule = requireOptionalNativeModule("ExpoLocation");
  if (!nativeModule) {
    return null;
  }

  try {
    return await import("expo-location");
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.includes("ExpoLocation") || message.includes("native module")) {
      return null;
    }
    throw error;
  }
}

export async function captureCurrentGpsSnapshot(): Promise<GpsCapturePayload> {
  const Location = await loadExpoLocation();
  if (!Location) {
    return buildNonCapturedSnapshot(
      "unavailable",
      "El modulo nativo de ubicacion no esta disponible en esta build.",
    );
  }

  const permission = await Location.requestForegroundPermissionsAsync();
  if (!permission.granted) {
    return buildNonCapturedSnapshot("denied", "No se concedio permiso de ubicacion.");
  }

  try {
    const position = await Promise.race([
      Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      }),
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error("timeout")), GPS_CAPTURE_TIMEOUT_MS);
      }),
    ]);

    const latitude = Number(position.coords?.latitude);
    const longitude = Number(position.coords?.longitude);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      return buildNonCapturedSnapshot("unavailable", "El dispositivo no devolvio coordenadas validas.");
    }

    const accuracy = Number(position.coords?.accuracy);
    return {
      status: "captured",
      source: "browser",
      lat: latitude,
      lng: longitude,
      accuracy_m: Number.isFinite(accuracy) && accuracy >= 0 ? accuracy : 0,
      captured_at: new Date(position.timestamp || Date.now()).toISOString(),
      note: "",
    };
  } catch (error) {
    if (error instanceof Error && error.message === "timeout") {
      return buildNonCapturedSnapshot("timeout", "La captura GPS demoro demasiado.");
    }
    return buildNonCapturedSnapshot("unavailable", "No se pudo obtener la ubicacion actual.");
  }
}
