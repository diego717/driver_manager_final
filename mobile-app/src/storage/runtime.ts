export function hasWebStorage(): boolean {
  return typeof window !== "undefined";
}

function createEphemeralStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    clear() {
      data.clear();
    },
    getItem(key: string): string | null {
      return data.has(key) ? data.get(key)! : null;
    },
    key(index: number): string | null {
      if (!Number.isInteger(index) || index < 0 || index >= data.size) return null;
      return Array.from(data.keys())[index] ?? null;
    },
    removeItem(key: string): void {
      data.delete(key);
    },
    setItem(key: string, value: string): void {
      data.set(key, String(value));
    },
  };
}

let webEphemeralStorage: Storage | null = null;

export function getWebSessionStorage(): Storage | null {
  if (!hasWebStorage()) return null;
  // Security: avoid persistent browser storage for web access tokens.
  // Keep web session data in-memory for the current runtime only.
  if (!webEphemeralStorage) {
    webEphemeralStorage = createEphemeralStorage();
  }
  return webEphemeralStorage;
}
