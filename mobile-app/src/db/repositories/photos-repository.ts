import { database } from '../index'
import Photo from '../models/Photo'

/**
 * Repository for the photos table.
 * Stub for phase 2 (evidence & photos offline).
 */
export const photosRepository = {
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
  },
}
