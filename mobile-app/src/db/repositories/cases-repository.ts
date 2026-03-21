import { database } from '../index'
import LocalCase from '../models/LocalCase'

/**
 * Repository for cases_local table.
 * Stub for phase 3 (offline manual cases).
 */
export const casesRepository = {
  async getByLocalId(localId: string): Promise<LocalCase | null> {
    const all = await database.get<LocalCase>('cases_local').query().fetch()
    return all.find(c => c.localId === localId) ?? null
  },

  async getPendingCases(): Promise<LocalCase[]> {
    const all = await database.get<LocalCase>('cases_local').query().fetch()
    return all.filter(c => c.localSyncStatus === 'pending' || c.localSyncStatus === 'failed')
  },
}
