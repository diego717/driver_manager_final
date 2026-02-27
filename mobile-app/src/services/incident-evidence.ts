import { Q } from '@nozbe/watermelondb'

import { createIncident } from '@/src/api/incidents'
import { uploadIncidentPhoto } from '@/src/api/photos'
import { database } from '@/src/db'
import Incident from '@/src/db/models/Incident'
import Photo from '@/src/db/models/Photo'
import type { IncidentChecklistAppliedItem, IncidentSeverity } from '@/src/types/api'

export interface EvidenceCaptureDraft {
  uri: string
  fileName: string
  contentType: string
  sizeBytes: number
  capturedAtEpochMs: number
  latitude?: number | null
  longitude?: number | null
  accuracyM?: number | null
}

export interface PersistIncidentEvidenceInput {
  installationId: number
  existingRemoteIncidentId?: number | null
  reporterUsername: string
  note: string
  checklistApplied: IncidentChecklistAppliedItem[]
  severity?: IncidentSeverity
  evidences: EvidenceCaptureDraft[]
}

function safeParseChecklist(raw: string | null | undefined): IncidentChecklistAppliedItem[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

async function ensureLocalIncident(input: PersistIncidentEvidenceInput): Promise<Incident> {
  const incidentsCollection = database.collections.get<Incident>('incidents')

  if (input.existingRemoteIncidentId && input.existingRemoteIncidentId > 0) {
    const matches = await incidentsCollection
      .query(Q.where('remote_id', input.existingRemoteIncidentId))
      .fetch()
    const existing = matches[0]
    if (existing) {
      await database.write(async () => {
        await existing.update(incident => {
          incident.note = input.note
          incident.checklistAppliedJson = JSON.stringify(input.checklistApplied || [])
        })
      })
      return existing
    }
  }

  const created = await database.write(async () =>
    incidentsCollection.create(incident => {
      incident.installationId = input.installationId
      incident.reporterUsername = input.reporterUsername.trim() || 'mobile_user'
      incident.note = input.note
      incident.timeAdjustmentSeconds = 0
      incident.severity = input.severity || 'medium'
      incident.source = 'mobile'
      incident.checklistAppliedJson = JSON.stringify(input.checklistApplied || [])
      incident.isSynced = Boolean(input.existingRemoteIncidentId)
      incident.remoteId = input.existingRemoteIncidentId || null
    }),
  )

  return created
}

export async function persistIncidentEvidenceLocally(input: PersistIncidentEvidenceInput): Promise<Incident> {
  const localIncident = await ensureLocalIncident(input)
  const photosCollection = database.collections.get<Photo>('photos')

  await database.write(async () => {
    for (const evidence of input.evidences) {
      await photosCollection.create(photo => {
        photo.incident.set(localIncident)
        photo.r2Key = null
        photo.fileName = evidence.fileName
        photo.contentType = evidence.contentType
        photo.sizeBytes = evidence.sizeBytes
        photo.sha256 = null
        photo.capturedAt = evidence.capturedAtEpochMs
        photo.latitude = evidence.latitude ?? null
        photo.longitude = evidence.longitude ?? null
        photo.accuracyM = evidence.accuracyM ?? null
        photo.isSynced = false
        photo.localPath = evidence.uri
        photo.remoteId = null
      })
    }
  })

  return localIncident
}

export async function syncIncidentEvidence(localIncident: Incident): Promise<{
  remoteIncidentId: number
  uploadedCount: number
}> {
  let remoteIncidentId = localIncident.remoteId || null
  const checklistApplied = safeParseChecklist(localIncident.checklistAppliedJson)

  if (!remoteIncidentId) {
    const created = await createIncident(localIncident.installationId, {
      reporter_username: localIncident.reporterUsername || 'mobile_user',
      note: localIncident.note || '',
      time_adjustment_seconds: localIncident.timeAdjustmentSeconds || 0,
      severity: (localIncident.severity as IncidentSeverity) || 'medium',
      source: 'mobile',
      apply_to_installation: false,
      checklist_applied: checklistApplied,
    })
    remoteIncidentId = created.incident.id
    await localIncident.markAsSynced(remoteIncidentId)
  }

  const photosCollection = database.collections.get<Photo>('photos')
  const pendingPhotos = await photosCollection
    .query(
      Q.where('incident_id', localIncident.id),
      Q.where('is_synced', false),
    )
    .fetch()

  let uploadedCount = 0
  for (const photo of pendingPhotos) {
    if (!photo.localPath) continue
    const capturedAtIso =
      Number.isFinite(photo.capturedAt) && photo.capturedAt > 0
        ? new Date(photo.capturedAt).toISOString()
        : new Date().toISOString()

    const response = await uploadIncidentPhoto({
      incidentId: remoteIncidentId,
      fileUri: photo.localPath,
      fileName: photo.fileName,
      contentType: photo.contentType,
      captureMetadata: {
        capturedAt: capturedAtIso,
        latitude: photo.latitude,
        longitude: photo.longitude,
        accuracyM: photo.accuracyM,
      },
    })

    await photo.markAsSynced(response.photo.id, response.photo.r2_key, response.photo.sha256 || '')
    uploadedCount += 1
  }

  return {
    remoteIncidentId,
    uploadedCount,
  }
}
