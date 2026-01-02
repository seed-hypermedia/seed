import { useSyncExternalStore, useCallback, useRef } from "react";

/**
 * This hook works like useState but persists the value in localStorage (under the given key) making it reactive.
 */
export function useLocalStorage(key: string, initialValue: unknown) {
  const cachedValue = useRef<any>();

  const getSnapshot = useCallback(() => {
    if (cachedValue.current === undefined) {
      try {
        const item = localStorage.getItem(key);
        cachedValue.current = item ? JSON.parse(item) : initialValue;
      } catch {
        cachedValue.current = initialValue;
      }
    }
    return cachedValue.current;
  }, [key, initialValue]);

  const subscribe = useCallback(
    (callback: () => void) => {
      const storageEventHandler = (event: StorageEvent) => {
        if (event.key === key) {
          cachedValue.current = undefined; // invalidate cache
          callback();
        }
      };

      window.addEventListener("storage", storageEventHandler);

      return () => {
        window.removeEventListener("storage", storageEventHandler);
      };
    },
    [key]
  );

  const value = useSyncExternalStore(subscribe, getSnapshot);

  const setValue = useCallback(
    (value: any) => {
      const valueToStore =
        typeof value === "function" ? value(getSnapshot()) : value;

      localStorage.setItem(key, JSON.stringify(valueToStore));
      cachedValue.current = valueToStore; // update cache

      // Manually trigger subscribers for same-tab reactivity
      window.dispatchEvent(
        new StorageEvent("storage", {
          key,
          newValue: JSON.stringify(valueToStore),
          oldValue: localStorage.getItem(key),
          storageArea: localStorage,
          url: window.location.href,
        })
      );
    },
    [key, getSnapshot]
  );

  return [value, setValue] as const;
}
