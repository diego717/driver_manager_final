import { database } from '../index'
import LocalCase from '../models/LocalCase'
import {
  getStoredCaseSecret,
  redactStoredSensitiveValue,
  setStoredCaseSecret,
} from '../../storage/secure'
import { sanitizeStoredSyncMessage } from '../../services/sync/sync-errors'

export interface CreateLocalCaseParams {
  localId: string
  remoteId?: number | null
  clientName: string
  notes: string
  clientRequestId: string
  syncStatus?: LocalCase['localSyncStatus']
}

/**
 * Repository for cases_local table.
 * Stub for phase 3 (offline manual cases).
 */
export const casesRepository = {
  async createLocalCase(params: CreateLocalCaseParams): Promise<LocalCase> {
    await setStoredCaseSecret(params.localId, {
      clientName: params.clientName,
      notes: params.notes,
    })

    return database.write(() =>
      database.get<LocalCase>('cases_local').create(localCase => {
        localCase.localId = params.localId
        localCase.remoteId = params.remoteId ?? null
        localCase.clientName = redactStoredSensitiveValue()
        localCase.notes = redactStoredSensitiveValue()
        localCase.localSyncStatus = params.syncStatus ?? 'pending'
        localCase.syncAttempts = 0
        localCase.lastSyncError = null
        localCase.clientRequestId = params.clientRequestId
        localCase.updatedAt = Date.now()
      })
    )
  },

  async getByLocalId(localId: string): Promise<LocalCase | null> {
    const all = await database.get<LocalCase>('cases_local').query().fetch()
    return all.find(c => c.localId === localId) ?? null
  },

  async getPendingCases(): Promise<LocalCase[]> {
    const all = await database.get<LocalCase>('cases_local').query().fetch()
    return all.filter(c => c.localSyncStatus === 'pending' || c.localSyncStatus === 'failed')
  },

  async updateRemoteId(localId: string, remoteId: number): Promise<void> {
    const localCase = await casesRepository.getByLocalId(localId)
    if (!localCase) return
    await database.write(() =>
      localCase.update(item => {
        item.remoteId = remoteId
        item.localSyncStatus = 'synced'
        item.lastSyncError = null
      })
    )
  },

  async updateSyncStatus(localId: string, status: LocalCase['localSyncStatus'], error?: string): Promise<void> {
    const localCase = await casesRepository.getByLocalId(localId)
    if (!localCase) return
    await database.write(() =>
      localCase.update(item => {
        item.localSyncStatus = status
        if (status === 'failed') {
          item.syncAttempts = item.syncAttempts + 1
          item.lastSyncError = sanitizeStoredSyncMessage(error)
        } else if (status === 'synced') {
          item.lastSyncError = null
        }
      })
    )
  },

  async resolveSensitiveFields(localCase: Pick<LocalCase, 'localId' | 'clientName' | 'notes'>) {
    const secret = await getStoredCaseSecret(localCase.localId)

    return {
      clientName: localCase.clientName === redactStoredSensitiveValue()
        ? secret?.clientName ?? ''
        : localCase.clientName,
      notes: localCase.notes === redactStoredSensitiveValue()
        ? secret?.notes ?? ''
        : localCase.notes,
    }
  },

  sanitizeStoredError(error: string | null | undefined): string | null {
    return sanitizeStoredSyncMessage(error)
  },
}
