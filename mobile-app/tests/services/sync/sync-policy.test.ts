import { describe, expect, it } from 'vitest'

/**
 * Tests for sync-policy.ts — pure logic, no external dependencies.
 */

import { nextRetryAt, hasExceededMaxAttempts, MAX_SYNC_ATTEMPTS } from '../../../src/services/sync/sync-policy'

describe('sync-policy', () => {
  describe('nextRetryAt', () => {
    it('returns exactly now for attempt 0 (no jitter on 0ms)', () => {
      const now = Date.now()
      const result = nextRetryAt(0, now)
      // delay is 0ms, jitter of ±20% of 0 is still 0
      expect(result).toBe(now)
    })

    it('returns ~30s delay for attempt 1', () => {
      const now = 0
      const result = nextRetryAt(1, now)
      // base 30_000 ± 20% → 24_000 to 36_000
      expect(result).toBeGreaterThanOrEqual(24_000)
      expect(result).toBeLessThanOrEqual(36_000)
    })

    it('returns ~2min delay for attempt 2', () => {
      const now = 0
      const result = nextRetryAt(2, now)
      // base 120_000 ± 20% → 96_000 to 144_000
      expect(result).toBeGreaterThanOrEqual(96_000)
      expect(result).toBeLessThanOrEqual(144_000)
    })

    it('returns ~10min delay for attempt 3', () => {
      const now = 0
      const result = nextRetryAt(3, now)
      // base 600_000 ± 20% → 480_000 to 720_000
      expect(result).toBeGreaterThanOrEqual(480_000)
      expect(result).toBeLessThanOrEqual(720_000)
    })

    it('caps at ~30min delay for attempt 5+', () => {
      const now = 0
      const result = nextRetryAt(10, now)
      // base 1_800_000 ± 20% → 1_440_000 to 2_160_000
      expect(result).toBeGreaterThanOrEqual(1_440_000)
      expect(result).toBeLessThanOrEqual(2_160_000)
    })
  })

  describe('hasExceededMaxAttempts', () => {
    it('returns false below MAX_SYNC_ATTEMPTS', () => {
      expect(hasExceededMaxAttempts(MAX_SYNC_ATTEMPTS - 1)).toBe(false)
    })

    it('returns true at MAX_SYNC_ATTEMPTS', () => {
      expect(hasExceededMaxAttempts(MAX_SYNC_ATTEMPTS)).toBe(true)
    })

    it('returns true above MAX_SYNC_ATTEMPTS', () => {
      expect(hasExceededMaxAttempts(MAX_SYNC_ATTEMPTS + 5)).toBe(true)
    })
  })
})
