export function hasWebStorage(): boolean {
  return typeof window !== "undefined" && typeof window.sessionStorage !== "undefined";
}

export function getWebSessionStorage(): Storage | null {
  if (!hasWebStorage()) return null;
  return window.sessionStorage;
}
