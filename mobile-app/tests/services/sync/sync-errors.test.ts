import { describe, expect, it } from 'vitest'

/**
 * Tests for sync-errors.ts — pure classification logic, no external dependencies.
 */

import { classifyError, SyncEngineError } from '../../../src/services/sync/sync-errors'

describe('sync-errors: classifyError', () => {
  it('classifies 400 as terminal', () => {
    const err = { response: { status: 400 }, message: 'Bad Request' }
    expect(classifyError(err).kind).toBe('terminal')
  })

  it('classifies 422 as terminal', () => {
    const err = { response: { status: 422 }, message: 'Unprocessable' }
    expect(classifyError(err).kind).toBe('terminal')
  })

  it('classifies 401 as auth', () => {
    const err = { response: { status: 401 }, message: 'Unauthorized' }
    expect(classifyError(err).kind).toBe('auth')
  })

  it('classifies 403 as auth', () => {
    const err = { response: { status: 403 }, message: 'Forbidden' }
    expect(classifyError(err).kind).toBe('auth')
  })

  it('classifies 500 as transient', () => {
    const err = { response: { status: 500 }, message: 'Internal Server Error' }
    expect(classifyError(err).kind).toBe('transient')
  })

  it('classifies 503 as transient', () => {
    const err = { response: { status: 503 }, message: 'Service Unavailable' }
    expect(classifyError(err).kind).toBe('transient')
  })

  it('classifies network error (no response) as transient', () => {
    const err = new Error('Network request failed')
    expect(classifyError(err).kind).toBe('transient')
  })

  it('classifies 408 as transient (timeout)', () => {
    const err = { response: { status: 408 }, message: 'Request Timeout' }
    expect(classifyError(err).kind).toBe('transient')
  })

  it('classifies 429 as transient (rate limit)', () => {
    const err = { response: { status: 429 }, message: 'Too Many Requests' }
    expect(classifyError(err).kind).toBe('transient')
  })

  it('preserves kind from SyncEngineError', () => {
    const err = new SyncEngineError('local file missing', 'terminal')
    expect(classifyError(err).kind).toBe('terminal')
  })
})
