import { useSyncExternalStore } from "react";
import type { PocketSync, PocketSyncState } from "./pocket-sync";

export function usePocketSyncState(sync: PocketSync): PocketSyncState {
  return useSyncExternalStore(sync.subscribe, sync.getState, sync.getState);
}
