/**
 * sync-state-store.ts
 * Lightweight reactive store for sync UI state.
 * Uses a simple subscriber pattern — no Zustand dependency needed.
 */

export interface SyncState {
  isSyncing: boolean
  pendingCount: number
  lastSyncAt: number | null  // epoch ms
  lastError: string | null
}

type SyncStateListener = (state: SyncState) => void

let state: SyncState = {
  isSyncing: false,
  pendingCount: 0,
  lastSyncAt: null,
  lastError: null,
}

const listeners = new Set<SyncStateListener>()

function notify(): void {
  const snapshot = { ...state }
  for (const listener of listeners) {
    listener(snapshot)
  }
}

export const syncStateStore = {
  getState(): SyncState {
    return { ...state }
  },

  subscribe(listener: SyncStateListener): () => void {
    listeners.add(listener)
    listener({ ...state }) // emit current state immediately
    return () => {
      listeners.delete(listener)
    }
  },

  setSyncing(isSyncing: boolean): void {
    state = { ...state, isSyncing }
    notify()
  },

  setPendingCount(pendingCount: number): void {
    state = { ...state, pendingCount }
    notify()
  },

  setLastSync(lastSyncAt: number, lastError: string | null): void {
    state = { ...state, lastSyncAt, lastError, isSyncing: false }
    notify()
  },

  setError(lastError: string): void {
    state = { ...state, lastError, isSyncing: false }
    notify()
  },
}
