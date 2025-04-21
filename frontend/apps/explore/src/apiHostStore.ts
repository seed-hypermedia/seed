import {useSyncExternalStore} from "react";
import {getApiHost, setApiHost} from "./queryClient";

let currentApiHost = getApiHost();
const listeners = new Set<() => void>();

export function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getSnapshot() {
  return currentApiHost;
}

export function useApiHost() {
  return useSyncExternalStore(subscribe, getSnapshot);
}

export function updateApiHost(newHost: string) {
  currentApiHost = newHost;
  setApiHost(newHost);
  listeners.forEach((listener) => listener());
}
