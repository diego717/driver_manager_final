import { Model } from '@nozbe/watermelondb'
import { field, text, readonly, date, writer } from '@nozbe/watermelondb/decorators'
import type { LocalSyncStatus } from './Incident'
import { sanitizeStoredSyncMessage } from '../../services/sync/sync-errors'

export type SyncJobOperation =
  | 'create_incident'
  | 'update_incident_evidence'
  | 'upload_photo'
  | 'create_case'

export type SyncJobEntityType = 'case' | 'incident' | 'incident_evidence' | 'photo' | 'asset_link'

export default class SyncJob extends Model {
  static table = 'sync_jobs'

  @text('entity_type') entityType!: SyncJobEntityType
  @text('entity_local_id') entityLocalId!: string
  @text('operation') operation!: SyncJobOperation
  @text('depends_on_job_id') dependsOnJobId!: string | null
  // Prefixed to avoid WMDb base class 'syncStatus' accessor conflict
  @text('status') jobStatus!: LocalSyncStatus
  @field('attempt_count') attemptCount!: number
  @field('next_retry_at') nextRetryAt!: number
  @text('last_error') lastError!: string | null
  @field('priority') priority!: number
  @readonly @date('created_at') createdAt!: Date
  @field('updated_at') updatedAt!: number

  @writer async markSyncing() {
    await this.update(job => {
      job.jobStatus = 'syncing'
      job.updatedAt = Date.now()
    })
  }

  @writer async markSynced() {
    await this.update(job => {
      job.jobStatus = 'synced'
      job.lastError = null
      job.updatedAt = Date.now()
    })
  }

  @writer async markFailed(error: string) {
    await this.update(job => {
      job.jobStatus = 'failed'
      job.attemptCount = job.attemptCount + 1
      job.lastError = sanitizeStoredSyncMessage(error)
      job.updatedAt = Date.now()
    })
  }

  @writer async scheduleRetry(nextRetryAt: number) {
    await this.update(job => {
      job.jobStatus = 'pending'
      job.attemptCount = job.attemptCount + 1
      job.nextRetryAt = nextRetryAt
      job.updatedAt = Date.now()
    })
  }
}
