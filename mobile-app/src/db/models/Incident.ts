import { Model } from '@nozbe/watermelondb'
import { field, text, readonly, date, children, writer } from '@nozbe/watermelondb/decorators'
import { Associations } from '@nozbe/watermelondb/Model'
import Photo from './Photo'

export default class Incident extends Model {
  static table = 'incidents'

  static associations: Associations = {
    photos: { type: 'has_many', foreignKey: 'incident_id' },
  }

  @field('installation_id') installationId!: number
  @field('reporter_username') reporterUsername!: string
  @text('note') note!: string
  @field('time_adjustment_seconds') timeAdjustmentSeconds!: number
  @field('severity') severity!: string
  @field('source') source!: string
  @readonly @date('created_at') createdAt!: Date
  
  @field('is_synced') isSynced!: boolean
  @field('remote_id') remoteId!: number | null

  @children('photos') photos!: Photo[]

  @writer async addPhoto(localPath: string, fileName: string, contentType: string, size: number) {
    const newPhoto = await this.collections.get<Photo>('photos').create(photo => {
      photo.incident.set(this)
      photo.localPath = localPath
      photo.fileName = fileName
      photo.contentType = contentType
      photo.sizeBytes = size
      photo.isSynced = false
    })
    return newPhoto
  }

  @writer async markAsSynced(remoteId: number) {
    await this.update(incident => {
      incident.isSynced = true
      incident.remoteId = remoteId
    })
  }
}
