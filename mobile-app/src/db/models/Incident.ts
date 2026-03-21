import { Model } from '@nozbe/watermelondb'
import { field, text, readonly, date, children, writer } from '@nozbe/watermelondb/decorators'
import { Associations } from '@nozbe/watermelondb/Model'
import Photo from './Photo'

/** Our app-specific sync state — named to avoid clash with WMDb's own SyncStatus */
export type LocalSyncStatus = 'pending' | 'syncing' | 'failed' | 'synced'

export default class Incident extends Model {
  static table = 'incidents'

  static associations: Associations = {
    photos: { type: 'has_many', foreignKey: 'incident_id' },
  }

  // Core fields
  @field('installation_id') installationId!: number
  @field('reporter_username') reporterUsername!: string
  @text('note') note!: string
  @field('time_adjustment_seconds') timeAdjustmentSeconds!: number
  @field('severity') severity!: string
  @field('source') source!: string
  @readonly @date('created_at') createdAt!: Date

  // Legacy sync (kept for compatibility)
  @field('is_synced') isSynced!: boolean
  @field('remote_id') remoteId!: number | null

  // Offline sync v2  — field name prefixed with 'local' to avoid WMDb clash
  @text('local_id') localId!: string
  @field('remote_installation_id') remoteInstallationId!: number | null
  @text('sync_status') localSyncStatus!: LocalSyncStatus
  @field('sync_attempts') syncAttempts!: number
  @text('last_sync_error') lastSyncError!: string | null
  @text('client_request_id') clientRequestId!: string

  @children('photos') photos!: Photo[]

  @writer async addPhoto(localPath: string, fileName: string, contentType: string, size: number) {
    const newPhoto = await this.collections.get<Photo>('photos').create(photo => {
      photo.incident.set(this)
      photo.localPath = localPath
      photo.fileName = fileName
      photo.contentType = contentType
      photo.sizeBytes = size
      photo.isSynced = false
      photo.localSyncStatus = 'pending'
      photo.syncAttempts = 0
      photo.clientRequestId = ''
      photo.localId = ''
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
        incident.lastSyncError = error ?? null
      } else if (status === 'synced') {
        incident.isSynced = true
        incident.lastSyncError = null
      }
    })
  }
}
