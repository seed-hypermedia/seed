/**
 * The change signal: "this resource may have changed", with no content. The desktop turns it into
 * query invalidations in its main process; the web server fans it out to browsers over one stream
 * per tab (`/hm/api/changes`), and each browser makes the same invalidations.
 *
 * Because a signal names a resource and nothing else, receiving one needs no permission: whoever
 * hears it still has to read the data with their own access.
 */

import {queryKeys} from './models/query-keys'
import {getParentPaths} from './utils/breadcrumbs'
import {hmId, unpackHmId} from './utils/entity-id-url'

/** What one listener wants to hear about: a resource, or with `recursive` everything below it too. */
export type ChangeSubscription = {id: string; recursive: boolean}

/** A resource changed, or `resync`: changes were skipped, so anything watched may be stale. */
export type ChangeSignal = {type: 'change'; resource: string} | {type: 'resync'}

/** Where the web app serves the stream. */
export const CHANGE_STREAM_PATH = '/hm/api/changes'

/**
 * Most subscriptions one stream carries. A page holds at most 16 watches; this leaves room for a
 * second page on the same screen and keeps the request URL short.
 */
export const CHANGE_STREAM_MAX_SUBSCRIPTIONS = 32

/** How often the server writes to an idle stream, so proxies keep it open and a dead one shows. */
export const CHANGE_STREAM_HEARTBEAT_MS = 20_000

const MAX_ID_LENGTH = 512

/** The queries that show a resource, which a change to it makes stale. */
export function resourceChangeQueryKeys(resource: string): string[][] {
  const id = unpackHmId(resource)
  if (!id) return []
  return [
    [queryKeys.ENTITY, id.id],
    [queryKeys.RESOLVED_ENTITY, id.id],
    [queryKeys.ACCOUNT, id.uid],
    // Its own listing, and that of every folder above it up to the space root.
    ...getParentPaths(id.path).map((path) => [queryKeys.DOC_LIST_DIRECTORY, hmId(id.uid, {path}).id]),
    [queryKeys.DOCUMENT_INTERACTION_SUMMARY, id.id],
  ]
}

/** The queries one subscription keeps fresh, for when changes may have been missed. */
export function subscriptionQueryKeys(subscription: ChangeSubscription): string[][] {
  return subscription.recursive
    ? [[queryKeys.DOC_LIST_DIRECTORY, subscription.id]]
    : [
        [queryKeys.ENTITY, subscription.id],
        [queryKeys.RESOLVED_ENTITY, subscription.id],
      ]
}

/** The stream address for a set of subscriptions: `r` names a resource, `d` a directory. */
export function changeStreamUrl(subscriptions: ChangeSubscription[], path = CHANGE_STREAM_PATH): string {
  const query = new URLSearchParams()
  subscriptions.forEach(({id, recursive}) => query.append(recursive ? 'd' : 'r', id))
  return `${path}?${query}`
}

/** Reads the subscriptions out of a stream address, or says why the request is refused. */
export function parseChangeStreamQuery(query: URLSearchParams): ChangeSubscription[] | {error: string} {
  const subscriptions = new Map<string, ChangeSubscription>()
  let error: string | null = null
  query.forEach((value, name) => {
    const id = value.length <= MAX_ID_LENGTH ? unpackHmId(value) : null
    if (name !== 'r' && name !== 'd') error = `Unknown parameter: ${name}`
    // The canonical id only: a version never changes, and anything else would never match the feed.
    else if (!id || id.id !== value) error = 'Invalid resource id'
    else subscriptions.set(`${name}:${value}`, {id: value, recursive: name === 'd'})
  })
  if (error) return {error}
  if (!subscriptions.size) return {error: 'Nothing to watch'}
  if (subscriptions.size > CHANGE_STREAM_MAX_SUBSCRIPTIONS)
    return {error: `A stream carries at most ${CHANGE_STREAM_MAX_SUBSCRIPTIONS} subscriptions`}
  return Array.from(subscriptions.values())
}

/** One server-sent event. `ping` is an event rather than a comment so the browser can see it. */
export function encodeChangeStreamEvent(event: ChangeSignal | {type: 'ready'} | {type: 'ping'}): string {
  if (event.type === 'change') return `data: ${event.resource.replace(/[\r\n]/g, '')}\n\n`
  return `event: ${event.type}\ndata:\n\n`
}

type Listener = {subscriptions: ChangeSubscription[]; notify: (signal: ChangeSignal) => void}

/**
 * One change source shared by every listener in a process.
 *
 * `follow` begins following changes and returns the poll to call for the next batch; the hub
 * calls it once when the first listener arrives, polls on one timer however many listeners there
 * are, and stops when the last leaves, so an idle server asks its node nothing.
 */
export function createChangeHub(options: {
  follow: () => () => Promise<{resources: string[]; truncated?: boolean}>
  /** Listeners past this are refused, so a flood of streams cannot hold the process. */
  maxListeners: number
  intervalMs?: number
  /** A new listener is also told of changes this recent: it read its data just before subscribing. */
  replayMs?: number
  onError?: (error: unknown) => void
}) {
  const {intervalMs = 1_000, replayMs = 5_000} = options
  const listeners = new Set<Listener>()
  // Listeners by the id they named, so a change costs its path depth, not the listener count.
  const exact = new Map<string, Set<Listener>>()
  const recursive = new Map<string, Set<Listener>>()
  let recent: {resource: string; at: number}[] = []
  // Identifies the current run; a poll that outlives its run must not deliver or reschedule.
  let run: object | null = null
  let timer: ReturnType<typeof setTimeout> | null = null

  const index = (listener: Listener, add: boolean) => {
    for (const {id, recursive: deep} of listener.subscriptions) {
      const map = deep ? recursive : exact
      if (add) {
        if (!map.has(id)) map.set(id, new Set())
        map.get(id)!.add(listener)
      } else {
        map.get(id)?.delete(listener)
        if (!map.get(id)?.size) map.delete(id)
      }
    }
  }

  const matching = (resource: string): Set<Listener> => {
    const found = new Set<Listener>()
    exact.get(resource)?.forEach((listener) => found.add(listener))
    const id = unpackHmId(resource)
    if (!id) return found
    // A directory subscription hears about itself and everything below it.
    for (const path of getParentPaths(id.path)) {
      recursive.get(hmId(id.uid, {path}).id)?.forEach((listener) => found.add(listener))
    }
    return found
  }

  const deliver = (resources: string[], truncated: boolean) => {
    const now = Date.now()
    recent = recent.filter((change) => now - change.at <= replayMs)
    if (truncated) {
      listeners.forEach((listener) => listener.notify({type: 'resync'}))
      return
    }
    new Set(resources).forEach((resource) => {
      recent.push({resource, at: now})
      matching(resource).forEach((listener) => listener.notify({type: 'change', resource}))
    })
  }

  const start = () => {
    const current = (run = {})
    const poll = options.follow()
    let failures = 0
    const tick = async () => {
      try {
        const {resources, truncated} = await poll()
        failures = 0
        if (run === current) deliver(resources, !!truncated)
      } catch (error) {
        failures++
        options.onError?.(error)
      }
      if (run !== current) return
      // A node that is down or slow is asked less often, not hammered once a second.
      timer = setTimeout(tick, Math.min(intervalMs * 2 ** Math.min(failures, 4), 15_000))
    }
    void tick()
  }

  const stop = () => {
    run = null
    if (timer) clearTimeout(timer)
    timer = null
    recent = []
  }

  return {
    /** Begin hearing changes; returns how to stop, or null when the hub is full. */
    subscribe(subscriptions: ChangeSubscription[], notify: (signal: ChangeSignal) => void): (() => void) | null {
      if (listeners.size >= options.maxListeners) return null
      const listener: Listener = {subscriptions, notify}
      listeners.add(listener)
      index(listener, true)
      if (!run) start()
      else {
        const now = Date.now()
        const replay = new Set(
          recent
            .filter((change) => now - change.at <= replayMs && matching(change.resource).has(listener))
            .map((change) => change.resource),
        )
        replay.forEach((resource) => notify({type: 'change', resource}))
      }
      let subscribed = true
      return () => {
        if (!subscribed) return
        subscribed = false
        listeners.delete(listener)
        index(listener, false)
        if (!listeners.size) stop()
      }
    },
    /** How many listeners are subscribed. */
    get size() {
      return listeners.size
    },
  }
}
