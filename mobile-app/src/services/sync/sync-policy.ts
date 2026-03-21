/**
 * sync-policy.ts
 * Retry delays and job eligibility rules.
 */

/**
 * Exponential backoff with jitter (additive, ±20% of the base delay).
 * Matches the plan:
 *   attempt 1 → 0ms (immediate, caller decides)
 *   attempt 2 → ~30s
 *   attempt 3 → ~2min
 *   attempt 4 → ~10min
 *   attempt 5+ → ~30min
 */
const RETRY_DELAYS_MS = [
  0,           // attempt 1: run immediately
  30_000,      // attempt 2: 30s
  120_000,     // attempt 3: 2min
  600_000,     // attempt 4: 10min
  1_800_000,   // attempt 5+: 30min
]

export const MAX_SYNC_ATTEMPTS = 10

function addJitter(delayMs: number): number {
  const jitter = (Math.random() * 0.4 - 0.2) * delayMs // ±20%
  return Math.max(0, Math.round(delayMs + jitter))
}

/**
 * Returns the epoch ms at which the next retry should run.
 * @param attemptCount — number of attempts already done (0-indexed: 0 = first attempt)
 */
export function nextRetryAt(attemptCount: number, now: number = Date.now()): number {
  const index = Math.min(attemptCount, RETRY_DELAYS_MS.length - 1)
  const baseDelay = RETRY_DELAYS_MS[index]
  return now + addJitter(baseDelay)
}

/**
 * Returns true if a job has exceeded the max allowed attempts.
 */
export function hasExceededMaxAttempts(attemptCount: number): boolean {
  return attemptCount >= MAX_SYNC_ATTEMPTS
}
