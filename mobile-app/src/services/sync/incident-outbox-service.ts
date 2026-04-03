/**
 * incident-outbox-service.ts
 * Handles the local-first lifecycle for incident creation.
 *
 * Flow:
 *   1. Generate localId + clientRequestId
 *   2. Persist incident locally (sync_status = 'pending')
 *   3. Enqueue a sync_job for 'create_incident'
 *   4. Register the executor on the sync engine (idempotent)
 */

import { incidentsRepository, type CreateLocalIncidentParams } from '../../db/repositories/incidents-repository'
import { casesRepository } from '../../db/repositories/cases-repository'
import { syncJobsRepository } from '../../db/repositories/sync-jobs-repository'
import { registerExecutor } from './sync-engine'
import { incidentToApiPayload } from './sync-mappers'
import { createIncident } from '../../api/incidents'
import { SyncEngineError } from './sync-errors'
import type SyncJob from '../../db/models/SyncJob'
import type { GpsCapturePayload } from '../../types/api'

type IncidentInput = {
  installationId: number
  remoteInstallationId?: number | null
  localCaseLocalId?: string | null
  dependsOnJobId?: string | null
  note: string
  reporterUsername: string
  timeAdjustmentSeconds?: number
  severity?: string
  source?: string
  gps: GpsCapturePayload
}

export type EnqueueResult = {
  localId: string
  jobId: string
}

/**
 * Generate a UUID-like ID suitable for React Native without relying on
 * external crypto packages. Uses Math.random() — sufficient for client IDs.
 */
function generateId(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

/**
 * Persist a new incident locally and enqueue a sync job.
 * Returns immediately — does not wait for the API call.
 */
export async function enqueueCreateIncident(input: IncidentInput): Promise<EnqueueResult> {
  const localId = generateId()
  const clientRequestId = generateId()

  const params: CreateLocalIncidentParams = {
    localId,
    installationId: input.installationId,
    remoteInstallationId: input.remoteInstallationId ?? input.installationId,
    localCaseLocalId: input.localCaseLocalId ?? null,
    reporterUsername: input.reporterUsername,
    note: input.note,
    timeAdjustmentSeconds: input.timeAdjustmentSeconds ?? 0,
    severity: input.severity ?? 'medium',
    source: input.source ?? 'mobile',
    clientRequestId,
    gps: input.gps,
  }

  // 1. Persist locally
  await incidentsRepository.createLocalIncident(params)

  // 2. Enqueue job
  const job = await syncJobsRepository.createJob({
    entityType: 'incident',
    entityLocalId: localId,
    operation: 'create_incident',
    dependsOnJobId: input.dependsOnJobId ?? undefined,
    priority: 10,
  })

  return { localId, jobId: job.id }
}

/**
 * Executor: called by the sync engine when processing a create_incident job.
 * Reads the local incident, calls the API, persists the remote ID.
 */
export async function executeCreateIncident(job: SyncJob): Promise<void> {
  const incident = await incidentsRepository.getByLocalId(job.entityLocalId)

  if (!incident) {
    throw new SyncEngineError(
      `Incident local ${job.entityLocalId} not found. Cannot sync.`,
      'terminal',
    )
  }

  // Skip if already synced (double-run guard)
  if (incident.localSyncStatus === 'synced' && incident.remoteId) return

  let remoteInstallationId = incident.remoteInstallationId ?? incident.installationId
  if ((!Number.isInteger(remoteInstallationId) || remoteInstallationId <= 0) && incident.localCaseLocalId) {
    const localCase = await casesRepository.getByLocalId(incident.localCaseLocalId)
    remoteInstallationId = Number(localCase?.remoteId || 0)
  }
  if (!Number.isInteger(remoteInstallationId) || remoteInstallationId <= 0) {
    throw new SyncEngineError(
      `Remote installation missing for queued incident ${job.entityLocalId}.`,
      'transient',
    )
  }

  await incidentsRepository.updateSyncStatus(job.entityLocalId, 'syncing')

  const payload = await incidentToApiPayload(incident)
  const response = await createIncident(remoteInstallationId, payload)

  const remoteId = response.incident.id
  if (!remoteId) {
    throw new SyncEngineError('API returned incident without id', 'terminal')
  }

  await incidentsRepository.updateRemoteId(job.entityLocalId, remoteId)
}

let executorRegistered = false

/**
 * Register the create_incident executor on the sync engine.
 * Call this once at app bootstrap (safe to call multiple times).
 */
export function registerIncidentExecutors(): void {
  if (executorRegistered) return
  executorRegistered = true
  registerExecutor('create_incident', executeCreateIncident)
}
