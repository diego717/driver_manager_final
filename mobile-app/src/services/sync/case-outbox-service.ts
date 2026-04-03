import { createInstallationRecord } from '../../api/incidents'
import { casesRepository } from '../../db/repositories/cases-repository'
import { syncJobsRepository } from '../../db/repositories/sync-jobs-repository'
import type SyncJob from '../../db/models/SyncJob'
import type { CreateRecordInput } from '../../types/api'
import { registerExecutor } from './sync-engine'
import { SyncEngineError } from './sync-errors'

type CaseInput = {
  clientName: string
  notes: string
  status?: string
  driverBrand?: string
  driverVersion?: string
  driverDescription?: string
  osInfo?: string
  installationTimeSeconds?: number
}

export type EnqueueCaseResult = {
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

function buildCasePayload(input: CaseInput): CreateRecordInput {
  return {
    client_name: input.clientName.trim() || 'Sin cliente',
    notes: input.notes.trim(),
    status: input.status ?? 'manual',
    driver_brand: input.driverBrand ?? 'Caso manual',
    driver_version: input.driverVersion ?? 'Sin equipo',
    driver_description: input.driverDescription ?? 'Caso iniciado desde mobile sin equipo asociado',
    os_info: input.osInfo ?? 'mobile',
    installation_time_seconds: input.installationTimeSeconds ?? 0,
  }
}

export async function enqueueCreateCase(input: CaseInput): Promise<EnqueueCaseResult> {
  const localId = generateId()
  const clientRequestId = generateId()

  await casesRepository.createLocalCase({
    localId,
    clientName: input.clientName,
    notes: input.notes,
    clientRequestId,
  })

  const job = await syncJobsRepository.createJob({
    entityType: 'case',
    entityLocalId: localId,
    operation: 'create_case',
    priority: 5,
  })

  return {
    localId,
    jobId: job.id,
  }
}

export async function executeCreateCase(job: SyncJob): Promise<void> {
  const localCase = await casesRepository.getByLocalId(job.entityLocalId)
  if (!localCase) {
    throw new SyncEngineError(`Case local ${job.entityLocalId} not found. Cannot sync.`, 'terminal')
  }

  if (localCase.localSyncStatus === 'synced' && localCase.remoteId) return

  await casesRepository.updateSyncStatus(job.entityLocalId, 'syncing')

  const sensitive = await casesRepository.resolveSensitiveFields(localCase)
  const payload = buildCasePayload({
    clientName: sensitive.clientName,
    notes: sensitive.notes,
  })
  const response = await createInstallationRecord(payload)

  const remoteId = Number(response.record?.id || 0)
  if (!Number.isInteger(remoteId) || remoteId <= 0) {
    throw new SyncEngineError('API returned case without id', 'terminal')
  }

  await casesRepository.updateRemoteId(job.entityLocalId, remoteId)
}

let executorRegistered = false

export function registerCaseExecutors(): void {
  if (executorRegistered) return
  executorRegistered = true
  registerExecutor('create_case', executeCreateCase)
}
