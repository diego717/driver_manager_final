/**
 * sync-mappers.ts
 * Helpers to convert between local WatermelonDB models and API payloads.
 */

import type Incident from '../../db/models/Incident'
import type { CreateIncidentInput } from '../../types/api'
import {
  getStoredIncidentSecret,
  isStoredSensitiveValueRedacted,
} from '../../storage/secure'

function resolveSensitiveString(
  persistedValue: string | null | undefined,
  secureValue: string | null | undefined,
): string {
  if (!isStoredSensitiveValueRedacted(persistedValue)) {
    return String(persistedValue || '')
  }
  return String(secureValue || '')
}

/**
 * Build a CreateIncidentInput payload from a local Incident record.
 * The `client_request_id` is passed as an extra field for idempotency;
 * the backend will ignore it if `client_request_id` support is not yet deployed.
 */
export async function incidentToApiPayload(
  incident: Incident,
): Promise<CreateIncidentInput & { client_request_id?: string }> {
  const secret = await getStoredIncidentSecret(incident.localId)

  return {
    note: resolveSensitiveString(incident.note, secret?.note),
    reporter_username: resolveSensitiveString(
      incident.reporterUsername,
      secret?.reporterUsername,
    ),
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
      note: resolveSensitiveString(incident.gpsCaptureNote, secret?.gpsCaptureNote) || undefined,
    },
    client_request_id: incident.clientRequestId || undefined,
  }
}
