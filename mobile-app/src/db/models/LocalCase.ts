import { Model } from '@nozbe/watermelondb'
import { field, text, readonly, date } from '@nozbe/watermelondb/decorators'
import type { LocalSyncStatus } from './Incident'

/**
 * LocalCase — stub model for phase 3 (offline manual case).
 * Not used in phase 1/2, but the table exists in the schema
 * so the DB is ready when we implement case-outbox-service.
 */
export default class LocalCase extends Model {
  static table = 'cases_local'

  @text('local_id') localId!: string
  @field('remote_id') remoteId!: number | null
  @text('client_name') clientName!: string
  @text('notes') notes!: string
  // Prefixed to avoid WMDb base class conflict
  @text('sync_status') localSyncStatus!: LocalSyncStatus
  @field('sync_attempts') syncAttempts!: number
  @text('last_sync_error') lastSyncError!: string | null
  @text('client_request_id') clientRequestId!: string
  @readonly @date('created_at') createdAt!: Date
  @field('updated_at') updatedAt!: number
}
