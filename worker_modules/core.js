export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function nowIso() {
  return new Date().toISOString();
}

export function nowUnixSeconds() {
  return Math.floor(Date.now() / 1000);
}

export function normalizeOptionalString(value, fallback = "") {
  if (value === null || value === undefined) return fallback;
  return String(value).trim();
}

export function normalizeWebUsername(value) {
  return normalizeOptionalString(value, "").toLowerCase();
}

export function containsAnyChar(input, allowedChars) {
  for (let i = 0; i < input.length; i += 1) {
    if (allowedChars.includes(input[i])) return true;
  }
  return false;
}

export function normalizeRateLimitCounter(value) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isInteger(parsed) || parsed < 0) {
    return 0;
  }
  return parsed;
}

export function normalizeNonNegativeInteger(value, fallback = 0) {
  if (value === null || value === undefined || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, Math.trunc(parsed));
}
