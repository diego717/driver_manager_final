import { getResolvedApiBaseUrl } from "../../api/client";

/**
 * Lightweight reachability probe against the configured API origin.
 * Keeps mobile flows aligned with the same runtime base URL used by the API client.
 */
export async function canReachConfiguredApi(timeoutMs: number = 3000): Promise<boolean> {
  try {
    const apiBase = await getResolvedApiBaseUrl();
    if (!apiBase) return true;
    await fetch(apiBase, { method: "HEAD", signal: AbortSignal.timeout(timeoutMs) });
    return true;
  } catch {
    return false;
  }
}
