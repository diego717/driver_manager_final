export type SignatureSessionSnapshot = {
  id: string;
  paths: string[];
  updatedAt: number;
};

const signatureSessions = new Map<string, SignatureSessionSnapshot>();

function buildSessionId(): string {
  return `sig_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export function createSignatureSession(initialPaths: string[] = []): string {
  const id = buildSessionId();
  signatureSessions.set(id, {
    id,
    paths: [...initialPaths],
    updatedAt: Date.now(),
  });
  return id;
}

export function getSignatureSession(sessionId: string): SignatureSessionSnapshot | null {
  const normalized = String(sessionId || "").trim();
  if (!normalized) return null;
  const snapshot = signatureSessions.get(normalized);
  return snapshot ? { ...snapshot, paths: [...snapshot.paths] } : null;
}

export function updateSignatureSession(sessionId: string, nextPaths: string[]): SignatureSessionSnapshot | null {
  const normalized = String(sessionId || "").trim();
  if (!normalized) return null;
  const current = signatureSessions.get(normalized);
  if (!current) return null;
  const snapshot = {
    id: normalized,
    paths: [...nextPaths],
    updatedAt: Date.now(),
  };
  signatureSessions.set(normalized, snapshot);
  return { ...snapshot, paths: [...snapshot.paths] };
}

export function clearSignatureSession(sessionId: string): void {
  const normalized = String(sessionId || "").trim();
  if (!normalized) return;
  signatureSessions.delete(normalized);
}
