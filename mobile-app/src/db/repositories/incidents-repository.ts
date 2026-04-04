import { database } from '../index'
import Incident from '../models/Incident'
import type { LocalSyncStatus } from '../models/Incident'
import type {
  GpsCapturePayload,
  Incident as ApiIncident,
  IncidentSeverity,
  IncidentSource,
  IncidentStatus,
} from '../../types/api'
import {
  getStoredIncidentSecret,
  redactStoredSensitiveValue,
  setStoredIncidentSecret,
} from '../../storage/secure'
import { sanitizeStoredSyncMessage } from '../../services/sync/sync-errors'

function normalizeOptionalString(value: unknown): string | null {
  const normalized = typeof value === 'string' ? value.trim() : String(value ?? '').trim()
  return normalized || null
}

function normalizeOptionalNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

async function mapIncidentModelToApiIncident(record: Incident): Promise<ApiIncident> {
  const secret = await getStoredIncidentSecret(record.localId)
  return {
    id: Number(record.remoteId || 0),
    installation_id: Number(record.remoteInstallationId || record.installationId),
    asset_id: normalizeOptionalNumber(record.assetId),
    reporter_username: secret?.reporterUsername || '',
    note: secret?.note || '',
    time_adjustment_seconds: Number(record.timeAdjustmentSeconds || 0),
    severity: (normalizeOptionalString(record.severity) || 'low') as IncidentSeverity,
    source: (normalizeOptionalString(record.source) || 'mobile') as IncidentSource,
    created_at: record.createdAt?.toISOString?.() || '',
    incident_status: (normalizeOptionalString(record.incidentStatus) || 'open') as IncidentStatus,
    status_updated_at: normalizeOptionalString(record.statusUpdatedAt),
    status_updated_by: normalizeOptionalString(record.statusUpdatedBy),
    estimated_duration_seconds: normalizeOptionalNumber(record.estimatedDurationSeconds),
    work_started_at: normalizeOptionalString(record.workStartedAt),
    work_ended_at: normalizeOptionalString(record.workEndedAt),
    actual_duration_seconds: normalizeOptionalNumber(record.actualDurationSeconds),
    resolved_at: normalizeOptionalString(record.resolvedAt),
    resolved_by: normalizeOptionalString(record.resolvedBy),
    resolution_note: secret?.resolutionNote || null,
    target_lat: normalizeOptionalNumber(record.targetLat),
    target_lng: normalizeOptionalNumber(record.targetLng),
    target_label: normalizeOptionalString(record.targetLabel),
    target_source: normalizeOptionalString(record.targetSource),
    target_updated_at: normalizeOptionalString(record.targetUpdatedAt),
    target_updated_by: normalizeOptionalString(record.targetUpdatedBy),
    dispatch_required: record.dispatchRequired !== false,
    dispatch_place_name: normalizeOptionalString(record.dispatchPlaceName),
    dispatch_address: normalizeOptionalString(record.dispatchAddress),
    dispatch_reference: normalizeOptionalString(record.dispatchReference),
    dispatch_contact_name: normalizeOptionalString(record.dispatchContactName),
    dispatch_contact_phone: normalizeOptionalString(record.dispatchContactPhone),
    dispatch_notes: normalizeOptionalString(record.dispatchNotes),
    checklist_items: (() => {
      try {
        return JSON.parse(record.checklistItemsJson || '[]')
      } catch {
        return []
      }
    })(),
    evidence_note: secret?.evidenceNote || null,
    photos: [],
  }
}

export interface CreateLocalIncidentParams {
  localId: string
  installationId: number
  remoteInstallationId?: number | null
  localCaseLocalId?: string | null
  reporterUsername: string
  note: string
  timeAdjustmentSeconds: number
  severity: string
  source: string
  clientRequestId: string
  gps: GpsCapturePayload
}

/**
 * Repository for the incidents table.
 * Handles local-first CRUD with sync metadata.
 */
export const incidentsRepository = {
  async createLocalIncident(params: CreateLocalIncidentParams): Promise<Incident> {
    await setStoredIncidentSecret(params.localId, {
      reporterUsername: params.reporterUsername,
      note: params.note,
      gpsCaptureNote: params.gps.note ?? '',
      resolutionNote: null,
      evidenceNote: null,
    })

    return database.write(() =>
      database.get<Incident>('incidents').create(incident => {
        incident.localId = params.localId
        incident.installationId = params.installationId
        incident.assetId = null
        incident.remoteInstallationId = params.remoteInstallationId ?? null
        incident.localCaseLocalId = params.localCaseLocalId ?? null
        incident.reporterUsername = redactStoredSensitiveValue()
        incident.note = redactStoredSensitiveValue()
        incident.timeAdjustmentSeconds = params.timeAdjustmentSeconds
        incident.severity = params.severity
        incident.source = params.source
        incident.clientRequestId = params.clientRequestId
        incident.gpsCaptureStatus = params.gps.status
        incident.gpsCaptureSource = params.gps.source ?? (params.gps.status === 'pending' ? 'none' : 'browser')
        incident.gpsLat = typeof params.gps.lat === 'number' ? params.gps.lat : null
        incident.gpsLng = typeof params.gps.lng === 'number' ? params.gps.lng : null
        incident.gpsAccuracyM = typeof params.gps.accuracy_m === 'number' ? params.gps.accuracy_m : null
        incident.gpsCapturedAt = params.gps.captured_at ?? null
        incident.gpsCaptureNote = redactStoredSensitiveValue()
        incident.incidentStatus = 'open'
        incident.statusUpdatedAt = null
        incident.statusUpdatedBy = null
        incident.estimatedDurationSeconds = null
        incident.workStartedAt = null
        incident.workEndedAt = null
        incident.actualDurationSeconds = null
        incident.resolvedAt = null
        incident.resolvedBy = null
        incident.resolutionNote = null
        incident.targetLat = null
        incident.targetLng = null
        incident.targetLabel = null
        incident.targetSource = null
        incident.targetUpdatedAt = null
        incident.targetUpdatedBy = null
        incident.dispatchRequired = true
        incident.dispatchPlaceName = null
        incident.dispatchAddress = null
        incident.dispatchReference = null
        incident.dispatchContactName = null
        incident.dispatchContactPhone = null
        incident.dispatchNotes = null
        incident.checklistItemsJson = null
        incident.evidenceNote = null
        incident.localSyncStatus = 'pending'
        incident.syncAttempts = 0
        incident.lastSyncError = null
        incident.isSynced = false
        incident.remoteId = null
      })
    )
  },

  async getByLocalId(localId: string): Promise<Incident | null> {
    const all = await database.get<Incident>('incidents').query().fetch()
    return all.find(i => i.localId === localId) ?? null
  },

  async updateRemoteId(localId: string, remoteId: number): Promise<void> {
    const incident = await incidentsRepository.getByLocalId(localId)
    if (!incident) return
    await database.write(() =>
      incident.update(i => {
        i.remoteId = remoteId
        i.isSynced = true
        i.localSyncStatus = 'synced'
        i.lastSyncError = null
      })
    )
  },

  async updateSyncStatus(localId: string, status: LocalSyncStatus, error?: string): Promise<void> {
    const incident = await incidentsRepository.getByLocalId(localId)
    if (!incident) return
    await database.write(() =>
      incident.update(i => {
        i.localSyncStatus = status
        if (status === 'failed') {
          i.syncAttempts = i.syncAttempts + 1
          i.lastSyncError = sanitizeStoredSyncMessage(error)
        } else if (status === 'pending') {
          i.lastSyncError = sanitizeStoredSyncMessage(error)
        } else if (status === 'syncing') {
          i.lastSyncError = null
        } else if (status === 'synced') {
          i.isSynced = true
          i.lastSyncError = null
        }
      })
    )
  },

  async getPendingIncidents(): Promise<Incident[]> {
    const all = await database.get<Incident>('incidents').query().fetch()
    return all.filter(i => i.localSyncStatus === 'pending' || i.localSyncStatus === 'failed')
  },

  async upsertRemoteIncidentSnapshot(incident: ApiIncident): Promise<void> {
    const remoteId = Number(incident.id)
    if (!Number.isInteger(remoteId) || remoteId <= 0) return
    const localId = `remote-incident-${remoteId}`
    const existing = await incidentsRepository.getByLocalId(localId)

    await setStoredIncidentSecret(localId, {
      reporterUsername: incident.reporter_username || null,
      note: incident.note || null,
      gpsCaptureNote: null,
      resolutionNote: incident.resolution_note || null,
      evidenceNote: incident.evidence_note || null,
    })

    const writeSnapshot = (record: Incident) => {
      record.localId = localId
      record.installationId = Number(incident.installation_id)
      record.assetId = normalizeOptionalNumber(incident.asset_id)
      record.remoteInstallationId = Number(incident.installation_id)
      record.localCaseLocalId = null
      record.reporterUsername = redactStoredSensitiveValue()
      record.note = redactStoredSensitiveValue()
      const createdAtMs = Date.parse(String(incident.created_at || ''))
      if (Number.isFinite(createdAtMs) && createdAtMs > 0) {
        ;(record as any)._raw.created_at = createdAtMs
      }
      record.timeAdjustmentSeconds = Number(incident.time_adjustment_seconds || 0)
      record.severity = normalizeOptionalString(incident.severity) || 'low'
      record.source = normalizeOptionalString(incident.source) || 'mobile'
      record.clientRequestId = record.clientRequestId || ''
      record.gpsCaptureStatus = 'pending'
      record.gpsCaptureSource = 'none'
      record.gpsLat = null
      record.gpsLng = null
      record.gpsAccuracyM = null
      record.gpsCapturedAt = null
      record.gpsCaptureNote = ''
      record.incidentStatus = normalizeOptionalString(incident.incident_status) || 'open'
      record.statusUpdatedAt = normalizeOptionalString(incident.status_updated_at)
      record.statusUpdatedBy = normalizeOptionalString(incident.status_updated_by)
      record.estimatedDurationSeconds = normalizeOptionalNumber(incident.estimated_duration_seconds)
      record.workStartedAt = normalizeOptionalString(incident.work_started_at)
      record.workEndedAt = normalizeOptionalString(incident.work_ended_at)
      record.actualDurationSeconds = normalizeOptionalNumber(incident.actual_duration_seconds)
      record.resolvedAt = normalizeOptionalString(incident.resolved_at)
      record.resolvedBy = normalizeOptionalString(incident.resolved_by)
      record.resolutionNote = incident.resolution_note ? redactStoredSensitiveValue() : null
      record.targetLat = normalizeOptionalNumber(incident.target_lat)
      record.targetLng = normalizeOptionalNumber(incident.target_lng)
      record.targetLabel = normalizeOptionalString(incident.target_label)
      record.targetSource = normalizeOptionalString(incident.target_source)
      record.targetUpdatedAt = normalizeOptionalString(incident.target_updated_at)
      record.targetUpdatedBy = normalizeOptionalString(incident.target_updated_by)
      record.dispatchRequired = incident.dispatch_required !== false
      record.dispatchPlaceName = normalizeOptionalString(incident.dispatch_place_name)
      record.dispatchAddress = normalizeOptionalString(incident.dispatch_address)
      record.dispatchReference = normalizeOptionalString(incident.dispatch_reference)
      record.dispatchContactName = normalizeOptionalString(incident.dispatch_contact_name)
      record.dispatchContactPhone = normalizeOptionalString(incident.dispatch_contact_phone)
      record.dispatchNotes = normalizeOptionalString(incident.dispatch_notes)
      record.checklistItemsJson = JSON.stringify(Array.isArray(incident.checklist_items) ? incident.checklist_items : [])
      record.evidenceNote = incident.evidence_note ? redactStoredSensitiveValue() : null
      record.localSyncStatus = 'synced'
      record.isSynced = true
      record.remoteId = remoteId
      record.lastSyncError = null
    }

    if (existing) {
      await database.write(() =>
        existing.update((record) => {
          writeSnapshot(record)
        }),
      )
      return
    }

    await database.write(() =>
      database.get<Incident>('incidents').create((record) => {
        writeSnapshot(record)
      }),
    )
  },

  async replaceRemoteInstallationSnapshots(
    installationId: number,
    incidents: ApiIncident[],
  ): Promise<void> {
    const targetInstallationId = Number(installationId)
    const all = await database.get<Incident>('incidents').query().fetch()
    const remoteIds = new Set(
      incidents.map((incident) => Number(incident.id)).filter((value) => Number.isInteger(value) && value > 0),
    )
    const staleRecords = all.filter((record) =>
      Number(record.remoteInstallationId || record.installationId) === targetInstallationId &&
      record.localSyncStatus === 'synced' &&
      Number.isInteger(Number(record.remoteId)) &&
      Number(record.remoteId) > 0 &&
      !remoteIds.has(Number(record.remoteId)),
    )

    for (const incident of incidents) {
      await incidentsRepository.upsertRemoteIncidentSnapshot(incident)
    }

    if (staleRecords.length > 0) {
      await database.write(async () => {
        await Promise.all(staleRecords.map((record) => record.markAsDeleted()))
        await Promise.all(staleRecords.map((record) => record.destroyPermanently()))
      })
    }
  },

  async getCachedIncidentByRemoteId(remoteId: number): Promise<ApiIncident | null> {
    const all = await database.get<Incident>('incidents').query().fetch()
    const match = all.find((record) => Number(record.remoteId) === Number(remoteId))
    return match ? mapIncidentModelToApiIncident(match) : null
  },

  async listCachedIncidentsByInstallation(installationId: number): Promise<ApiIncident[]> {
    const all = await database.get<Incident>('incidents').query().fetch()
    const matches = all.filter((record) =>
      Number(record.remoteInstallationId || record.installationId) === Number(installationId) &&
      Number.isInteger(Number(record.remoteId)) &&
      Number(record.remoteId) > 0,
    )
    return Promise.all(matches.map(mapIncidentModelToApiIncident))
  },
}
