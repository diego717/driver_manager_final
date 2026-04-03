import { database } from '../index'
import Photo from '../models/Photo'
import {
  clearStoredPhotoSecret,
  getStoredPhotoSecret,
  redactStoredSensitiveValue,
  setStoredPhotoSecret,
} from '../../storage/secure'
import { sanitizeStoredSyncMessage } from '../../services/sync/sync-errors'
import { incidentsRepository } from './incidents-repository'

export interface CreatePendingPhotoUploadParams {
  localId: string
  clientRequestId: string
  localPath: string
  fileName: string
  contentType: string
  sizeBytes: number
  remoteIncidentId?: number | null
  localIncidentLocalId?: string | null
  incidentRecordId?: string | null
}

/**
 * Repository for the photos table.
 * Stub for phase 2 (evidence & photos offline).
 */
export const photosRepository = {
  async createPendingUpload(params: CreatePendingPhotoUploadParams): Promise<Photo> {
    await setStoredPhotoSecret(params.localId, {
      localPath: params.localPath,
      fileName: params.fileName,
    })

    const incidentRecordId = String(
      params.incidentRecordId ||
      (params.localIncidentLocalId ? `local:${params.localIncidentLocalId}` : `remote:${params.remoteIncidentId || 'unknown'}`),
    )

    return database.write(() =>
      database.get<Photo>('photos').create(photo => {
        photo.incidentRecordId = incidentRecordId
        photo.r2Key = null
        photo.localPath = redactStoredSensitiveValue()
        photo.fileName = redactStoredSensitiveValue()
        photo.contentType = params.contentType
        photo.sizeBytes = params.sizeBytes
        photo.sha256 = null
        photo.isSynced = false
        photo.remoteId = null
        photo.localId = params.localId
        photo.remotePhotoId = null
        photo.remoteIncidentId = params.remoteIncidentId ?? null
        photo.localIncidentLocalId = params.localIncidentLocalId ?? null
        photo.localSyncStatus = 'pending'
        photo.syncAttempts = 0
        photo.lastSyncError = null
        photo.clientRequestId = params.clientRequestId
      })
    )
  },

  async getByLocalId(localId: string): Promise<Photo | null> {
    const all = await database.get<Photo>('photos').query().fetch()
    return all.find(p => p.localId === localId) ?? null
  },

  async getPendingPhotos(): Promise<Photo[]> {
    const all = await database.get<Photo>('photos').query().fetch()
    return all.filter(p => p.localSyncStatus === 'pending' || p.localSyncStatus === 'failed')
  },

  async updateRemoteId(localId: string, remoteId: number, r2Key: string, sha256: string): Promise<void> {
    const photo = await photosRepository.getByLocalId(localId)
    if (!photo) return
    await database.write(() =>
      photo.update(p => {
        p.remotePhotoId = remoteId
        p.remoteId = remoteId
        p.r2Key = r2Key
        p.sha256 = sha256
        p.isSynced = true
        p.localSyncStatus = 'synced'
        p.lastSyncError = null
      })
    )
    await clearStoredPhotoSecret(localId)
  },

  async updateSyncStatus(localId: string, status: Photo['localSyncStatus'], error?: string): Promise<void> {
    const photo = await photosRepository.getByLocalId(localId)
    if (!photo) return
    await database.write(() =>
      photo.update(p => {
        p.localSyncStatus = status
        if (status === 'failed') {
          p.syncAttempts = p.syncAttempts + 1
          p.lastSyncError = sanitizeStoredSyncMessage(error)
        } else if (status === 'synced') {
          p.isSynced = true
          p.lastSyncError = null
        }
      })
    )
  },

  async resolveSensitiveFields(photo: Pick<Photo, 'localId' | 'localPath' | 'fileName'>) {
    const secret = await getStoredPhotoSecret(photo.localId)

    return {
      localPath: photo.localPath === redactStoredSensitiveValue()
        ? secret?.localPath ?? ''
        : photo.localPath,
      fileName: photo.fileName === redactStoredSensitiveValue()
        ? secret?.fileName ?? ''
        : photo.fileName,
    }
  },

  async resolveRemoteIncidentId(
    photo: Pick<Photo, 'remoteIncidentId' | 'localIncidentLocalId'>,
  ): Promise<number | null> {
    if (Number.isInteger(photo.remoteIncidentId) && Number(photo.remoteIncidentId) > 0) {
      return Number(photo.remoteIncidentId)
    }

    const localIncidentLocalId = String(photo.localIncidentLocalId || '').trim()
    if (!localIncidentLocalId) return null

    const incident = await incidentsRepository.getByLocalId(localIncidentLocalId)
    if (!incident || !Number.isInteger(incident.remoteId) || Number(incident.remoteId) <= 0) {
      return null
    }

    return Number(incident.remoteId)
  },
}
