import { uploadIncidentPhoto } from '../../api/photos'
import { photosRepository, type CreatePendingPhotoUploadParams } from '../../db/repositories/photos-repository'
import { syncJobsRepository } from '../../db/repositories/sync-jobs-repository'
import type SyncJob from '../../db/models/SyncJob'
import { registerExecutor } from './sync-engine'
import { SyncEngineError } from './sync-errors'

type UploadPhotoInput = {
  remoteIncidentId?: number | null
  localIncidentLocalId?: string | null
  dependsOnJobId?: string | null
  localPath: string
  fileName: string
  contentType: string
  sizeBytes: number
  incidentRecordId?: string | null
}

export type EnqueuePhotoUploadResult = {
  localId: string
  jobId: string
}

function generateId(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

export async function enqueueUploadIncidentPhoto(
  input: UploadPhotoInput,
): Promise<EnqueuePhotoUploadResult> {
  const localId = generateId()
  const clientRequestId = generateId()

  const params: CreatePendingPhotoUploadParams = {
    localId,
    clientRequestId,
    localPath: input.localPath,
    fileName: input.fileName,
    contentType: input.contentType,
    sizeBytes: input.sizeBytes,
    remoteIncidentId: input.remoteIncidentId ?? null,
    localIncidentLocalId: input.localIncidentLocalId ?? null,
    incidentRecordId: input.incidentRecordId ?? null,
  }

  await photosRepository.createPendingUpload(params)

  const job = await syncJobsRepository.createJob({
    entityType: 'photo',
    entityLocalId: localId,
    operation: 'upload_photo',
    dependsOnJobId: input.dependsOnJobId ?? undefined,
    priority: 20,
  })

  return {
    localId,
    jobId: job.id,
  }
}

export async function executeUploadPhoto(job: SyncJob): Promise<void> {
  const photo = await photosRepository.getByLocalId(job.entityLocalId)
  if (!photo) {
    throw new SyncEngineError(`Photo local ${job.entityLocalId} not found. Cannot sync.`, 'terminal')
  }

  if (photo.localSyncStatus === 'synced' && photo.remotePhotoId) return

  await photosRepository.updateSyncStatus(job.entityLocalId, 'syncing')

  const sensitive = await photosRepository.resolveSensitiveFields(photo)
  const remoteIncidentId = await photosRepository.resolveRemoteIncidentId(photo)

  if (!remoteIncidentId) {
    throw new SyncEngineError(
      `Remote incident missing for queued photo ${job.entityLocalId}.`,
      'transient',
    )
  }
  if (!sensitive.localPath.trim()) {
    throw new SyncEngineError(
      `Local file missing for queued photo ${job.entityLocalId}.`,
      'terminal',
    )
  }

  const response = await uploadIncidentPhoto({
    incidentId: remoteIncidentId,
    fileUri: sensitive.localPath,
    fileName: sensitive.fileName || undefined,
    contentType: photo.contentType || undefined,
  })

  const remotePhotoId = Number(response.photo?.id || 0)
  if (!Number.isInteger(remotePhotoId) || remotePhotoId <= 0) {
    throw new SyncEngineError('API returned photo without id', 'terminal')
  }

  await photosRepository.updateRemoteId(
    job.entityLocalId,
    remotePhotoId,
    String(response.photo?.r2_key || ''),
    String(response.photo?.sha256 || ''),
  )
}

let executorRegistered = false

export function registerPhotoExecutors(): void {
  if (executorRegistered) return
  executorRegistered = true
  registerExecutor('upload_photo', executeUploadPhoto)
}
