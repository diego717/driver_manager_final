import { updateIncidentEvidence } from '../../api/incidents'
import { syncJobsRepository } from '../../db/repositories/sync-jobs-repository'
import type SyncJob from '../../db/models/SyncJob'
import {
  clearStoredIncidentEvidenceSecret,
  getStoredIncidentEvidenceSecret,
  setStoredIncidentEvidenceSecret,
} from '../../storage/secure'
import { registerExecutor } from './sync-engine'
import { SyncEngineError } from './sync-errors'

type IncidentEvidenceInput = {
  remoteIncidentId?: number | null
  localIncidentLocalId?: string | null
  checklistItems: string[]
  evidenceNote?: string | null
  dependsOnJobId?: string | null
}

export type EnqueueIncidentEvidenceResult = {
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

export async function enqueueUpdateIncidentEvidence(
  input: IncidentEvidenceInput,
): Promise<EnqueueIncidentEvidenceResult> {
  const localId = generateId()

  await setStoredIncidentEvidenceSecret(localId, {
    checklistItems: input.checklistItems,
    evidenceNote: input.evidenceNote ?? null,
    remoteIncidentId: input.remoteIncidentId ?? null,
    localIncidentLocalId: input.localIncidentLocalId ?? null,
  })

  const job = await syncJobsRepository.createJob({
    entityType: 'incident_evidence',
    entityLocalId: localId,
    operation: 'update_incident_evidence',
    dependsOnJobId: input.dependsOnJobId ?? undefined,
    priority: 15,
  })

  return {
    localId,
    jobId: job.id,
  }
}

export async function executeUpdateIncidentEvidence(job: SyncJob): Promise<void> {
  const payload = await getStoredIncidentEvidenceSecret(job.entityLocalId)
  if (!payload) {
    throw new SyncEngineError(
      `Incident evidence payload ${job.entityLocalId} not found. Cannot sync.`,
      'terminal',
    )
  }

  const remoteIncidentId = Number(payload.remoteIncidentId)
  if (!Number.isInteger(remoteIncidentId) || remoteIncidentId <= 0) {
    throw new SyncEngineError(
      `Remote incident missing for queued evidence ${job.entityLocalId}.`,
      'transient',
    )
  }

  await updateIncidentEvidence(remoteIncidentId, {
    checklist_items: payload.checklistItems,
    evidence_note: payload.evidenceNote ?? null,
  })

  await clearStoredIncidentEvidenceSecret(job.entityLocalId)
}

let executorRegistered = false

export function registerIncidentEvidenceExecutors(): void {
  if (executorRegistered) return
  executorRegistered = true
  registerExecutor('update_incident_evidence', executeUpdateIncidentEvidence)
}
