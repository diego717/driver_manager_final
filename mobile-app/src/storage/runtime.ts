function getWebStorage(storageName: "localStorage" | "sessionStorage"): Storage | null {
  if (typeof window === "undefined") return null;

  try {
    const storage =
      storageName === "localStorage" ? window.localStorage : window.sessionStorage;
    if (!storage) return null;
    return storage;
  } catch {
    return null;
  }
}

export function hasWebStorage(): boolean {
  return getWebSessionStorage() !== null;
}

export function isWebBrowserRuntime(): boolean {
  return hasWebStorage();
}

export function getWebSessionStorage(): Storage | null {
  return getWebStorage("sessionStorage");
}

export function getWebLocalStorage(): Storage | null {
  return getWebStorage("localStorage");
}
