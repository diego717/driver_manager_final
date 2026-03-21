import { useEffect, useState } from "react";

import { syncStateStore, type SyncState } from "@/src/services/sync/sync-state-store";

export function useSyncState(): SyncState {
  const [state, setState] = useState<SyncState>(() => syncStateStore.getState());

  useEffect(() => {
    return syncStateStore.subscribe((nextState) => {
      setState(nextState);
    });
  }, []);

  return state;
}
