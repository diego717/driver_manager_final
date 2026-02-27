import { Model } from '@nozbe/watermelondb'
import { field, text, readonly, date, relation, writer } from '@nozbe/watermelondb/decorators'
import Incident from './Incident'

export default class Photo extends Model {
  static table = 'photos'

  @relation('incidents', 'incident_id') incident!: Incident
  @text('r2_key') r2Key!: string | null
  @text('file_name') fileName!: string
  @text('content_type') contentType!: string
  @field('size_bytes') sizeBytes!: number
  @text('sha256') sha256!: string | null
  @readonly @date('created_at') createdAt!: Date
  @field('captured_at') capturedAt!: number | null
  @field('latitude') latitude!: number | null
  @field('longitude') longitude!: number | null
  @field('accuracy_m') accuracyM!: number | null

  @field('is_synced') isSynced!: boolean
  @text('local_path') localPath!: string
  @field('remote_id') remoteId!: number | null

  @writer async markAsSynced(remoteId: number, r2Key: string, sha256: string) {
    await this.update(photo => {
      photo.isSynced = true
      photo.remoteId = remoteId
      photo.r2Key = r2Key
      photo.sha256 = sha256
    })
  }
}
