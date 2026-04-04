import { Model } from '@nozbe/watermelondb'
import { field, text, readonly, date, children, writer } from '@nozbe/watermelondb/decorators'
import { Associations } from '@nozbe/watermelondb/Model'
import Photo from './Photo'
import type { GpsCaptureStatus, GpsCaptureSource } from '../../types/api'
import { redactStoredSensitiveValue, setStoredPhotoSecret } from '../../storage/secure'
import { sanitizeStoredSyncMessage } from '../../services/sync/sync-errors'

/** Our app-specific sync state — named to avoid clash with WMDb's own SyncStatus */
export type LocalSyncStatus = 'pending' | 'syncing' | 'failed' | 'synced'

export default class Incident extends Model {
  static table = 'incidents'

  static associations: Associations = {
    photos: { type: 'has_many', foreignKey: 'incident_id' },
  }

  // Core fields
  @field('installation_id') installationId: number
  @field('asset_id') assetId: number | null
  @field('reporter_username') reporterUsername: string
  @text('note') note: string
  @field('time_adjustment_seconds') timeAdjustmentSeconds: number
  @field('severity') severity: string
  @field('source') source: string
  @readonly @date('created_at') createdAt: Date

  // Legacy sync (kept for compatibility)
  @field('is_synced') isSynced: boolean
  @field('remote_id') remoteId: number | null

  // Offline sync v2  — field name prefixed with 'local' to avoid WMDb clash
  @text('local_id') localId: string
  @field('remote_installation_id') remoteInstallationId: number | null
  @text('local_case_local_id') localCaseLocalId: string | null
  @text('sync_status') localSyncStatus: LocalSyncStatus
  @field('sync_attempts') syncAttempts: number
  @text('last_sync_error') lastSyncError: string | null
  @text('client_request_id') clientRequestId: string
  @text('gps_capture_status') gpsCaptureStatus: GpsCaptureStatus
  @text('gps_capture_source') gpsCaptureSource: GpsCaptureSource
  @field('gps_lat') gpsLat: number | null
  @field('gps_lng') gpsLng: number | null
  @field('gps_accuracy_m') gpsAccuracyM: number | null
  @text('gps_captured_at') gpsCapturedAt: string | null
  @text('gps_capture_note') gpsCaptureNote: string
  @text('incident_status') incidentStatus: string
  @text('status_updated_at') statusUpdatedAt: string | null
  @text('status_updated_by') statusUpdatedBy: string | null
  @field('estimated_duration_seconds') estimatedDurationSeconds: number | null
  @text('work_started_at') workStartedAt: string | null
  @text('work_ended_at') workEndedAt: string | null
  @field('actual_duration_seconds') actualDurationSeconds: number | null
  @text('resolved_at') resolvedAt: string | null
  @text('resolved_by') resolvedBy: string | null
  @text('resolution_note') resolutionNote: string | null
  @field('target_lat') targetLat: number | null
  @field('target_lng') targetLng: number | null
  @text('target_label') targetLabel: string | null
  @text('target_source') targetSource: string | null
  @text('target_updated_at') targetUpdatedAt: string | null
  @text('target_updated_by') targetUpdatedBy: string | null
  @field('dispatch_required') dispatchRequired: boolean
  @text('dispatch_place_name') dispatchPlaceName: string | null
  @text('dispatch_address') dispatchAddress: string | null
  @text('dispatch_reference') dispatchReference: string | null
  @text('dispatch_contact_name') dispatchContactName: string | null
  @text('dispatch_contact_phone') dispatchContactPhone: string | null
  @text('dispatch_notes') dispatchNotes: string | null
  @text('checklist_items_json') checklistItemsJson: string | null
  @text('evidence_note') evidenceNote: string | null

  @children('photos') photos: Photo[]

  @writer async addPhoto(localPath: string, fileName: string, contentType: string, size: number) {
    const localId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
    await setStoredPhotoSecret(localId, {
      localPath,
      fileName,
    })

    const newPhoto = await this.collections.get<Photo>('photos').create(photo => {
      photo.incidentRecordId = this.id
      photo.localPath = redactStoredSensitiveValue()
      photo.fileName = redactStoredSensitiveValue()
      photo.contentType = contentType
      photo.sizeBytes = size
      photo.isSynced = false
      photo.remoteIncidentId = this.remoteId
      photo.localIncidentLocalId = this.localId
      photo.localSyncStatus = 'pending'
      photo.syncAttempts = 0
      photo.clientRequestId = ''
      photo.localId = localId
    })
    return newPhoto
  }

  @writer async markAsSynced(remoteId: number) {
    await this.update(incident => {
      incident.isSynced = true
      incident.remoteId = remoteId
      incident.localSyncStatus = 'synced'
      incident.syncAttempts = 0
      incident.lastSyncError = null
    })
  }

  @writer async markLocalSyncStatus(status: LocalSyncStatus, error?: string) {
    await this.update(incident => {
      incident.localSyncStatus = status
      if (status === 'failed') {
        incident.syncAttempts = incident.syncAttempts + 1
        incident.lastSyncError = sanitizeStoredSyncMessage(error)
      } else if (status === 'synced') {
        incident.isSynced = true
        incident.lastSyncError = null
      }
    })
  }
}
