import {useCallback, useSyncExternalStore} from 'react'
import type {StateStream} from './utils/stream'

export function useStream<StreamValue>(stream?: StateStream<StreamValue> | undefined): StreamValue | undefined {
  return useSyncExternalStore(
    (onStoreChange) => {
      return stream ? stream.subscribe(onStoreChange) : () => {}
    },
    () => stream?.get(),
    () => stream?.get(), // Server snapshot - same as client for SSR compatibility
  )
}

/**
 * Subscribe to a slice of a stream. The selector must return a stable
 * reference for an unchanged slice (e.g. pick a property) — a selector that
 * allocates a fresh object every call would re-render on every check.
 *
 * Implemented with useSyncExternalStore so emissions fired while a
 * subscription is being torn down and re-created (React runs all effect
 * cleanups for a commit before all setups) are never lost. The previous
 * useState+useEffect implementation could permanently miss a navigation
 * dispatched from a child's mount effect in production builds — see
 * https://github.com/seed-hypermedia/seed/issues/848.
 */
export function useStreamSelector<StreamValue, InternalValue>(
  stream: StateStream<StreamValue>,
  selector: (value: StreamValue) => InternalValue,
): InternalValue {
  const subscribe = useCallback((onStoreChange: () => void) => stream.subscribe(onStoreChange), [stream])
  const getSnapshot = () => selector(stream.get())
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}
