/**
 * sync-runner.ts
 * Public entry point for triggering a sync flush.
 * Checks session state before calling the engine.
 */

import { flush } from './sync-engine'
import { syncJobsRepository } from '../../db/repositories/sync-jobs-repository'
import { syncStateStore } from './sync-state-store'
import { getStoredWebAccessExpiresAt, getStoredWebAccessToken } from '../../storage/secure'
import { resolveWebSession } from '../../api/webSession'

/**
 * Trigger a sync flush if there is an active session.
 * Safe to call multiple times — the engine has an internal re-entrancy guard.
 * Non-blocking: does not await completion unless explicitly needed.
 */
export function runSync(options?: { force?: boolean }): void {
  void _runSync(options)
}

async function _runSync(options?: { force?: boolean }): Promise<void> {
  try {
    // Update pending count before starting so the UI is current
    const pending = await syncJobsRepository.getTotalPendingCount()
    syncStateStore.setPendingCount(pending)

    if (pending === 0) return

    const session = await resolveWebSession({
      getAccessToken: getStoredWebAccessToken,
      getExpiresAt: getStoredWebAccessExpiresAt,
    })
    if (session.state !== 'active') {
      syncStateStore.setError('Sesion web requerida. Inicia sesion para continuar la sincronizacion.')
      return
    }

    await flush(options)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    syncStateStore.setError(msg)
  }
}

/**
 * Await variant — use in tests or when you need to wait for completion.
 */
export async function runSyncAsync(options?: { force?: boolean }): Promise<void> {
  return _runSync(options)
}
