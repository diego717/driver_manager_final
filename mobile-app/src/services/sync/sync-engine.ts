/**
 * sync-engine.ts
 * Core orchestrator: reads pending jobs and runs them via registered executors.
 * Sequential execution — only one flush runs at a time (re-entrancy guard).
 */

import { syncJobsRepository } from '../../db/repositories/sync-jobs-repository'
import { syncStateStore } from './sync-state-store'
import { classifyError, isAuth } from './sync-errors'
import { nextRetryAt, MAX_SYNC_ATTEMPTS } from './sync-policy'
import type SyncJob from '../../db/models/SyncJob'
import type { SyncJobOperation } from '../../db/models/SyncJob'

export type SyncJobExecutor = (job: SyncJob) => Promise<void>

const executors = new Map<SyncJobOperation, SyncJobExecutor>()

let running = false

/**
 * Register an executor for a given operation type.
 * Call this at app bootstrap (before any flush).
 */
export function registerExecutor(operation: SyncJobOperation, executor: SyncJobExecutor): void {
  executors.set(operation, executor)
}

/**
 * Run all eligible pending jobs once, in priority order.
 * Does nothing if already running.
 */
export async function flush(options?: { force?: boolean }): Promise<void> {
  if (running) return
  running = true
  syncStateStore.setSyncing(true)

  try {
    const now = Date.now()
    const jobs = await syncJobsRepository.getPendingJobs(now, options)

    for (const job of jobs) {
      // Skip if dependency is not resolved yet
      const depResolved = await syncJobsRepository.isDependencyResolved(job.dependsOnJobId)
      if (!depResolved) continue

      const executor = executors.get(job.operation)
      if (!executor) {
        // No executor registered — skip silently
        continue
      }

      await syncJobsRepository.markSyncing(job.id)

      try {
        await executor(job)
        await syncJobsRepository.markSynced(job.id)
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err)
        const classification = classifyError(err)

        if (classification.kind === 'terminal') {
          await syncJobsRepository.markFailed(job.id, `[terminal] ${errorMsg}`)
          continue
        }

        if (classification.kind === 'auth') {
          await syncJobsRepository.markFailed(job.id, `[auth] ${errorMsg}`)
          syncStateStore.setError('Sesión expirada. Inicia sesión para continuar la sincronización.')
          return
        }

        // Transient — schedule retry with backoff
        const nextAttemptCount = job.attemptCount + 1
        if (nextAttemptCount >= MAX_SYNC_ATTEMPTS) {
          await syncJobsRepository.markFailed(
            job.id,
            `[max_attempts] Superado el límite de reintentos. Último error: ${errorMsg}`,
          )
          continue
        }

        const retryAt = nextRetryAt(nextAttemptCount, Date.now())
        await syncJobsRepository.scheduleRetry(job.id, retryAt)
      }
    }

    const pending = await syncJobsRepository.getTotalPendingCount()
    syncStateStore.setPendingCount(pending)
    syncStateStore.setLastSync(Date.now(), null)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    syncStateStore.setError(msg)
  } finally {
    running = false
  }
}

/** Expose for testing */
export function isRunning(): boolean {
  return running
}
