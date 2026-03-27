import type {
  GeofenceResult,
  GpsCapturePayload,
  GpsCaptureStatus,
  InstallationRecord,
} from "@/src/types/api";

export type GeofencePreview = {
  result: GeofenceResult;
  distance_m: number | null;
  radius_m: number | null;
};

export function formatGpsStatusLabel(status: GpsCaptureStatus | string | null | undefined): string {
  const normalized = String(status || "").trim().toLowerCase();
  if (normalized === "captured") return "GPS capturado";
  if (normalized === "denied") return "Permiso denegado";
  if (normalized === "timeout") return "GPS agotado";
  if (normalized === "unavailable") return "GPS no disponible";
  if (normalized === "unsupported") return "GPS no soportado";
  if (normalized === "override") return "Override manual";
  return "GPS pendiente";
}

export function formatGpsSummary(snapshot: GpsCapturePayload | null | undefined): string {
  if (!snapshot) return "Todavia no se capturo ubicacion para este cierre.";

  if (snapshot.status === "captured") {
    const accuracy = Number(snapshot.accuracy_m);
    const parts = [
      Number.isFinite(snapshot.lat) ? `Lat ${Number(snapshot.lat).toFixed(5)}` : null,
      Number.isFinite(snapshot.lng) ? `Lng ${Number(snapshot.lng).toFixed(5)}` : null,
      Number.isFinite(accuracy) ? `Precision ${Math.round(accuracy)} m` : null,
    ].filter(Boolean);
    return parts.length > 0
      ? parts.join(" | ")
      : "GPS capturado sin precision reportada.";
  }

  if (snapshot.status === "override" && snapshot.note?.trim()) {
    return `Cierre manual justificado: ${snapshot.note.trim()}`;
  }

  if (snapshot.note?.trim()) {
    return snapshot.note.trim();
  }

  return "Todavia no se capturo ubicacion para este cierre.";
}

export function hasInstallationSiteConfig(
  installation: Pick<InstallationRecord, "site_lat" | "site_lng" | "site_radius_m"> | null | undefined,
): boolean {
  return (
    Number.isFinite(Number(installation?.site_lat)) &&
    Number.isFinite(Number(installation?.site_lng)) &&
    Number.isFinite(Number(installation?.site_radius_m)) &&
    Number(installation?.site_radius_m) > 0
  );
}

function haversineDistanceMeters(fromLat: number, fromLng: number, toLat: number, toLng: number): number {
  const earthRadiusM = 6371000;
  const toRadians = (value: number) => (value * Math.PI) / 180;
  const lat1 = toRadians(fromLat);
  const lat2 = toRadians(toLat);
  const dLat = toRadians(toLat - fromLat);
  const dLng = toRadians(toLng - fromLng);
  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const a = sinLat * sinLat + Math.cos(lat1) * Math.cos(lat2) * sinLng * sinLng;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return earthRadiusM * c;
}

export function evaluateGeofencePreview(
  snapshot: GpsCapturePayload | null | undefined,
  installation: Pick<InstallationRecord, "site_lat" | "site_lng" | "site_radius_m"> | null | undefined,
): GeofencePreview {
  const radius = Number(installation?.site_radius_m);
  if (!hasInstallationSiteConfig(installation)) {
    return {
      result: "not_applicable",
      distance_m: null,
      radius_m: Number.isFinite(radius) ? radius : null,
    };
  }

  if (!snapshot || snapshot.status !== "captured") {
    return {
      result: "not_applicable",
      distance_m: null,
      radius_m: radius,
    };
  }

  const siteLat = Number(installation?.site_lat);
  const siteLng = Number(installation?.site_lng);
  const gpsLat = Number(snapshot.lat);
  const gpsLng = Number(snapshot.lng);
  if (!Number.isFinite(gpsLat) || !Number.isFinite(gpsLng)) {
    return {
      result: "not_applicable",
      distance_m: null,
      radius_m: radius,
    };
  }

  const distance = haversineDistanceMeters(siteLat, siteLng, gpsLat, gpsLng);
  return {
    result: distance <= radius ? "inside" : "outside",
    distance_m: distance,
    radius_m: radius,
  };
}

export function formatGeofenceSummary(preview: GeofencePreview): string {
  if (preview.result === "inside") {
    return `Dentro del radio del sitio (${Math.round(preview.distance_m || 0)} m de ${Math.round(preview.radius_m || 0)} m).`;
  }
  if (preview.result === "outside") {
    return `Fuera del radio del sitio (${Math.round(preview.distance_m || 0)} m de ${Math.round(preview.radius_m || 0)} m).`;
  }
  if (Number.isFinite(Number(preview.radius_m)) && Number(preview.radius_m) > 0) {
    return `Sitio configurado con radio de ${Math.round(Number(preview.radius_m))} m.`;
  }
  return "Este caso no tiene sitio configurado para validar geofence.";
}
