import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Tests for incident-outbox-service.ts
 * Mocks the DB layer and API client to test the outbox logic independently.
 */

// ─── Mock WatermelonDB before any imports touch it ───────────────────────────
vi.mock('@nozbe/watermelondb', () => ({}))
vi.mock('@nozbe/watermelondb/adapters/sqlite', () => ({}))

// ─── Mock the repository layer ───────────────────────────────────────────────
const mockCreatedIncident = vi.hoisted(() => ({
  id: 'local-1234',
  localId: 'local-1234',
  localSyncStatus: 'pending',
  remoteId: null,
  installationId: 42,
  remoteInstallationId: 42,
  clientRequestId: 'req-abc',
  note: 'Test incident',
  reporterUsername: 'ops',
  severity: 'medium',
  source: 'mobile',
  timeAdjustmentSeconds: 0,
  gpsCaptureStatus: 'captured',
  gpsCaptureSource: 'browser',
  gpsLat: -34.9011,
  gpsLng: -56.1645,
  gpsAccuracyM: 12,
  gpsCapturedAt: '2026-03-26T12:00:00.000Z',
  gpsCaptureNote: '',
}))

const mockCreatedJob = vi.hoisted(() => ({
  id: 'job-5678',
  jobStatus: 'pending',
  entityLocalId: 'local-1234',
  operation: 'create_incident',
  attemptCount: 0,
}))

const mockIncidentsRepo = vi.hoisted(() => ({
  createLocalIncident: vi.fn().mockResolvedValue(mockCreatedIncident),
  getByLocalId: vi.fn().mockResolvedValue(mockCreatedIncident),
  updateRemoteId: vi.fn().mockResolvedValue(undefined),
  updateSyncStatus: vi.fn().mockResolvedValue(undefined),
}))

const mockSyncJobsRepo = vi.hoisted(() => ({
  createJob: vi.fn().mockResolvedValue(mockCreatedJob),
}))

vi.mock('../../../src/db/repositories/incidents-repository', () => ({
  incidentsRepository: mockIncidentsRepo,
}))

vi.mock('../../../src/db/repositories/sync-jobs-repository', () => ({
  syncJobsRepository: mockSyncJobsRepo,
}))

// ─── Mock API (should not be called by enqueue) ──────────────────────────────
const mockCreateIncident = vi.hoisted(() => vi.fn())
vi.mock('../../../src/api/incidents', () => ({
  createIncident: mockCreateIncident,
}))

// ─── Mock sync-engine ────────────────────────────────────────────────────────
vi.mock('../../../src/services/sync/sync-engine', () => ({
  registerExecutor: vi.fn(),
  flush: vi.fn(),
}))

// ─── Import the module under test after mocks are set ───────────────────────
import { enqueueCreateIncident, registerIncidentExecutors } from '../../../src/services/sync/incident-outbox-service'

describe('incident-outbox-service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockIncidentsRepo.createLocalIncident.mockResolvedValue(mockCreatedIncident)
    mockSyncJobsRepo.createJob.mockResolvedValue(mockCreatedJob)
  })

  describe('enqueueCreateIncident', () => {
    it('persists the incident locally and returns a localId', async () => {
      const result = await enqueueCreateIncident({
        installationId: 42,
        note: 'Test incident',
        reporterUsername: 'ops',
        severity: 'medium',
        source: 'mobile',
        gps: {
          status: 'captured',
          source: 'browser',
          lat: -34.9011,
          lng: -56.1645,
          accuracy_m: 12,
          captured_at: '2026-03-26T12:00:00.000Z',
        },
      })

      expect(mockIncidentsRepo.createLocalIncident).toHaveBeenCalledOnce()
      expect(result.localId).toBeTruthy()
    })

    it('enqueues a sync job with operation create_incident', async () => {
      await enqueueCreateIncident({
        installationId: 42,
        note: 'Test incident',
        reporterUsername: 'ops',
        gps: { status: 'pending', source: 'none', note: '' },
      })

      expect(mockSyncJobsRepo.createJob).toHaveBeenCalledOnce()
      expect(mockSyncJobsRepo.createJob).toHaveBeenCalledWith(
        expect.objectContaining({
          operation: 'create_incident',
          entityType: 'incident',
        }),
      )
    })

    it('returns both localId and the queued jobId', async () => {
      const result = await enqueueCreateIncident({
        installationId: 42,
        note: 'Test',
        reporterUsername: 'ops',
        gps: { status: 'pending', source: 'none', note: '' },
      })

      expect(result.localId).toBeTruthy()
      expect(result.jobId).toBe('job-5678')
    })

    it('does NOT call the API directly — local save only', async () => {
      await enqueueCreateIncident({
        installationId: 42,
        note: 'Offline incident',
        reporterUsername: 'ops',
        gps: { status: 'pending', source: 'none', note: '' },
      })

      expect(mockCreateIncident).not.toHaveBeenCalled()
    })

    it('generates a unique clientRequestId per call', async () => {
      await enqueueCreateIncident({
        installationId: 1,
        note: 'A',
        reporterUsername: 'u',
        gps: { status: 'pending', source: 'none', note: '' },
      })
      await enqueueCreateIncident({
        installationId: 1,
        note: 'B',
        reporterUsername: 'u',
        gps: { status: 'pending', source: 'none', note: '' },
      })

      const firstCallArgs = mockIncidentsRepo.createLocalIncident.mock.calls[0][0]
      const secondCallArgs = mockIncidentsRepo.createLocalIncident.mock.calls[1][0]
      expect(firstCallArgs.clientRequestId).not.toBe(secondCallArgs.clientRequestId)
    })

    it('persists gps capture data in the local incident payload', async () => {
      await enqueueCreateIncident({
        installationId: 42,
        note: 'Offline incident with GPS',
        reporterUsername: 'ops',
        gps: {
          status: 'captured',
          source: 'browser',
          lat: -34.89,
          lng: -56.15,
          accuracy_m: 18,
          captured_at: '2026-03-26T13:00:00.000Z',
        },
      })

      expect(mockIncidentsRepo.createLocalIncident).toHaveBeenCalledWith(
        expect.objectContaining({
          gps: expect.objectContaining({
            status: 'captured',
            source: 'browser',
            lat: -34.89,
          }),
        }),
      )
    })
  })

  describe('registerIncidentExecutors', () => {
    it('registers without throwing (idempotent)', () => {
      expect(() => registerIncidentExecutors()).not.toThrow()
      expect(() => registerIncidentExecutors()).not.toThrow()
    })
  })
})
