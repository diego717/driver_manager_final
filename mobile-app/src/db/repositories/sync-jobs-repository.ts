import { database } from '../index'
import SyncJob, { type SyncJobOperation, type SyncJobEntityType } from '../models/SyncJob'
import type { LocalSyncStatus } from '../models/Incident'

export interface CreateSyncJobParams {
  entityType: SyncJobEntityType
  entityLocalId: string
  operation: SyncJobOperation
  dependsOnJobId?: string
  priority?: number
}

/**
 * Repository for sync_jobs table.
 * All writes go through database.write() for atomicity.
 */
export const syncJobsRepository = {
  async createJob(params: CreateSyncJobParams): Promise<SyncJob> {
    return database.write(() =>
      database.get<SyncJob>('sync_jobs').create(job => {
        job.entityType = params.entityType
        job.entityLocalId = params.entityLocalId
        job.operation = params.operation
        job.dependsOnJobId = params.dependsOnJobId ?? null
        job.jobStatus = 'pending'
        job.attemptCount = 0
        job.nextRetryAt = 0
        job.lastError = null
        job.priority = params.priority ?? 10
        job.updatedAt = Date.now()
      })
    )
  },

  /**
   * Returns jobs that are ready to run:
   * - pending status
   * - nextRetryAt <= now (0 means run immediately)
   * Sorted by priority ASC then creation date ASC.
   */
  async getPendingJobs(
    now: number = Date.now(),
    options?: { force?: boolean },
  ): Promise<SyncJob[]> {
    const all = await database
      .get<SyncJob>('sync_jobs')
      .query()
      .fetch()

    return all
      .filter(job =>
        job.jobStatus === 'pending' &&
        (options?.force ? true : job.nextRetryAt <= now)
      )
      .sort((a, b) => {
        if (a.priority !== b.priority) return a.priority - b.priority
        return a.createdAt.getTime() - b.createdAt.getTime()
      })
  },

  async getJobById(id: string): Promise<SyncJob | null> {
    try {
      return await database.get<SyncJob>('sync_jobs').find(id)
    } catch {
      return null
    }
  },

  async getTotalPendingCount(): Promise<number> {
    const all = await database.get<SyncJob>('sync_jobs').query().fetch()
    return all.filter(j => j.jobStatus === 'pending' || j.jobStatus === 'syncing').length
  },

  async markSyncing(id: string): Promise<void> {
    const job = await database.get<SyncJob>('sync_jobs').find(id)
    await job.markSyncing()
  },

  async markSynced(id: string): Promise<void> {
    const job = await database.get<SyncJob>('sync_jobs').find(id)
    await job.markSynced()
  },

  async markFailed(id: string, error: string): Promise<void> {
    const job = await database.get<SyncJob>('sync_jobs').find(id)
    await job.markFailed(error)
  },

  async scheduleRetry(id: string, nextRetryAt: number): Promise<void> {
    const job = await database.get<SyncJob>('sync_jobs').find(id)
    await job.scheduleRetry(nextRetryAt)
  },

  /** Returns true if the parent job is already synced (or there is no dependency) */
  async isDependencyResolved(dependsOnJobId: string | null): Promise<boolean> {
    if (!dependsOnJobId) return true
    const parent = await syncJobsRepository.getJobById(dependsOnJobId)
    return parent?.jobStatus === 'synced'
  },
}
