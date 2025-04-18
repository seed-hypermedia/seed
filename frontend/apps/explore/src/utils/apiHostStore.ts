import {getApiHost, setApiHost} from "./apiHost";

// Store implementation
let currentApiHost = getApiHost();
const listeners = new Set<() => void>();

// Subscribe function for useSyncExternalStore
export function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

// Get snapshot function for useSyncExternalStore
export function getSnapshot() {
  return currentApiHost;
}

// Action to update the API host
export function updateApiHost(newHost: string) {
  currentApiHost = newHost;
  setApiHost(newHost);
  // Notify all listeners
  listeners.forEach((listener) => listener());
}
