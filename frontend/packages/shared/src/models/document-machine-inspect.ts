import {useCallback, useEffect, useMemo, useRef} from 'react'

// -- Inspection event types (from XState v5's inspect API) --

export type InspectionEvent =
  | {type: '@xstate.actor'; actorRef: any; rootId: string}
  | {type: '@xstate.snapshot'; actorRef: any; rootId: string; snapshot: any; event: any}
  | {type: '@xstate.event'; actorRef: any; rootId: string; event: any; sourceRef?: any}
  | {type: '@xstate.microstep'; actorRef: any; rootId: string; snapshot: any; event: any}

export type InspectFn = (inspectionEvent: InspectionEvent) => void

// -- Lightweight event store for sharing inspect events across components --

export type InspectEntry = {
  /** XState inspection event type */
  inspType: string
  /** User-facing event type (e.g. 'edit.start') or description */
  eventType: string
  /** ISO timestamp */
  timestamp: string
  /** State value after snapshot, if available */
  stateValue?: unknown
  /** Raw inspection event for advanced inspection */
  raw: InspectionEvent
}

type Listener = (entry: InspectEntry) => void

export class InspectEventStore {
  private _entries: InspectEntry[] = []
  private _listeners = new Set<Listener>()
  private _maxEntries: number

  constructor(maxEntries = 200) {
    this._maxEntries = maxEntries
  }

  get entries(): readonly InspectEntry[] {
    return this._entries
  }

  push(entry: InspectEntry) {
    this._entries = [entry, ...this._entries].slice(0, this._maxEntries)
    this._listeners.forEach((fn) => fn(entry))
  }

  clear() {
    this._entries = []
  }

  subscribe(listener: Listener): () => void {
    this._listeners.add(listener)
    return () => this._listeners.delete(listener)
  }
}

/**
 * Creates an XState-compatible `inspect` callback that captures inspection
 * events into an `InspectEventStore`.
 *
 * Works inside Electron without popups or cross-origin communication —
 * all data stays in-process.
 */
function createInspectCallback(store: InspectEventStore): InspectFn {
  return (inspectionEvent: InspectionEvent) => {
    const timestamp = new Date().toISOString()

    switch (inspectionEvent.type) {
      case '@xstate.event': {
        store.push({
          inspType: 'event',
          eventType: inspectionEvent.event?.type ?? 'unknown',
          timestamp,
          raw: inspectionEvent,
        })
        break
      }
      case '@xstate.snapshot': {
        store.push({
          inspType: 'snapshot',
          eventType: inspectionEvent.event?.type ?? 'snapshot',
          timestamp,
          stateValue: inspectionEvent.snapshot?.value,
          raw: inspectionEvent,
        })
        break
      }
      case '@xstate.actor': {
        store.push({
          inspType: 'actor',
          eventType: `actor created`,
          timestamp,
          raw: inspectionEvent,
        })
        break
      }
      case '@xstate.microstep': {
        // Microsteps are noisy — skip by default
        break
      }
    }
  }
}

/**
 * Hook that provides an XState `inspect` callback when `enabled` is true.
 *
 * Returns `{ inspect, store }`:
 * - `inspect` — pass to `useActorRef(machine, {inspect})`. `undefined` when disabled.
 * - `store`   — the `InspectEventStore` the debug drawer subscribes to.
 *
 * When `enabled` is false both values are `undefined` — zero overhead.
 */
export function useDocumentInspector(enabled: boolean): {
  inspect: InspectFn | undefined
  store: InspectEventStore | undefined
} {
  const storeRef = useRef<InspectEventStore | null>(null)

  // Create or dispose store based on enabled flag
  if (enabled && !storeRef.current) {
    storeRef.current = new InspectEventStore()
  }

  // Build a stable inspect callback that delegates to the current store
  const inspect = useCallback<InspectFn>(
    (event) => {
      if (storeRef.current) {
        createInspectCallback(storeRef.current)(event)
      }
    },
    [], // stable — delegates via ref
  )

  // Clean up store on disable or unmount
  useEffect(() => {
    if (!enabled && storeRef.current) {
      storeRef.current.clear()
      storeRef.current = null
    }
  }, [enabled])

  useEffect(() => {
    return () => {
      storeRef.current?.clear()
      storeRef.current = null
    }
  }, [])

  return useMemo(
    () => ({
      inspect: enabled ? inspect : undefined,
      store: storeRef.current ?? undefined,
    }),
    [enabled, inspect],
  )
}
