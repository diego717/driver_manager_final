import { type AssignedIncidentMapItem, type Incident } from "../types/api";

type DispatchLikeIncident = Pick<
  Incident,
  "target_lat" | "target_lng" | "dispatch_address" | "dispatch_place_name" | "target_label" | "dispatch_reference"
> | Pick<
  AssignedIncidentMapItem,
  "target_lat" | "target_lng" | "dispatch_address" | "dispatch_place_name" | "target_label" | "dispatch_reference"
>;

export function getIncidentDestinationCoordinate(
  incident: DispatchLikeIncident | null | undefined,
): { latitude: number; longitude: number } | null {
  if (!incident) return null;
  const latitude = Number(incident.target_lat);
  const longitude = Number(incident.target_lng);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return null;
  }
  return { latitude, longitude };
}

export function buildIncidentNavigationTargets(
  incident: DispatchLikeIncident | null | undefined,
): { google: string | null; waze: string | null } {
  if (!incident) return { google: null, waze: null };

  const coordinate = getIncidentDestinationCoordinate(incident);
  const address = String(incident.dispatch_address || "").trim();

  if (coordinate) {
    const query = `${coordinate.latitude},${coordinate.longitude}`;
    return {
      google: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`,
      waze: `https://waze.com/ul?ll=${encodeURIComponent(query)}&navigate=yes`,
    };
  }

  if (address) {
    return {
      google: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`,
      waze: null,
    };
  }

  return { google: null, waze: null };
}

export function getIncidentDestinationLabel(
  incident: DispatchLikeIncident | null | undefined,
): string {
  if (!incident) return "Destino sin definir";
  return String(
    incident.dispatch_place_name ||
    incident.dispatch_address ||
    incident.target_label ||
    incident.dispatch_reference ||
    "Destino sin definir",
  ).trim();
}

export function calculateDistanceMeters(
  from: { latitude: number; longitude: number } | null,
  to: { latitude: number; longitude: number } | null,
): number | null {
  if (!from || !to) return null;
  const toRadians = (value: number) => (value * Math.PI) / 180;
  const earthRadiusMeters = 6_371_000;
  const deltaLatitude = toRadians(to.latitude - from.latitude);
  const deltaLongitude = toRadians(to.longitude - from.longitude);
  const fromLatitude = toRadians(from.latitude);
  const toLatitude = toRadians(to.latitude);

  const haversine =
    Math.sin(deltaLatitude / 2) ** 2 +
    Math.cos(fromLatitude) * Math.cos(toLatitude) * Math.sin(deltaLongitude / 2) ** 2;
  const arc = 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
  return Math.round(earthRadiusMeters * arc);
}

export function formatDistanceMeters(value: number | null): string {
  if (!Number.isFinite(value) || value === null || value < 0) return "-";
  if (value < 1000) return `${Math.round(value)} m`;
  return `${(value / 1000).toFixed(value >= 10_000 ? 0 : 1)} km`;
}
