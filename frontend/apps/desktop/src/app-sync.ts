/**
 * Sync Service - runs in the Electron main process
 *
 * Handles:
 * 1. Discovery: Syncing data from the P2P network for subscribed resources
 * 2. Activity Polling: Watching the activity feed for changes and invalidating React Query caches
 *
 * This runs once per app (not per window), and broadcasts invalidations to all windows.
 */

import {grpcClient} from '@/grpc-client'
import {DISCOVERY_DEBOUNCE_MS} from '@shm/shared/constants'
import {
  AggregatedDiscoveryState,
  DiscoveryProgress,
  DiscoveryState,
  UnpackedHypermediaId,
} from '@shm/shared/hm-types'
import {HMRedirectError, getErrorMessage} from '@shm/shared/models/entity'
import {queryKeys} from '@shm/shared/models/query-keys'
import {Event} from '@shm/shared/src/client/.generated/activity/v1alpha/activity_pb'
import {tryUntilSuccess} from '@shm/shared/try-until-success'
import {getParentPaths} from '@shm/shared/utils/breadcrumbs'
import {hmId, unpackHmId} from '@shm/shared/utils/entity-id-url'
import {hmIdPathToEntityQueryPath} from '@shm/shared/utils/path-api'
import {StateStream, writeableStateStream} from '@shm/shared/utils/stream'
import {observable} from '@trpc/server/observable'
import z from 'zod'
import {appInvalidateQueries} from './app-invalidation'
import {t} from './app-trpc'

// Polling intervals
const DISCOVERY_POLL_INTERVAL_MS = 3_000
const ACTIVITY_POLL_INTERVAL_MS = 3_000

// Debounce window for batching invalidations
const INVALIDATION_DEBOUNCE_MS = 100

// Page size for fetching activity events
const ACTIVITY_PAGE_SIZE = 30

export type ResourceSubscription = {
  id: UnpackedHypermediaId
  recursive?: boolean
}

type SubscriptionState = {
  unsubscribe: () => void
  discoveryTimer: ReturnType<typeof setTimeout> | null
  isCovered: boolean
}

type SyncState = {
  // Activity polling state
  lastEventId: string | null
  isPolling: boolean
  pendingInvalidations: Set<string>
  debounceTimer: ReturnType<typeof setTimeout> | null
  activityPollTimer: ReturnType<typeof setInterval> | null

  // Resource subscriptions
  subscriptions: Map<string, SubscriptionState>
  subscriptionCounts: Map<string, number>
  recursiveSubscriptions: Set<string>

  // Discovery state streams
  discoveryStreams: Map<
    string,
    {
      write: (state: DiscoveryState | null) => void
      stream: StateStream<DiscoveryState | null>
    }
  >

  // Track last known versions to avoid unnecessary invalidations
  lastKnownVersions: Map<string, string>
}

const state: SyncState = {
  lastEventId: null,
  isPolling: false,
  pendingInvalidations: new Set(),
  debounceTimer: null,
  activityPollTimer: null,
  subscriptions: new Map(),
  subscriptionCounts: new Map(),
  recursiveSubscriptions: new Set(),
  discoveryStreams: new Map(),
  lastKnownVersions: new Map(),
}

// Aggregated discovery state
const [writeAggregatedDiscovery, aggregatedDiscoveryStream] =
  writeableStateStream<AggregatedDiscoveryState>({
    activeCount: 0,
    blobsDiscovered: 0,
    blobsDownloaded: 0,
    blobsFailed: 0,
  })

// ============ Discovery State Streams ============

function getOrCreateDiscoveryStream(entityId: string) {
  if (!state.discoveryStreams.has(entityId)) {
    const [write, stream] = writeableStateStream<DiscoveryState | null>(null)
    state.discoveryStreams.set(entityId, {write, stream})
  }
  return state.discoveryStreams.get(entityId)!
}

export function getDiscoveryStream(
  entityId: string,
): StateStream<DiscoveryState | null> {
  return getOrCreateDiscoveryStream(entityId).stream
}

export function getAggregatedDiscoveryStream(): StateStream<AggregatedDiscoveryState> {
  return aggregatedDiscoveryStream
}

function updateAggregatedDiscoveryState() {
  let activeCount = 0
  let blobsDiscovered = 0
  let blobsDownloaded = 0
  let blobsFailed = 0

  state.discoveryStreams.forEach(({stream}) => {
    const discoveryState = stream.get()
    if (discoveryState?.isDiscovering) {
      activeCount++
      if (discoveryState.progress) {
        blobsDiscovered += discoveryState.progress.blobsDiscovered
        blobsDownloaded += discoveryState.progress.blobsDownloaded
        blobsFailed += discoveryState.progress.blobsFailed
      }
    }
  })

  writeAggregatedDiscovery({
    activeCount,
    blobsDiscovered,
    blobsDownloaded,
    blobsFailed,
  })
}

// ============ Invalidation ============

function invalidateResource(resource: string) {
  const id = unpackHmId(resource)
  if (!id) return

  // Broadcast invalidations to all windows
  appInvalidateQueries([queryKeys.ENTITY, id.id])
  appInvalidateQueries([queryKeys.RESOLVED_ENTITY, id.id])
  appInvalidateQueries([queryKeys.ACCOUNT, id.uid])
  appInvalidateQueries([queryKeys.DOC_LIST_DIRECTORY, id.id])

  getParentPaths(id.path).forEach((parentPath) => {
    const parentId = hmId(id.uid, {path: parentPath})
    appInvalidateQueries([queryKeys.DOC_LIST_DIRECTORY, parentId.id])
  })

  const rootId = hmId(id.uid)
  appInvalidateQueries([queryKeys.DOC_LIST_DIRECTORY, rootId.id])
  appInvalidateQueries([queryKeys.DOCUMENT_INTERACTION_SUMMARY, id.id])
}

function flushInvalidations() {
  state.debounceTimer = null
  const resources = Array.from(state.pendingInvalidations)
  for (let i = 0; i < resources.length; i++) {
    invalidateResource(resources[i]!)
  }
  state.pendingInvalidations.clear()
}

function scheduleInvalidation(resource: string) {
  state.pendingInvalidations.add(resource)

  if (!state.debounceTimer) {
    state.debounceTimer = setTimeout(
      flushInvalidations,
      INVALIDATION_DEBOUNCE_MS,
    )
  }
}

// ============ Activity Feed Polling ============

function getEventId(event: Event): string {
  if (event.data.case === 'newBlob') {
    return `blob-${event.data.value.cid}`
  }
  if (event.data.case === 'newMention') {
    const mention = event.data.value
    return `mention-${mention.sourceBlob?.cid}-${mention.mentionType}-${mention.target}`
  }
  return `unknown-${Date.now()}`
}

function extractResource(event: Event): string | null {
  if (event.data.case === 'newBlob') {
    const resource = event.data.value.resource
    return resource.split('?')[0] || null
  }
  if (event.data.case === 'newMention') {
    const target = event.data.value.target
    return target?.split('?')[0] || null
  }
  return null
}

function isResourceSubscribed(resource: string): boolean {
  const id = unpackHmId(resource)
  if (!id) return false

  const exactKey = id.id
  const recursiveKey = `${id.id}/*`

  if (state.subscriptionCounts.has(exactKey)) return true
  if (state.subscriptionCounts.has(recursiveKey)) return true

  // Check if covered by parent recursive subscription
  const subs = Array.from(state.recursiveSubscriptions)
  for (let i = 0; i < subs.length; i++) {
    const sub = subs[i]!
    const prefix = sub.slice(0, -2) // Remove /*
    if (resource === prefix || resource.startsWith(prefix + '/')) {
      return true
    }
  }
  return false
}

function processEvents(events: Event[]) {
  for (const event of events) {
    const resource = extractResource(event)
    if (resource && isResourceSubscribed(resource)) {
      scheduleInvalidation(resource)
    }
  }
}

async function fetchNewEvents(): Promise<Event[]> {
  if (!state.lastEventId) {
    const response = await grpcClient.activityFeed.listEvents({
      pageSize: 1,
      filterEventType: ['Ref', 'Comment', 'Capability'],
    })
    if (response.events[0]) {
      state.lastEventId = getEventId(response.events[0])
    }
    return []
  }

  const eventsToProcess: Event[] = []
  let currentPageToken: string | undefined

  while (true) {
    const response = await grpcClient.activityFeed.listEvents({
      pageToken: currentPageToken,
      pageSize: ACTIVITY_PAGE_SIZE,
      filterEventType: ['Ref', 'Comment', 'Capability'],
    })

    for (const event of response.events) {
      const eventId = getEventId(event)
      if (eventId === state.lastEventId) {
        return eventsToProcess
      }
      eventsToProcess.push(event)
    }

    if (!response.nextPageToken) break
    currentPageToken = response.nextPageToken
  }

  return eventsToProcess
}

async function pollActivity() {
  if (state.isPolling) return
  state.isPolling = true

  try {
    const newEvents = await fetchNewEvents()
    if (newEvents.length > 0) {
      processEvents(newEvents)
      state.lastEventId = getEventId(newEvents[0]!)
    }
  } catch (error) {
    console.error('Sync poll error:', error)
  } finally {
    state.isPolling = false
  }
}

function ensureActivityPolling() {
  if (state.activityPollTimer) return
  state.activityPollTimer = setInterval(pollActivity, ACTIVITY_POLL_INTERVAL_MS)
  pollActivity()
}

function stopActivityPolling() {
  if (state.activityPollTimer) {
    clearInterval(state.activityPollTimer)
    state.activityPollTimer = null
  }
  if (state.debounceTimer) {
    clearTimeout(state.debounceTimer)
    state.debounceTimer = null
  }
}

// ============ Discovery ============

export async function discoverDocument(
  uid: string,
  path: string[] | null,
  version?: string | null,
  recursive?: boolean,
  onProgress?: (progress: DiscoveryProgress) => void,
) {
  const discoverRequest = {
    account: uid,
    path: hmIdPathToEntityQueryPath(path),
    version: version || undefined,
    recursive,
  } as const

  function checkDiscoverySuccess(discoverResp: {version: string}) {
    if (!version && discoverResp.version) return true
    if (version && version === discoverResp.version) return true
    return false
  }

  return await tryUntilSuccess(
    async () => {
      const discoverResp =
        await grpcClient.entities.discoverEntity(discoverRequest)
      if (discoverResp.progress && onProgress) {
        onProgress({
          blobsDiscovered: discoverResp.progress.blobsDiscovered,
          blobsDownloaded: discoverResp.progress.blobsDownloaded,
          blobsFailed: discoverResp.progress.blobsFailed,
        })
      }
      if (checkDiscoverySuccess(discoverResp))
        return {version: discoverResp.version}
      return null
    },
    {
      maxRetryMs: DISCOVERY_POLL_INTERVAL_MS,
      retryDelayMs: 2_000,
      immediateCatch: (e) => {
        const error = getErrorMessage(e)
        return error instanceof HMRedirectError
      },
    },
  )
}

async function runDiscovery(sub: ResourceSubscription) {
  const {id, recursive} = sub
  const discoveryStream = getOrCreateDiscoveryStream(id.id)

  const result = await discoverDocument(
    id.uid,
    id.path,
    undefined,
    recursive,
    (progress) => {
      discoveryStream.write({
        isDiscovering: true,
        startedAt: Date.now(),
        entityId: id.id,
        recursive,
        progress,
      })
      updateAggregatedDiscoveryState()
    },
  )

  // Only invalidate if the version has actually changed
  const newVersion = result?.version
  const lastKnownVersion = state.lastKnownVersions.get(id.id)

  const shouldInvalidate = newVersion && newVersion !== lastKnownVersion
  console.log(
    `[Discovery] ${id.id}: newVersion=${newVersion}, lastKnown=${lastKnownVersion}, shouldInvalidate=${shouldInvalidate}`,
  )

  if (shouldInvalidate) {
    // Update tracked version
    state.lastKnownVersions.set(id.id, newVersion)

    console.log(`[Discovery] Invalidating queries for ${id.id}`)
    // Invalidate relevant queries since data changed
    appInvalidateQueries([queryKeys.ENTITY, id.id])
    appInvalidateQueries([queryKeys.ACCOUNT, id.uid])
    appInvalidateQueries([queryKeys.RESOLVED_ENTITY, id.id])

    // Invalidate activity feed when an account (root document) is discovered
    // The feed contains pre-resolved account metadata, so when an account is discovered
    // the feed needs to refetch to show the proper account name/icon
    const isAccountDiscovery = !id.path?.length
    if (isAccountDiscovery) {
      appInvalidateQueries([queryKeys.ACTIVITY_FEED])
    }

    // For recursive subscriptions, also invalidate directory queries
    if (recursive) {
      appInvalidateQueries([queryKeys.DOC_LIST_DIRECTORY, id.id])
      getParentPaths(id.path).forEach((parentPath) => {
        const parentId = hmId(id.uid, {path: parentPath})
        appInvalidateQueries([queryKeys.DOC_LIST_DIRECTORY, parentId.id])
      })
      const rootId = hmId(id.uid)
      appInvalidateQueries([queryKeys.DOC_LIST_DIRECTORY, rootId.id])
    }
  }

  return result
}

// ============ Resource Subscriptions ============

function getSubscriptionKey(sub: ResourceSubscription): string {
  return sub.id.id + (sub.recursive ? '/*' : '')
}

function isEntityCoveredByRecursive(id: UnpackedHypermediaId): boolean {
  if (!id.path?.length) return false

  const basePath = `hm://${id.uid}`
  for (let i = 0; i <= id.path.length; i++) {
    const parentPath =
      i === 0
        ? `${basePath}/*`
        : `${basePath}/${id.path.slice(0, i).join('/')}/*`
    if (state.recursiveSubscriptions.has(parentPath)) {
      return true
    }
  }
  return false
}

function createSubscription(sub: ResourceSubscription): SubscriptionState {
  const {id, recursive} = sub
  const key = getSubscriptionKey(sub)

  // Track recursive subscriptions
  if (recursive) {
    state.recursiveSubscriptions.add(key)
  }

  // Check if covered by parent recursive subscription
  const isCovered = !recursive && isEntityCoveredByRecursive(id)

  // Set discovering state
  const discoveryStream = getOrCreateDiscoveryStream(id.id)
  if (!isCovered) {
    discoveryStream.write({
      isDiscovering: true,
      startedAt: Date.now(),
      entityId: id.id,
      recursive,
    })
  }

  let discoveryTimer: ReturnType<typeof setTimeout> | null = null

  function discoveryLoop() {
    if (isCovered) {
      discoveryTimer = setTimeout(discoveryLoop, DISCOVERY_POLL_INTERVAL_MS)
      return
    }

    runDiscovery(sub)
      .then(() => {
        discoveryStream.write(null)
        updateAggregatedDiscoveryState()
      })
      .catch(() => {
        // Keep discovering state on failure
      })
      .finally(() => {
        discoveryTimer = setTimeout(discoveryLoop, DISCOVERY_POLL_INTERVAL_MS)
      })
  }

  // Debounce initial discovery
  discoveryTimer = setTimeout(
    discoveryLoop,
    DISCOVERY_DEBOUNCE_MS + Math.random() * 100,
  )

  function unsubscribe() {
    if (discoveryTimer) clearTimeout(discoveryTimer)
    if (recursive) {
      state.recursiveSubscriptions.delete(key)
    }
    // Clean up tracked version
    state.lastKnownVersions.delete(id.id)
  }

  return {unsubscribe, discoveryTimer, isCovered}
}

export function subscribe(sub: ResourceSubscription): () => void {
  const key = getSubscriptionKey(sub)
  const currentCount = state.subscriptionCounts.get(key) || 0

  if (currentCount === 0) {
    state.subscriptions.set(key, createSubscription(sub))
    ensureActivityPolling()
  }

  state.subscriptionCounts.set(key, currentCount + 1)

  return function unsubscribe() {
    const count = state.subscriptionCounts.get(key) || 0
    if (count <= 1) {
      state.subscriptionCounts.delete(key)
      // Delay cleanup in case another subscription arrives quickly
      setTimeout(() => {
        if (!state.subscriptionCounts.has(key)) {
          const subState = state.subscriptions.get(key)
          subState?.unsubscribe()
          state.subscriptions.delete(key)

          if (state.subscriptions.size === 0) {
            stopActivityPolling()
          }
        }
      }, 300)
    } else {
      state.subscriptionCounts.set(key, count - 1)
    }
  }
}

export function getSubscriptionCount(): number {
  return state.subscriptions.size
}

// ============ tRPC API ============

// Schema for UnpackedHypermediaId - matches the one in hm-types.ts
const blockRangeSchema = z.object({
  start: z.number().optional(),
  end: z.number().optional(),
  expanded: z.boolean().optional(),
})

const unpackedHmIdSchema = z.object({
  id: z.string(),
  uid: z.string(),
  path: z.array(z.string()).nullable(),
  version: z.string().nullable(),
  blockRef: z.string().nullable(),
  blockRange: blockRangeSchema.nullable(),
  hostname: z.string().nullable(),
  scheme: z.string().nullable(),
  latest: z.boolean().nullable().optional(),
  targetDocUid: z.string().nullable().optional(),
  targetDocPath: z.array(z.string()).nullable().optional(),
})

export const syncApi = t.router({
  // Subscribe to a resource - starts discovery and activity polling
  subscribe: t.procedure
    .input(
      z.object({
        id: unpackedHmIdSchema,
        recursive: z.boolean().optional(),
      }),
    )
    .subscription(({input}) => {
      return observable<{status: 'subscribed' | 'unsubscribed'}>((emit) => {
        const unsubscribe = subscribe({
          id: input.id as UnpackedHypermediaId,
          recursive: input.recursive,
        })

        emit.next({status: 'subscribed'})

        return () => {
          unsubscribe()
          emit.next({status: 'unsubscribed'})
        }
      })
    }),

  // Subscribe to discovery state changes
  discoveryState: t.procedure
    .input(z.string())
    .subscription(({input: entityId}) => {
      return observable<DiscoveryState | null>((emit) => {
        const stream = getDiscoveryStream(entityId)
        const unsubscribe = stream.subscribe((state) => {
          emit.next(state)
        })
        // Emit initial state
        emit.next(stream.get())
        return unsubscribe
      })
    }),

  // Get aggregated discovery state
  getAggregatedState: t.procedure.query(() => {
    return aggregatedDiscoveryStream.get()
  }),

  // Subscribe to aggregated discovery state changes
  aggregatedState: t.procedure.subscription(() => {
    return observable<AggregatedDiscoveryState>((emit) => {
      const unsubscribe = aggregatedDiscoveryStream.subscribe((state) => {
        emit.next(state)
      })
      // Emit initial state
      emit.next(aggregatedDiscoveryStream.get())
      return unsubscribe
    })
  }),

  // Subscribe to list of active discoveries
  activeDiscoveries: t.procedure.subscription(() => {
    return observable<DiscoveryState[]>((emit) => {
      function emitActiveDiscoveries() {
        const active: DiscoveryState[] = []
        state.discoveryStreams.forEach(({stream}) => {
          const discoveryState = stream.get()
          if (discoveryState?.isDiscovering) {
            active.push(discoveryState)
          }
        })
        emit.next(active)
      }

      // Subscribe to aggregated state changes to know when to re-emit
      const unsubscribe = aggregatedDiscoveryStream.subscribe(() => {
        emitActiveDiscoveries()
      })

      // Emit initial state
      emitActiveDiscoveries()

      return unsubscribe
    })
  }),
})
