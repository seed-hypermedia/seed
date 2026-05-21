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
import {
  AggregatedDiscoveryState,
  DiscoveryProgress,
  DiscoveryState,
  UnpackedHypermediaId,
} from '@seed-hypermedia/client/hm-types'
import {Event} from '@shm/shared/client/.generated/activity/v1alpha/activity_pb'
import {DISCOVERY_DEBOUNCE_MS} from '@shm/shared/constants'
import {DiscoveryScope, discoveryUrl} from '@shm/shared/discovery'
import {getErrorMessage, HMRedirectError, HMResourceTombstoneError} from '@shm/shared/models/entity'
import {queryKeys} from '@shm/shared/models/query-keys'
import {createResourceFetcher} from '@shm/shared/resource-loader'
import {tryUntilSuccess} from '@shm/shared/try-until-success'
import {getParentPaths} from '@shm/shared/utils/breadcrumbs'
import {hmId, unpackHmId} from '@shm/shared/utils/entity-id-url'
import {StateStream, writeableStateStream} from '@shm/shared/utils/stream'
import {observable} from '@trpc/server/observable'
import z from 'zod'
import {broadcastReactiveEvent} from './app-events'
import {isAnyWindowFocused, onAppFocusChange} from './app-focus'
import {appInvalidateQueries, getInvalidationTargetWindowCount} from './app-invalidation'
import {t} from './app-trpc'

// ============ Profile instrumentation ============

const PROFILE_ENABLED = process.env.SEED_SYNC_PROFILE === '1'
const PROFILE_FRAME_THRESHOLD_MS = 16

function profileLog(msg: string) {
  if (PROFILE_ENABLED) console.log(`[SyncProfile] ${msg}`)
}

function timeSync<T>(label: string, fn: () => T): T {
  if (!PROFILE_ENABLED) return fn()
  const start = performance.now()
  try {
    return fn()
  } finally {
    const dur = performance.now() - start
    if (dur >= PROFILE_FRAME_THRESHOLD_MS) {
      console.log(`[SyncProfile] ${label} took ${dur.toFixed(2)}ms`)
    }
  }
}

async function timeAsync<T>(label: string, fn: () => Promise<T>): Promise<T> {
  if (!PROFILE_ENABLED) return fn()
  const start = performance.now()
  try {
    return await fn()
  } finally {
    const dur = performance.now() - start
    if (dur >= PROFILE_FRAME_THRESHOLD_MS) {
      console.log(`[SyncProfile] ${label} took ${dur.toFixed(2)}ms`)
    }
  }
}

// Polling intervals (base values, multiplied by getPollingMultiplier())
const DISCOVERY_POLL_INTERVAL_MS = 14_000
const ACTIVITY_POLL_INTERVAL_MS = 1_000
const DELETED_POLL_INTERVAL_MS = 60_000 // Slower polling for deleted/redirected resources

/** Returns 1 when app is focused, 10 when backgrounded. */
function getPollingMultiplier(): number {
  return isAnyWindowFocused() ? 1 : 10
}

/** Apply adaptive multiplier to a base interval. */
function getAdaptiveInterval(baseMs: number): number {
  return baseMs * getPollingMultiplier()
}

// Debounce window for batching invalidations
const INVALIDATION_DEBOUNCE_MS = 100

// Page size for fetching activity events
const ACTIVITY_PAGE_SIZE = 30

// Max entries for lastKnownVersions to prevent unbounded memory growth
const MAX_KNOWN_VERSIONS = 500

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
  activityPollTimer: ReturnType<typeof setTimeout> | null

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
const [writeAggregatedDiscovery, aggregatedDiscoveryStream] = writeableStateStream<AggregatedDiscoveryState>({
  activeCount: 0,
  tombstoneCount: 0,
  notFoundCount: 0,
  blobsDiscovered: 0,
  blobsDownloaded: 0,
  blobsFailed: 0,
})

// Resource fetcher for checking tombstone/redirect status
const fetchResource = createResourceFetcher(grpcClient)

async function checkResourceStatus(id: UnpackedHypermediaId): Promise<'ok' | 'tombstone' | 'redirect' | 'not-found'> {
  const resource = await fetchResource(id)
  if (resource.type === 'tombstone') return 'tombstone'
  if (resource.type === 'redirect') return 'redirect'
  if (resource.type === 'not-found') return 'not-found'
  return 'ok'
}

// ============ Discovery State Streams ============

function getOrCreateDiscoveryStream(entityId: string) {
  if (!state.discoveryStreams.has(entityId)) {
    const [write, stream] = writeableStateStream<DiscoveryState | null>(null)
    state.discoveryStreams.set(entityId, {write, stream})
  }
  return state.discoveryStreams.get(entityId)!
}

export function getDiscoveryStream(entityId: string): StateStream<DiscoveryState | null> {
  return getOrCreateDiscoveryStream(entityId).stream
}

export function getAggregatedDiscoveryStream(): StateStream<AggregatedDiscoveryState> {
  return aggregatedDiscoveryStream
}

function updateAggregatedDiscoveryState() {
  let activeCount = 0
  let tombstoneCount = 0
  let notFoundCount = 0
  let blobsDiscovered = 0
  let blobsDownloaded = 0
  let blobsFailed = 0

  state.discoveryStreams.forEach(({stream}) => {
    const discoveryState = stream.get()
    if (discoveryState?.isTombstone) {
      tombstoneCount++
    } else if (discoveryState?.isNotFound) {
      notFoundCount++
    } else if (discoveryState?.isDiscovering) {
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
    tombstoneCount,
    notFoundCount,
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
  if (PROFILE_ENABLED) {
    profileLog(
      `flushInvalidations: pending=${resources.length} subs=${
        state.subscriptions.size
      } windows=${getInvalidationTargetWindowCount()}`,
    )
  }
  timeSync('flushInvalidations', () => {
    for (let i = 0; i < resources.length; i++) {
      invalidateResource(resources[i]!)
    }
  })
  state.pendingInvalidations.clear()
}

function scheduleInvalidation(resource: string) {
  state.pendingInvalidations.add(resource)

  if (!state.debounceTimer) {
    state.debounceTimer = setTimeout(flushInvalidations, INVALIDATION_DEBOUNCE_MS)
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

/** Extracts the resource IRI from an activity event (exported for testing). */
export function extractResource(event: Event): string | null {
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

/**
 * Returns the unconditional query key invalidations that should fire for a given event,
 * regardless of subscription status. Exported for testing.
 */
export function getUnconditionalInvalidations(event: Event): Array<string[]> {
  const invalidations: Array<string[]> = []
  if (event.data.case !== 'newBlob') return invalidations

  const blobType = event.data.value.blobType?.toLowerCase()
  const resource = event.data.value.resource

  // Profile events blanket-invalidate account-derived queries (aliases make per-uid targeting unreliable)
  // and ripple through every surface that displays account-derived names/avatars.
  if (blobType === 'profile') {
    invalidations.push([queryKeys.ACCOUNT])
    invalidations.push([queryKeys.LIST_ACCOUNTS])
    invalidations.push([queryKeys.DOCUMENT_COLLABORATORS])
    invalidations.push([queryKeys.SEARCH])
    invalidations.push([queryKeys.ACTIVITY_FEED])
    invalidations.push([queryKeys.FEED])
    invalidations.push([queryKeys.LIBRARY])
    invalidations.push([queryKeys.SITE_LIBRARY])
    invalidations.push([queryKeys.LIST_ROOT_DOCUMENTS])
    invalidations.push([queryKeys.ROOT_DOCUMENTS])
  }

  if (blobType === 'capability' && resource) {
    const id = unpackHmId(resource.split('?')[0] || '')
    if (id) {
      invalidations.push([queryKeys.CAPABILITIES, id.uid])
      invalidations.push([queryKeys.DOCUMENT_COLLABORATORS, id.uid])
    }
  }

  return invalidations
}

/** Processes activity events and fires invalidations. Exported for testing. */
export function processEvents(events: Event[]) {
  return timeSync(`processEvents(${events.length})`, () => processEventsInner(events))
}

function processEventsInner(events: Event[]) {
  // ── First pass: collect event data for batched invalidation ──
  const seenBlobTypes = new Set<string>()
  const commentCids: string[] = []
  const capabilityData: {id: UnpackedHypermediaId; extraAttrs: string}[] = []
  const contactData: {author: string; extraAttrs: string}[] = []
  let hasMentions = false

  for (const event of events) {
    // Subscribed-resource invalidation (debounced via scheduleInvalidation)
    const resource = extractResource(event)
    if (resource && isResourceSubscribed(resource)) {
      console.log(`[Sync] Invalidating ${event.data.case}: ${resource}`)
      scheduleInvalidation(resource)
    }

    if (event.data.case === 'newBlob') {
      const blobType = event.data.value.blobType?.toLowerCase()
      if (blobType) seenBlobTypes.add(blobType)

      if (blobType === 'comment') {
        const cid = event.data.value.cid
        if (cid) commentCids.push(cid)
      }

      if (blobType === 'capability') {
        const res = event.data.value.resource
        if (res) {
          const id = unpackHmId(res.split('?')[0] || '')
          if (id) capabilityData.push({id, extraAttrs: event.data.value.extraAttrs})
        }
      }

      if (blobType === 'contact') {
        const author = event.data.value.author
        if (author) contactData.push({author, extraAttrs: event.data.value.extraAttrs})
      }
    }

    if (event.data.case === 'newMention') {
      hasMentions = true
    }
  }

  // ── Second pass: batched invalidations by event type ──

  // Profile changes: blanket-invalidate all account-derived queries, plus every
  // surface that shows account-derived names/avatars (search/mention picker, feed,
  // library). We can't target specific UIDs because accounts may be aliases (A→B):
  // when B updates, [ACCOUNT, A] must also be invalidated since it resolves to B's data.
  // A blanket [ACCOUNT] prefix invalidation catches all aliases.
  if (seenBlobTypes.has('profile')) {
    appInvalidateQueries([queryKeys.ACCOUNT])
    appInvalidateQueries([queryKeys.LIST_ACCOUNTS])
    appInvalidateQueries([queryKeys.DOCUMENT_COLLABORATORS])
    appInvalidateQueries([queryKeys.SEARCH])
    appInvalidateQueries([queryKeys.ACTIVITY_FEED])
    appInvalidateQueries([queryKeys.FEED])
    appInvalidateQueries([queryKeys.LIBRARY])
    appInvalidateQueries([queryKeys.SITE_LIBRARY])
    appInvalidateQueries([queryKeys.LIST_ROOT_DOCUMENTS])
    appInvalidateQueries([queryKeys.ROOT_DOCUMENTS])
  }

  // Comment changes: invalidate all comment-related caches once (not per-event)
  if (seenBlobTypes.has('comment')) {
    appInvalidateQueries([queryKeys.DOCUMENT_COMMENTS])
    appInvalidateQueries([queryKeys.DOCUMENT_DISCUSSION])
    appInvalidateQueries([queryKeys.BLOCK_DISCUSSIONS])
    appInvalidateQueries([queryKeys.COMMENTS])
    appInvalidateQueries([queryKeys.AUTHORED_COMMENTS])
    appInvalidateQueries([queryKeys.COMMENT_VERSIONS])

    // Async batch: look up comment targets for targeted DOCUMENT_INTERACTION_SUMMARY invalidation.
    // All CIDs are fetched in parallel; results are deduplicated by target doc before invalidating.
    if (commentCids.length > 0) {
      Promise.allSettled(commentCids.map((cid) => grpcClient.comments.getComment({id: cid}))).then((results) => {
        const targetIds = new Set<string>()
        for (const result of results) {
          if (result.status === 'fulfilled' && result.value.targetAccount) {
            const targetId = hmId(result.value.targetAccount, {
              path: result.value.targetPath?.split('/').filter(Boolean) || null,
            })
            targetIds.add(targetId.id)
          }
        }
        targetIds.forEach((id) => {
          appInvalidateQueries([queryKeys.DOCUMENT_INTERACTION_SUMMARY, id])
        })
      })
    }
  }

  // Capability changes: invalidate target + ancestor capabilities/collaborators
  if (seenBlobTypes.has('capability')) {
    for (const {id, extraAttrs} of capabilityData) {
      appInvalidateQueries([queryKeys.CAPABILITIES, id.uid, ...(id.path || [])])
      appInvalidateQueries([queryKeys.DOCUMENT_COLLABORATORS, id.uid, ...(id.path || [])])
      getParentPaths(id.path).forEach((parentPath) => {
        appInvalidateQueries([queryKeys.CAPABILITIES, id.uid, ...parentPath])
        appInvalidateQueries([queryKeys.DOCUMENT_COLLABORATORS, id.uid, ...parentPath])
      })
      appInvalidateQueries([queryKeys.CAPABILITIES, id.uid])
      appInvalidateQueries([queryKeys.DOCUMENT_COLLABORATORS, id.uid])

      if (extraAttrs) {
        try {
          const attrs = JSON.parse(extraAttrs) as {del?: string}
          if (attrs.del) {
            appInvalidateQueries([queryKeys.ACCOUNT_CAPABILITIES, attrs.del])
          }
        } catch {
          // Ignore JSON parse errors
        }
      }
    }
  }

  // Contact changes: invalidate contact caches + search/library (contacts carry
  // display-name aliases shown in mention pickers and library author columns) +
  // async subject lookup. Feed is already invalidated via `feedTypes` below.
  // Also blanket-invalidate collaborator lists because site membership is derived from contacts.
  //
  // Blanket [CONTACTS_SUBJECT] covers site members (useSiteMembers reads
  // useContactListOfSubject(siteUid)) and follower lists (useContactListOfSubject(accountUid))
  // without depending on the async getContact below — extraAttrs carries the subject as
  // an internal pubkey row ID, not a usable uid, so we can't target sync.
  if (seenBlobTypes.has('contact')) {
    appInvalidateQueries([queryKeys.DOCUMENT_COLLABORATORS])
    appInvalidateQueries([queryKeys.SEARCH])
    appInvalidateQueries([queryKeys.LIBRARY])
    appInvalidateQueries([queryKeys.SITE_LIBRARY])
    appInvalidateQueries([queryKeys.CONTACTS_SUBJECT])
    for (const {author, extraAttrs} of contactData) {
      appInvalidateQueries([queryKeys.CONTACTS_ACCOUNT, author])

      if (extraAttrs) {
        try {
          const parsed = JSON.parse(extraAttrs) as {tsid?: string}
          if (parsed.tsid) {
            const contactId = `${author}/${parsed.tsid}`
            grpcClient.documents
              .getContact({id: contactId})
              .then((contact) => {
                if (contact.subject) {
                  appInvalidateQueries([queryKeys.CONTACTS_SUBJECT, contact.subject])
                  appInvalidateQueries([queryKeys.DOCUMENT_COLLABORATORS, contact.subject])
                }
              })
              .catch(() => {})
          }
        } catch {
          // Ignore JSON parse errors
        }
      }
    }
  }

  // Document update changes: invalidate listing/library caches
  if (seenBlobTypes.has('ref')) {
    appInvalidateQueries([queryKeys.LIBRARY])
    appInvalidateQueries([queryKeys.SITE_LIBRARY])
    appInvalidateQueries([queryKeys.LIST_ROOT_DOCUMENTS])
    appInvalidateQueries([queryKeys.ROOT_DOCUMENTS])
  }

  // Citation/mention changes
  if (hasMentions) {
    appInvalidateQueries([queryKeys.CITATIONS])
    appInvalidateQueries([queryKeys.DOC_CITATIONS])
  }

  // Any feed-visible event type → invalidate feed caches once for the whole batch
  const feedTypes = ['comment', 'ref', 'capability', 'contact']
  if (feedTypes.some((t) => seenBlobTypes.has(t)) || hasMentions) {
    appInvalidateQueries([queryKeys.ACTIVITY_FEED])
    appInvalidateQueries([queryKeys.FEED])
  }
}

// Poll the activity feed without a type filter. Subscribed-resource invalidation
// depends on seeing every new resource-related blob, not just feed-visible types.
const ACTIVITY_EVENT_FILTER = 'all'

async function fetchNewEvents(): Promise<Event[]> {
  if (!state.lastEventId) {
    // First poll: set a watermark so existing feed events are not replayed.
    const response = await grpcClient.activityFeed.listEvents({
      pageSize: ACTIVITY_PAGE_SIZE,
    })
    if (response.events[0]) {
      state.lastEventId = getEventId(response.events[0])
    }
    console.log('[Sync] Activity monitor watermark initialized; existing feed events will not be replayed', {
      eventCount: response.events.length,
      filterEventType: ACTIVITY_EVENT_FILTER,
      pageSize: ACTIVITY_PAGE_SIZE,
      watermarkEventId: state.lastEventId,
    })
    if (response.nextPageToken) {
      console.log('[Sync] Initial activity poll returned a truncated page while setting the watermark', {
        pageSize: ACTIVITY_PAGE_SIZE,
        eventCount: response.events.length,
        newestEventId: state.lastEventId,
      })
    }
    return []
  }

  const eventsToProcess: Event[] = []
  let currentPageToken: string | undefined

  while (true) {
    const response = await grpcClient.activityFeed.listEvents({
      pageToken: currentPageToken,
      pageSize: ACTIVITY_PAGE_SIZE,
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
    await timeAsync('pollActivity', async () => {
      const newEvents = await fetchNewEvents()
      if (newEvents.length > 0) {
        console.log('[Sync] Activity poll found new events', {
          eventCount: newEvents.length,
          previousWatermarkEventId: state.lastEventId,
          nextWatermarkEventId: getEventId(newEvents[0]!),
          filterEventType: ACTIVITY_EVENT_FILTER,
        })
        if (PROFILE_ENABLED) {
          profileLog(`pollActivity: ${newEvents.length} new events`)
        }
        processEvents(newEvents)
        state.lastEventId = getEventId(newEvents[0]!)
      }
    })
  } catch (error) {
    console.error('Sync poll error:', error)
  } finally {
    state.isPolling = false
  }
}

function scheduleNextActivityPoll() {
  state.activityPollTimer = setTimeout(() => {
    pollActivity().finally(() => {
      if (state.activityPollTimer) {
        scheduleNextActivityPoll()
      }
    })
  }, getAdaptiveInterval(ACTIVITY_POLL_INTERVAL_MS))
}

function ensureActivityPolling() {
  if (state.activityPollTimer) return
  // Set a placeholder before starting the async poll so concurrent subscriptions
  // in the same tick cannot double-start the monitor.
  state.activityPollTimer = setTimeout(() => {}, 0)
  ensureFocusListener()
  console.log('[Sync] Starting activity monitor', {
    filterEventType: ACTIVITY_EVENT_FILTER,
    pageSize: ACTIVITY_PAGE_SIZE,
    intervalMs: getAdaptiveInterval(ACTIVITY_POLL_INTERVAL_MS),
  })
  pollActivity().finally(() => {
    if (state.activityPollTimer !== null || state.subscriptions.size > 0) {
      scheduleNextActivityPoll()
    }
  })
}

function stopActivityPolling() {
  if (state.activityPollTimer) {
    clearTimeout(state.activityPollTimer)
    state.activityPollTimer = null
  }
  if (state.debounceTimer) {
    clearTimeout(state.debounceTimer)
    state.debounceTimer = null
  }
}

// When app focus changes, restart polling timer with new interval
let _focusCleanup: (() => void) | null = null
function ensureFocusListener() {
  if (_focusCleanup) return
  _focusCleanup = onAppFocusChange(() => {
    // Restart activity polling timer with updated multiplier
    if (state.activityPollTimer) {
      clearTimeout(state.activityPollTimer)
      scheduleNextActivityPoll()
    }
  })
}

// ============ Discovery ============

export async function discoverDocument(
  uid: string,
  path: string[] | null,
  version?: string | null,
  recursive?: boolean,
  onProgress?: (progress: DiscoveryProgress) => void,
  scope: DiscoveryScope = 'all',
) {
  const discoverRequest = {
    id: discoveryUrl({
      uid,
      path,
      recursion: recursive ? 'descendants' : 'none',
      scope,
    }),
    version: version || undefined,
  } as const

  function checkDiscoverySuccess(discoverResp: {version: string}) {
    if (!version && discoverResp.version) return true
    if (version && version === discoverResp.version) return true
    return false
  }

  return await tryUntilSuccess(
    async () => {
      const discoverResp = await grpcClient.entities.discoverEntity(discoverRequest)
      if (discoverResp.progress && onProgress) {
        onProgress({
          blobsDiscovered: discoverResp.progress.blobsDiscovered,
          blobsDownloaded: discoverResp.progress.blobsDownloaded,
          blobsFailed: discoverResp.progress.blobsFailed,
        })
      }
      if (checkDiscoverySuccess(discoverResp)) return {version: discoverResp.version}
      return null
    },
    {
      maxRetryMs: DISCOVERY_POLL_INTERVAL_MS,
      retryDelayMs: 250,
      immediateCatch: (e) => {
        const error = getErrorMessage(e)
        return error instanceof HMRedirectError || error instanceof HMResourceTombstoneError
      },
    },
  )
}

type DiscoveryResult = {
  version?: string
  isTombstone?: boolean
  isRedirect?: boolean
  isNotFound?: boolean
}

async function runDiscovery(sub: ResourceSubscription): Promise<DiscoveryResult | null> {
  const {id, recursive} = sub
  const discoveryStream = getOrCreateDiscoveryStream(id.id)

  // Use effective recursive value - if any recursive subscription exists, report as recursive
  const getEffectiveRecursive = () => recursive || hasRecursiveSubscription(id.id)

  // Run discovery first (syncs data from network)
  let discoveryResult: {version: string} | null = null
  let blobsDownloaded = 0
  try {
    discoveryResult = await discoverDocument(id.uid, id.path, undefined, recursive, (progress) => {
      blobsDownloaded = progress.blobsDownloaded
      // Don't overwrite settled state (not-found/tombstone) with discovering
      const currentState = discoveryStream.stream.get()
      if (currentState?.isNotFound || currentState?.isTombstone) return

      discoveryStream.write({
        isDiscovering: true,
        startedAt: Date.now(),
        entityId: id.id,
        recursive: getEffectiveRecursive(),
        progress,
      })

      // Reactive bus: notify renderers a discovery tick happened for this entity.
      // Renderers can subscribe to DISCOVERY:<id> on the reactive bus and update UI without polling.
      broadcastReactiveEvent({
        topic: `DISCOVERY:${id.id}`,
        hint: progress,
      })
    })
  } catch (e) {
    // Discovery failed (timeout, network error, etc.)
    // Check resource status anyway - data may have been synced
    console.log(`[Discovery] ${id.id}: discovery error, checking resource status`)
  }

  updateAggregatedDiscoveryState()

  // After discovery, check resource status via GetResource
  const status = await checkResourceStatus(id)
  if (!PROFILE_ENABLED) {
    console.log(`[Discovery] ${id.id}: status=${status}`)
  }

  // Get current stream state to detect transitions
  const currentState = discoveryStream.stream.get()
  const {isNotFound, isTombstone, isDiscovering} = currentState ?? {}

  if (status === 'tombstone') {
    // Resource is deleted - update stream
    discoveryStream.write({
      isDiscovering: false,
      isTombstone: true,
      startedAt: Date.now(),
      entityId: id.id,
      recursive: getEffectiveRecursive(),
    })
    return {isTombstone: true}
  }

  if (status === 'redirect') {
    // Resource redirects - clear stream
    discoveryStream.write(null)
    return {isRedirect: true}
  }

  if (status === 'not-found') {
    // Resource not found - update stream (no loading spinner)
    discoveryStream.write({
      isDiscovering: false,
      isNotFound: true,
      startedAt: Date.now(),
      entityId: id.id,
      recursive: getEffectiveRecursive(),
    })
    return {isNotFound: true}
  }

  // Resource exists - clear stream
  if (isNotFound || isTombstone || isDiscovering) {
    discoveryStream.write(null)
  }

  return discoveryResult
}

// ============ Resource Subscriptions ============

function getSubscriptionKey(sub: ResourceSubscription): string {
  return sub.id.id + (sub.recursive ? '/*' : '')
}

// Check if there's a recursive subscription for this entity (used for stream writes)
function hasRecursiveSubscription(entityId: string): boolean {
  return state.recursiveSubscriptions.has(`${entityId}/*`)
}

function isEntityCoveredByRecursive(id: UnpackedHypermediaId): boolean {
  if (!id.path?.length) return false

  const basePath = `hm://${id.uid}`
  for (let i = 0; i <= id.path.length; i++) {
    const parentPath = i === 0 ? `${basePath}/*` : `${basePath}/${id.path.slice(0, i).join('/')}/*`
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

  // Check if covered by parent recursive subscription OR same entity has recursive subscription
  const sameEntityRecursiveKey = `${id.id}/*`
  const isCovered =
    !recursive && (isEntityCoveredByRecursive(id) || state.recursiveSubscriptions.has(sameEntityRecursiveKey))

  // Check current stream state - if already settled, preserve that state
  const discoveryStream = getOrCreateDiscoveryStream(id.id)
  const currentState = discoveryStream.stream.get()
  const isSettled = currentState?.isNotFound || currentState?.isTombstone

  if (!isCovered && !isSettled) {
    // Unknown resource - start discovery
    discoveryStream.write({
      isDiscovering: true,
      startedAt: Date.now(),
      entityId: id.id,
      recursive: recursive || hasRecursiveSubscription(id.id),
    })
  }
  // If already settled (isNotFound or isTombstone), keep existing state - no need to rewrite

  let cancelled = false
  let discoveryTimer: ReturnType<typeof setTimeout> | null = null

  function discoveryLoop() {
    if (cancelled) return

    // Re-check if now covered (a recursive subscription may have been added after we started)
    const sameEntityRecursiveKey = `${id.id}/*`
    const nowCovered =
      !recursive && (isEntityCoveredByRecursive(id) || state.recursiveSubscriptions.has(sameEntityRecursiveKey))

    if (nowCovered) {
      // Defer to the recursive subscription
      discoveryTimer = setTimeout(discoveryLoop, getAdaptiveInterval(DISCOVERY_POLL_INTERVAL_MS))
      return
    }

    runDiscovery(sub)
      .then((result) => {
        if (cancelled) return

        // For settled resources (tombstone/redirect/not-found), use slower polling
        // (the stream state is already set by runDiscovery)
        if (result?.isTombstone || result?.isRedirect || result?.isNotFound) {
          discoveryTimer = setTimeout(discoveryLoop, getAdaptiveInterval(DELETED_POLL_INTERVAL_MS))
          return
        }

        // Normal resource - clear discovering state
        discoveryStream.write(null)
        updateAggregatedDiscoveryState()
        discoveryTimer = setTimeout(discoveryLoop, getAdaptiveInterval(DISCOVERY_POLL_INTERVAL_MS))
      })
      .catch(() => {
        if (cancelled) return
        // Keep discovering state and retry on errors
        discoveryTimer = setTimeout(discoveryLoop, getAdaptiveInterval(DISCOVERY_POLL_INTERVAL_MS))
      })
  }

  // Debounce initial discovery
  discoveryTimer = setTimeout(discoveryLoop, DISCOVERY_DEBOUNCE_MS + Math.random() * 100)

  function unsubscribe() {
    cancelled = true
    if (discoveryTimer) clearTimeout(discoveryTimer)
    if (recursive) {
      state.recursiveSubscriptions.delete(key)
    }
    // Clean up version tracking (discovery stream state persists for settled resources)
    state.lastKnownVersions.delete(id.id)
  }

  return {unsubscribe, discoveryTimer, isCovered}
}

function logSubscriptions() {
  // console.log('[Sync] Subscribed entities:', Array.from(state.subscriptions.keys()))
}

export function subscribe(sub: ResourceSubscription): () => void {
  const key = getSubscriptionKey(sub)
  const currentCount = state.subscriptionCounts.get(key) || 0

  if (currentCount === 0) {
    // Clean up any existing subscription to prevent stacking
    const existing = state.subscriptions.get(key)
    if (existing) existing.unsubscribe()

    state.subscriptions.set(key, createSubscription(sub))
    ensureActivityPolling()
    logSubscriptions()
  }

  state.subscriptionCounts.set(key, currentCount + 1)

  return function unsubscribe() {
    const count = state.subscriptionCounts.get(key) || 0
    if (count <= 1) {
      state.subscriptionCounts.delete(key)
      const subState = state.subscriptions.get(key)
      subState?.unsubscribe()
      state.subscriptions.delete(key)

      // Clean up discovery stream to prevent memory leak
      state.discoveryStreams.delete(sub.id.id)

      if (state.subscriptions.size === 0) {
        stopActivityPolling()
      }
      logSubscriptions()
    } else {
      state.subscriptionCounts.set(key, count - 1)
    }
  }
}

export function getSubscriptionCount(): number {
  return state.subscriptions.size
}

export function getDiscoveryStreamCount(): number {
  return state.discoveryStreams.size
}

// Memory monitor stats
export function getSyncStats() {
  return {
    subscriptions: state.subscriptions.size,
    subscriptionCounts: state.subscriptionCounts.size,
    recursiveSubscriptions: state.recursiveSubscriptions.size,
    discoveryStreams: state.discoveryStreams.size,
    lastKnownVersions: state.lastKnownVersions.size,
    pendingInvalidations: state.pendingInvalidations.size,
    hasActivityPollTimer: state.activityPollTimer !== null,
    hasDebounceTimer: state.debounceTimer !== null,
  }
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
  discoveryState: t.procedure.input(z.string()).subscription(({input: entityId}) => {
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
