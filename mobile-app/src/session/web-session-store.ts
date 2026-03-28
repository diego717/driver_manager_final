import { useSyncExternalStore } from "react";

import { clearWebSession, getCurrentWebSession, readStoredWebSession } from "@/src/api/webAuth";
import { evaluateWebSession } from "@/src/api/webSession";
import { consumeForceLoginOnOpenFlag } from "@/src/security/startup-session-policy";
import { isWebBrowserRuntime } from "@/src/storage/runtime";
import { isStoredWebSessionKey } from "@/src/storage/secure";

type WebSessionSnapshot = {
  checkingSession: boolean;
  hasActiveSession: boolean;
  lastCheckedAt: number;
};

let snapshot: WebSessionSnapshot = {
  checkingSession: true,
  hasActiveSession: false,
  lastCheckedAt: 0,
};

const listeners = new Set<() => void>();
let latestRefreshRequestId = 0;
let webStorageListenerInstalled = false;
let webStorageListener: ((event: StorageEvent) => void) | null = null;

function emit(): void {
  listeners.forEach((listener) => listener());
}

function setSnapshot(next: Partial<WebSessionSnapshot>): void {
  snapshot = {
    ...snapshot,
    ...next,
  };
  emit();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): WebSessionSnapshot {
  return snapshot;
}

function supportsWindowStorageEvents(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.addEventListener === "function" &&
    typeof window.removeEventListener === "function"
  );
}

function ensureWebSessionStorageListener(): void {
  if (webStorageListenerInstalled || !supportsWindowStorageEvents()) {
    return;
  }

  webStorageListener = (event: StorageEvent) => {
    if (event.key !== null && !isStoredWebSessionKey(event.key)) {
      return;
    }
    void refreshSharedWebSessionState();
  };
  window.addEventListener("storage", webStorageListener);
  webStorageListenerInstalled = true;
}

export async function refreshSharedWebSessionState(options?: { showLoader?: boolean }): Promise<boolean> {
  ensureWebSessionStorageListener();
  const showLoader = options?.showLoader === true;
  const requestId = ++latestRefreshRequestId;
  if (showLoader) {
    setSnapshot({ checkingSession: true });
  }

  try {
    if (consumeForceLoginOnOpenFlag()) {
      await clearWebSession();
    }

    const storedSession = await readStoredWebSession();
    const resolved = evaluateWebSession(
      isWebBrowserRuntime() && storedSession.expiresAt ? "__cookie_session__" : storedSession.accessToken,
      storedSession.expiresAt,
    );

    if (resolved.state === "expired") {
      await clearWebSession();
    }

    let isActive = resolved.state === "active";
    if (isActive && isWebBrowserRuntime()) {
      try {
        await getCurrentWebSession();
      } catch {
        await clearWebSession();
        isActive = false;
      }
    }
    if (requestId !== latestRefreshRequestId) {
      return snapshot.hasActiveSession;
    }
    setSnapshot({
      hasActiveSession: isActive,
      checkingSession: false,
      lastCheckedAt: Date.now(),
    });
    return isActive;
  } catch {
    if (requestId !== latestRefreshRequestId) {
      return snapshot.hasActiveSession;
    }
    setSnapshot({
      hasActiveSession: false,
      checkingSession: false,
      lastCheckedAt: Date.now(),
    });
    return false;
  }
}

export async function clearSharedWebSessionState(): Promise<void> {
  latestRefreshRequestId += 1;
  await clearWebSession();
  setSnapshot({
    hasActiveSession: false,
    checkingSession: false,
    lastCheckedAt: Date.now(),
  });
}

export function useSharedWebSessionState(): WebSessionSnapshot {
  ensureWebSessionStorageListener();
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function __resetSharedWebSessionStoreForTests(): void {
  if (supportsWindowStorageEvents() && webStorageListener) {
    window.removeEventListener("storage", webStorageListener);
  }
  snapshot = {
    checkingSession: true,
    hasActiveSession: false,
    lastCheckedAt: 0,
  };
  latestRefreshRequestId = 0;
  listeners.clear();
  webStorageListenerInstalled = false;
  webStorageListener = null;
}

export function __getSharedWebSessionSnapshotForTests(): WebSessionSnapshot {
  return snapshot;
}
