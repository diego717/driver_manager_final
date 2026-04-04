import { Model } from '@nozbe/watermelondb'
import { field, text, readonly, date, writer } from '@nozbe/watermelondb/decorators'
import type { LocalSyncStatus } from './Incident'
import { sanitizeStoredSyncMessage } from '../../services/sync/sync-errors'

export default class Photo extends Model {
  static table = 'photos'

  @text('incident_id') incidentRecordId: string

  // Core fields
  @text('r2_key') r2Key: string | null
  @text('file_name') fileName: string
  @text('content_type') contentType: string
  @field('size_bytes') sizeBytes: number
  @text('sha256') sha256: string | null
  @readonly @date('created_at') createdAt: Date

  // Legacy sync fields
  @field('is_synced') isSynced: boolean
  @text('local_path') localPath: string
  @field('remote_id') remoteId: number | null

  // Offline sync v2 — prefixed to avoid WMDb base class clash
  @text('local_id') localId: string
  @field('remote_photo_id') remotePhotoId: number | null
  @field('remote_incident_id') remoteIncidentId: number | null
  @text('local_incident_local_id') localIncidentLocalId: string | null
  @text('sync_status') localSyncStatus: LocalSyncStatus
  @field('sync_attempts') syncAttempts: number
  @text('last_sync_error') lastSyncError: string | null
  @text('client_request_id') clientRequestId: string

  @writer async markAsSynced(remoteId: number, r2Key: string, sha256: string) {
    await this.update(photo => {
      photo.isSynced = true
      photo.remoteId = remoteId
      photo.r2Key = r2Key
      photo.sha256 = sha256
      photo.localSyncStatus = 'synced'
      photo.lastSyncError = null
    })
  }

  @writer async markLocalSyncStatus(status: LocalSyncStatus, error?: string) {
    await this.update(photo => {
      photo.localSyncStatus = status
      if (status === 'failed') {
        photo.syncAttempts = photo.syncAttempts + 1
        photo.lastSyncError = sanitizeStoredSyncMessage(error)
      } else if (status === 'synced') {
        photo.isSynced = true
        photo.lastSyncError = null
      }
    })
  }
}
