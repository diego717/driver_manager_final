/**
 * sync-engine.ts
 * Core orchestrator: reads pending jobs and runs them via registered executors.
 * Sequential execution - only one flush runs at a time (re-entrancy guard).
 */

import type { LocalSyncStatus } from "../../db/models/Incident";
import type SyncJob from "../../db/models/SyncJob";
import type { SyncJobOperation } from "../../db/models/SyncJob";
import { casesRepository } from "../../db/repositories/cases-repository";
import { incidentsRepository } from "../../db/repositories/incidents-repository";
import { photosRepository } from "../../db/repositories/photos-repository";
import { syncJobsRepository } from "../../db/repositories/sync-jobs-repository";
import { classifyError } from "./sync-errors";
import { MAX_SYNC_ATTEMPTS, nextRetryAt } from "./sync-policy";
import { syncStateStore } from "./sync-state-store";

export type SyncJobExecutor = (job: SyncJob) => Promise<void>;

const executors = new Map<SyncJobOperation, SyncJobExecutor>();

let running = false;

async function updateEntitySyncStatus(
  job: SyncJob,
  status: Extract<LocalSyncStatus, "pending" | "failed">,
  error?: string,
): Promise<void> {
  switch (job.operation) {
    case "create_case":
      await casesRepository.updateSyncStatus(job.entityLocalId, status, error);
      return;
    case "create_incident":
      await incidentsRepository.updateSyncStatus(job.entityLocalId, status, error);
      return;
    case "upload_photo":
      await photosRepository.updateSyncStatus(job.entityLocalId, status, error);
      return;
    case "update_incident_evidence":
    default:
      return;
  }
}

/**
 * Register an executor for a given operation type.
 * Call this at app bootstrap (before any flush).
 */
export function registerExecutor(operation: SyncJobOperation, executor: SyncJobExecutor): void {
  executors.set(operation, executor);
}

/**
 * Run all eligible pending jobs once, in priority order.
 * Does nothing if already running.
 */
export async function flush(options?: { force?: boolean }): Promise<void> {
  if (running) return;
  running = true;
  syncStateStore.setSyncing(true);

  try {
    const now = Date.now();
    const jobs = await syncJobsRepository.getPendingJobs(now, options);

    for (const job of jobs) {
      const depResolved = await syncJobsRepository.isDependencyResolved(job.dependsOnJobId);
      if (!depResolved) continue;

      const executor = executors.get(job.operation);
      if (!executor) continue;

      await syncJobsRepository.markSyncing(job.id);

      try {
        await executor(job);
        await syncJobsRepository.markSynced(job.id);
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        const classification = classifyError(err);

        if (classification.kind === "terminal") {
          const failureMessage = `[terminal] ${errorMsg}`;
          await syncJobsRepository.markFailed(job.id, failureMessage);
          await updateEntitySyncStatus(job, "failed", failureMessage);
          continue;
        }

        if (classification.kind === "auth") {
          const failureMessage = `[auth] ${errorMsg}`;
          await syncJobsRepository.markFailed(job.id, failureMessage);
          await updateEntitySyncStatus(job, "failed", failureMessage);
          syncStateStore.setError(
            "Sesion expirada. Inicia sesion para continuar la sincronizacion.",
          );
          return;
        }

        const nextAttemptCount = job.attemptCount + 1;
        if (nextAttemptCount >= MAX_SYNC_ATTEMPTS) {
          const failureMessage = `[max_attempts] Superado el limite de reintentos. Ultimo error: ${errorMsg}`;
          await syncJobsRepository.markFailed(job.id, failureMessage);
          await updateEntitySyncStatus(job, "failed", failureMessage);
          continue;
        }

        const retryAt = nextRetryAt(nextAttemptCount, Date.now());
        await syncJobsRepository.scheduleRetry(job.id, retryAt);
        await updateEntitySyncStatus(job, "pending", `[retry] ${errorMsg}`);
      }
    }

    const pending = await syncJobsRepository.getTotalPendingCount();
    syncStateStore.setPendingCount(pending);
    syncStateStore.setLastSync(Date.now(), null);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    syncStateStore.setError(msg);
  } finally {
    running = false;
  }
}

/** Expose for testing */
export function isRunning(): boolean {
  return running;
}
