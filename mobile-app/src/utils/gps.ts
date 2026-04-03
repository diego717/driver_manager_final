import type {
  GpsCapturePayload,
  GpsCaptureStatus,
} from "@/src/types/api";

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
