/**
 * sync-mappers.ts
 * Helpers to convert between local WatermelonDB models and API payloads.
 */

import type Incident from '../../db/models/Incident'
import type { CreateIncidentInput } from '../../types/api'

/**
 * Build a CreateIncidentInput payload from a local Incident record.
 * The `client_request_id` is passed as an extra field for idempotency;
 * the backend will ignore it if `client_request_id` support is not yet deployed.
 */
export function incidentToApiPayload(
  incident: Incident,
): CreateIncidentInput & { client_request_id?: string } {
  return {
    note: incident.note,
    reporter_username: incident.reporterUsername,
    time_adjustment_seconds: incident.timeAdjustmentSeconds,
    severity: incident.severity as CreateIncidentInput['severity'],
    source: incident.source as CreateIncidentInput['source'],
    apply_to_installation: false,
    gps: {
      status: incident.gpsCaptureStatus,
      source: incident.gpsCaptureSource,
      lat: incident.gpsLat ?? undefined,
      lng: incident.gpsLng ?? undefined,
      accuracy_m: incident.gpsAccuracyM ?? undefined,
      captured_at: incident.gpsCapturedAt ?? undefined,
      note: incident.gpsCaptureNote || undefined,
    },
    geofence_override_note: incident.geofenceOverrideNote || undefined,
    client_request_id: incident.clientRequestId || undefined,
  }
}
