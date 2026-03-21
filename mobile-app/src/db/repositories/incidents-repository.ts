import { database } from '../index'
import Incident from '../models/Incident'
import type { LocalSyncStatus } from '../models/Incident'

export interface CreateLocalIncidentParams {
  localId: string
  installationId: number
  remoteInstallationId: number
  reporterUsername: string
  note: string
  timeAdjustmentSeconds: number
  severity: string
  source: string
  clientRequestId: string
}

/**
 * Repository for the incidents table.
 * Handles local-first CRUD with sync metadata.
 */
export const incidentsRepository = {
  async createLocalIncident(params: CreateLocalIncidentParams): Promise<Incident> {
    return database.write(() =>
      database.get<Incident>('incidents').create(incident => {
        incident.localId = params.localId
        incident.installationId = params.installationId
        incident.remoteInstallationId = params.remoteInstallationId
        incident.reporterUsername = params.reporterUsername
        incident.note = params.note
        incident.timeAdjustmentSeconds = params.timeAdjustmentSeconds
        incident.severity = params.severity
        incident.source = params.source
        incident.clientRequestId = params.clientRequestId
        incident.localSyncStatus = 'pending'
        incident.syncAttempts = 0
        incident.lastSyncError = null
        incident.isSynced = false
        incident.remoteId = null
      })
    )
  },

  async getByLocalId(localId: string): Promise<Incident | null> {
    const all = await database.get<Incident>('incidents').query().fetch()
    return all.find(i => i.localId === localId) ?? null
  },

  async updateRemoteId(localId: string, remoteId: number): Promise<void> {
    const incident = await incidentsRepository.getByLocalId(localId)
    if (!incident) return
    await database.write(() =>
      incident.update(i => {
        i.remoteId = remoteId
        i.isSynced = true
        i.localSyncStatus = 'synced'
        i.lastSyncError = null
      })
    )
  },

  async updateSyncStatus(localId: string, status: LocalSyncStatus, error?: string): Promise<void> {
    const incident = await incidentsRepository.getByLocalId(localId)
    if (!incident) return
    await database.write(() =>
      incident.update(i => {
        i.localSyncStatus = status
        if (status === 'failed') {
          i.syncAttempts = i.syncAttempts + 1
          i.lastSyncError = error ?? null
        } else if (status === 'synced') {
          i.isSynced = true
          i.lastSyncError = null
        }
      })
    )
  },

  async getPendingIncidents(): Promise<Incident[]> {
    const all = await database.get<Incident>('incidents').query().fetch()
    return all.filter(i => i.localSyncStatus === 'pending' || i.localSyncStatus === 'failed')
  },
}
