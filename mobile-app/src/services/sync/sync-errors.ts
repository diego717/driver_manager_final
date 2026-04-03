/**
 * sync-errors.ts
 * Classifies API errors into categories to drive retry policy.
 */

export type SyncErrorKind = 'transient' | 'terminal' | 'auth' | 'unknown'

export interface SyncError {
  kind: SyncErrorKind
  message: string
  statusCode?: number
}

const MAX_STORED_SYNC_MESSAGE_LENGTH = 180

export function sanitizeStoredSyncMessage(message: unknown): string | null {
  const normalized = typeof message === 'string'
    ? message
    : message instanceof Error
      ? message.message
      : String(message ?? '')

  const collapsed = normalized.replace(/\s+/g, ' ').trim()
  if (!collapsed) return null

  const withoutFileUris = collapsed
    .replace(/file:\/\/\S+/gi, '[redacted-file]')
    .replace(/[A-Za-z]:\\[^\s)]+/g, '[redacted-path]')
    .replace(/\/(?:data|storage|var|private|users|home)\/[^\s)]+/gi, '[redacted-path]')

  if (withoutFileUris.length <= MAX_STORED_SYNC_MESSAGE_LENGTH) {
    return withoutFileUris
  }

  return `${withoutFileUris.slice(0, MAX_STORED_SYNC_MESSAGE_LENGTH - 3)}...`
}

/**
 * Classify an error thrown by an API call into a sync error kind.
 *
 * - `terminal`: should NOT be retried (bad payload, not found, conflict)
 * - `auth`: session expired/missing — retry only after re-auth
 * - `transient`: network glitch, server error — retry with backoff
 * - `unknown`: treat as transient by default
 */
export function classifyError(err: unknown): SyncError {
  if (err instanceof SyncEngineError) return err

  // Axios-style error with response
  const axiosError = err as {
    response?: { status?: number }
    message?: string
    code?: string
  }

  const status = axiosError?.response?.status
  const message =
    axiosError?.message ?? (err instanceof Error ? err.message : String(err))

  if (status === 401 || status === 403) {
    return { kind: 'auth', message, statusCode: status }
  }

  // Client errors in 4xx range (except 408 timeout, 429 rate-limit) are terminal
  if (status !== undefined && status >= 400 && status < 500 && status !== 408 && status !== 429) {
    return { kind: 'terminal', message, statusCode: status }
  }

  // Server errors and network errors → transient
  if (status === undefined || status >= 500 || status === 408 || status === 429) {
    return { kind: 'transient', message, statusCode: status }
  }

  return { kind: 'unknown', message, statusCode: status }
}

export function isTerminal(err: unknown): boolean {
  return classifyError(err).kind === 'terminal'
}

export function isAuth(err: unknown): boolean {
  return classifyError(err).kind === 'auth'
}

export function isTransient(err: unknown): boolean {
  const kind = classifyError(err).kind
  return kind === 'transient' || kind === 'unknown'
}

/** Use for errors that should immediately mark a job as terminal */
export class SyncEngineError extends Error implements SyncError {
  kind: SyncErrorKind
  statusCode?: number

  constructor(message: string, kind: SyncErrorKind = 'terminal', statusCode?: number) {
    super(message)
    this.name = 'SyncEngineError'
    this.kind = kind
    this.statusCode = statusCode
  }
}
