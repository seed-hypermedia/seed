/**
 * The browser end of the change stream (see `change-signal.ts`). A tab holds at most one stream,
 * for everything it is watching; each signal invalidates the queries that show that resource.
 * Callers are told whether the stream is live for their subscription, so they poll only while it
 * is not.
 */

import {
  CHANGE_STREAM_HEARTBEAT_MS,
  CHANGE_STREAM_MAX_SUBSCRIPTIONS,
  changeStreamUrl,
  resourceChangeQueryKeys,
  subscriptionQueryKeys,
  type ChangeSubscription,
} from './change-signal'

/** The part of `EventSource` the client uses. */
export type ChangeEventSource = {
  addEventListener(type: string, listener: (event: {data?: unknown}) => void): void
  close(): void
}

/** Whether the tab is in the background, where a stream would hold a connection nobody is looking at. */
export type ChangeStreamVisibility = {hidden: () => boolean; subscribe: (changed: () => void) => () => void}

// Subscriptions change in bursts (a page starts its watches together); open one stream for the burst.
const RECONCILE_DELAY_MS = 50
const RECONNECT_BASE_MS = 1_000
const RECONNECT_MAX_MS = 60_000
// Two missed heartbeats and the stream is taken for dead, though the socket may still look open.
const SILENCE_LIMIT_MS = CHANGE_STREAM_HEARTBEAT_MS * 2.5
// A hidden tab keeps its stream this long, so switching tabs briefly does not reconnect.
const HIDDEN_CLOSE_MS = 15_000
// After a `resync` every browser re-reads what it watches; spread them out.
const RESYNC_SPREAD_MS = 5_000

type Entry = {subscription: ChangeSubscription; listeners: Set<(live: boolean) => void>; live: boolean}

const entryKey = (subscription: ChangeSubscription) => `${subscription.recursive ? 'd' : 'r'}:${subscription.id}`

/** Creates the tab's change stream. Nothing connects until the first `watch`. */
export function createChangeStreamClient(options: {
  connect: (url: string) => ChangeEventSource
  invalidate: (queryKey: string[]) => void
  visibility?: ChangeStreamVisibility
  path?: string
  random?: () => number
}) {
  const random = options.random ?? Math.random
  const entries = new Map<string, Entry>()
  let stream: {source: ChangeEventSource; keys: Set<string>; ready: boolean} | null = null
  let failures = 0
  // The next stream to open follows a gap in which changes may have been missed.
  let missed = false
  let suspended = false
  let reconcileTimer: ReturnType<typeof setTimeout> | null = null
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  let silenceTimer: ReturnType<typeof setTimeout> | null = null
  let hiddenTimer: ReturnType<typeof setTimeout> | null = null
  let resyncTimer: ReturnType<typeof setTimeout> | null = null
  let stopWatchingVisibility: (() => void) | null = null

  const setLive = (isLive: (key: string) => boolean) => {
    entries.forEach((entry, key) => {
      const live = isLive(key)
      if (entry.live === live) return
      entry.live = live
      entry.listeners.forEach((listener) => listener(live))
    })
  }

  const invalidateWatched = () => {
    entries.forEach((entry) => subscriptionQueryKeys(entry.subscription).forEach((key) => options.invalidate(key)))
  }

  const heard = () => {
    if (silenceTimer) clearTimeout(silenceTimer)
    silenceTimer = setTimeout(fail, SILENCE_LIMIT_MS)
  }

  const closeStream = () => {
    stream?.source.close()
    stream = null
    if (silenceTimer) clearTimeout(silenceTimer)
    silenceTimer = null
  }

  function fail() {
    closeStream()
    setLive(() => false)
    missed = true
    failures++
    if (reconnectTimer) clearTimeout(reconnectTimer)
    const delay = Math.min(RECONNECT_BASE_MS * 2 ** (failures - 1), RECONNECT_MAX_MS)
    // Jitter, so browsers dropped together (a deploy) do not all return together.
    reconnectTimer = setTimeout(
      () => {
        reconnectTimer = null
        reconcile()
      },
      delay * (0.5 + random() / 2),
    )
  }

  const open = (keys: string[]) => {
    // Entries stay live across a deliberate swap; the server replays the last few seconds of
    // changes to a new stream, which covers the moment between the two.
    closeStream()
    const source = options.connect(
      changeStreamUrl(
        keys.map((key) => entries.get(key)!.subscription),
        options.path,
      ),
    )
    const current: NonNullable<typeof stream> = {source, keys: new Set(keys), ready: false}
    stream = current
    // A connection that never answers is given up on like one that goes quiet.
    heard()
    source.addEventListener('ready', () => {
      if (stream !== current) return
      current.ready = true
      failures = 0
      heard()
      setLive((key) => current.keys.has(key))
      if (missed) {
        missed = false
        invalidateWatched()
      }
    })
    source.addEventListener('message', (event) => {
      if (stream !== current) return
      heard()
      if (typeof event.data === 'string') resourceChangeQueryKeys(event.data).forEach((key) => options.invalidate(key))
    })
    source.addEventListener('resync', () => {
      if (stream !== current) return
      heard()
      if (resyncTimer) return
      resyncTimer = setTimeout(() => {
        resyncTimer = null
        invalidateWatched()
      }, random() * RESYNC_SPREAD_MS)
    })
    source.addEventListener('ping', () => {
      if (stream === current) heard()
    })
    // The browser's own reconnect would retry a refusal at full speed; reconnecting is done here.
    source.addEventListener('error', () => {
      if (stream === current) fail()
    })
  }

  function reconcile() {
    if (!entries.size || suspended) {
      closeStream()
      setLive(() => false)
      if (reconnectTimer) clearTimeout(reconnectTimer)
      reconnectTimer = null
      if (!entries.size) {
        failures = 0
        missed = false
      }
      return
    }
    // Backing off: the reconnect will pick up the current subscriptions.
    if (reconnectTimer) return
    // Past the stream's limit the rest are never live, so their callers keep polling.
    const keys = Array.from(entries.keys()).slice(0, CHANGE_STREAM_MAX_SUBSCRIPTIONS)
    const current = stream
    // A stream that already covers everything wanted is kept, even if it now carries extra ids:
    // a stray signal only invalidates a query nobody holds, and reconnecting costs more.
    if (current && keys.every((key) => current.keys.has(key))) {
      if (current.ready) setLive((key) => current.keys.has(key))
      return
    }
    open(keys)
  }

  const scheduleReconcile = () => {
    if (reconcileTimer) return
    reconcileTimer = setTimeout(() => {
      reconcileTimer = null
      reconcile()
    }, RECONCILE_DELAY_MS)
  }

  const visibilityChanged = () => {
    if (hiddenTimer) clearTimeout(hiddenTimer)
    hiddenTimer = null
    if (options.visibility?.hidden()) {
      hiddenTimer = setTimeout(() => {
        hiddenTimer = null
        suspended = true
        missed = true
        reconcile()
      }, HIDDEN_CLOSE_MS)
    } else if (suspended) {
      suspended = false
      reconcile()
    }
  }

  return {
    /**
     * Keep the queries that show this subscription fresh. `onLive` is told when the stream starts
     * and stops covering it (it starts out not live); returns how to stop.
     */
    watch(subscription: ChangeSubscription, onLive: (live: boolean) => void): () => void {
      const key = entryKey(subscription)
      let entry = entries.get(key)
      if (!entry) {
        entry = {subscription, listeners: new Set(), live: false}
        entries.set(key, entry)
        if (!stopWatchingVisibility && options.visibility) {
          stopWatchingVisibility = options.visibility.subscribe(visibilityChanged)
          visibilityChanged()
        }
        scheduleReconcile()
      }
      entry.listeners.add(onLive)
      if (entry.live) onLive(true)
      let watching = true
      return () => {
        if (!watching) return
        watching = false
        entry.listeners.delete(onLive)
        if (entry.listeners.size) return
        entries.delete(key)
        if (!entries.size) {
          stopWatchingVisibility?.()
          stopWatchingVisibility = null
          if (hiddenTimer) clearTimeout(hiddenTimer)
          hiddenTimer = null
          if (resyncTimer) clearTimeout(resyncTimer)
          resyncTimer = null
          suspended = false
        }
        scheduleReconcile()
      }
    },
  }
}
