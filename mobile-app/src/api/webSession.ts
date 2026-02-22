export type WebSessionState = "active" | "missing" | "expired";

export type ResolvedWebSession =
  | { state: "active"; accessToken: string }
  | { state: "missing" | "expired"; accessToken: null };

const WEB_SESSION_EXPIRY_SKEW_MS = 5_000;

function parseIsoToMillis(value: string): number | null {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return null;
  return parsed;
}

export function evaluateWebSession(
  accessToken: string | null,
  expiresAtIso: string | null,
  nowMs = Date.now(),
): ResolvedWebSession {
  if (!accessToken || !expiresAtIso) {
    return {
      state: "missing",
      accessToken: null,
    };
  }

  const expiresAtMs = parseIsoToMillis(expiresAtIso);
  if (expiresAtMs === null || expiresAtMs <= nowMs + WEB_SESSION_EXPIRY_SKEW_MS) {
    return {
      state: "expired",
      accessToken: null,
    };
  }

  return {
    state: "active",
    accessToken,
  };
}

export async function resolveWebSession(params: {
  getAccessToken: () => Promise<string | null>;
  getExpiresAt: () => Promise<string | null>;
  onExpired?: () => Promise<void>;
}): Promise<ResolvedWebSession> {
  const [accessToken, expiresAtIso] = await Promise.all([
    params.getAccessToken(),
    params.getExpiresAt(),
  ]);
  const resolved = evaluateWebSession(accessToken, expiresAtIso);
  if (resolved.state === "expired") {
    await params.onExpired?.();
  }
  return resolved;
}
