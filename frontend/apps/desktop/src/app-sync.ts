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
import {Event, FeedOrder} from '@shm/shared/client/.generated/activity/v1alpha/activity_pb'
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
import {isAnyWindowFocused, onAppFocusChange} from './app-focus'
import {appInvalidateQueries, getInvalidationTargetWindowCount} from './app-invalidation'
import {t} from './app-trpc'

// ============ Profile instrumentation ============

const PROFILE_ENABLED = process.env.SEED_SYNC_PROFILE === '1'
const INVALIDATION_LOG_ENABLED = PROFILE_ENABLED || process.env.SEED_INVALIDATION_LOG === '1'
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

/**
 * Discovery diagnostics. Always logs key transitions/errors with a `[discovery]` prefix so an operator can
 * trace why a clicked hm:// resource does or doesn't resolve. These run in the desktop MAIN process, so the
 * output appears in the terminal running the app (e.g. `./dev run-desktop`), not the renderer DevTools console.
 * Set SEED_DEBUG_DISCOVERY=1 to also log every per-poll discoverResource response (verbose).
 */
const DISCOVERY_VERBOSE = process.env.SEED_DEBUG_DISCOVERY === '1' || process.env.SEED_DEBUG_DISCOVERY === 'true'
// Generic per-resource discovery logging is OFF unless SEED_DEBUG_DISCOVERY is set — it fires for every
// subscribed resource on every poll and is far too noisy for normal use. Agent-referenced discovery has its
// own always-on `[agents-discovery]` log (see models/agents.ts).
function discoveryLog(message: string, fields?: Record<string, unknown>): void {
  if (!DISCOVERY_VERBOSE) return
  console.info(`[discovery] ${message}`, fields ?? {})
}
function discoveryWarn(message: string, fields?: Record<string, unknown>): void {
  if (!DISCOVERY_VERBOSE) return
  console.warn(`[discovery] ${message}`, fields ?? {})
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
  scope?: DiscoveryScope
}

type SubscriptionState = {
  unsubscribe: () => void
  discoveryTimer: ReturnType<typeof setTimeout> | null
  isCovered: boolean
}

type SyncState = {
  // Activity polling state
  lastBlobId: bigint
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
  lastBlobId: BigInt(0),
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

/** Extracts the resource IRI from a newBlob activity event (exported for testing). */
export function extractResource(event: Event): string | null {
  if (event.data.case === 'newBlob') {
    const resource = event.data.value.resource
    return resource.split('?')[0] || null
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
  const commentTargetIRIs: string[] = []
  const commentTargetIds = new Set<string>()
  const commentAuthorRootIds = new Set<string>()
  const capabilityData: {id: UnpackedHypermediaId; extraAttrs: string}[] = []
  const contactData: {author: string; extraAttrs: string}[] = []
  const refIds: UnpackedHypermediaId[] = []

  for (const event of events) {
    if (event.data.case !== 'newBlob') continue

    const resource = extractResource(event)
    if (resource && isResourceSubscribed(resource)) {
      scheduleInvalidation(resource)
    }

    const blobType = event.data.value.blobType?.toLowerCase()
    if (blobType) seenBlobTypes.add(blobType)

    if (blobType === 'comment') {
      const author = event.data.value.author
      if (author) commentAuthorRootIds.add(hmId(author).id)
      try {
        const attrs = JSON.parse(event.data.value.extraAttrs) as {target?: string}
        if (attrs.target) {
          commentTargetIRIs.push(attrs.target)
          const targetId = unpackHmId(attrs.target.split('?')[0] || '')
          if (targetId) commentTargetIds.add(targetId.id)
        }
      } catch {
        // extraAttrs missing or unparseable
      }
    }

    if (blobType === 'capability') {
      const res = event.data.value.resource
      if (res) {
        const id = unpackHmId(res.split('?')[0] || '')
        if (id) capabilityData.push({id, extraAttrs: event.data.value.extraAttrs})
      }
    }

    if (blobType === 'ref' && resource) {
      const id = unpackHmId(resource)
      if (id) refIds.push(id)
    }

    if (blobType === 'contact') {
      const author = event.data.value.author
      if (author) contactData.push({author, extraAttrs: event.data.value.extraAttrs})
    }
  }

  if (INVALIDATION_LOG_ENABLED && events.length > 0) {
    const typeCounts = Array.from(seenBlobTypes).map((blobType) => [
      blobType,
      events.filter((event) => event.data.case === 'newBlob' && event.data.value.blobType?.toLowerCase() === blobType)
        .length,
    ])
    console.log(
      `[SyncInvalidation] processEvents events=${events.length} types=${JSON.stringify(
        Object.fromEntries(typeCounts),
      )} subscribedPending=${state.pendingInvalidations.size} commentTargets=${commentTargetIRIs.length}`,
    )
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

  // Comment changes: keep object-shaped comment view keys broad, but target
  // string-keyed comment indexes when the activity event carries enough data.
  if (seenBlobTypes.has('comment')) {
    appInvalidateQueries([queryKeys.DOCUMENT_COMMENTS])
    appInvalidateQueries([queryKeys.DOCUMENT_DISCUSSION])
    appInvalidateQueries([queryKeys.BLOCK_DISCUSSIONS])
    if (commentTargetIds.size > 0) {
      commentTargetIds.forEach((id) => appInvalidateQueries([queryKeys.COMMENTS, id]))
    } else {
      appInvalidateQueries([queryKeys.COMMENTS])
    }
    if (commentAuthorRootIds.size > 0) {
      commentAuthorRootIds.forEach((id) => appInvalidateQueries([queryKeys.AUTHORED_COMMENTS, id]))
    } else {
      appInvalidateQueries([queryKeys.AUTHORED_COMMENTS])
    }
    appInvalidateQueries([queryKeys.COMMENT_VERSIONS])

    // Targeted DOCUMENT_INTERACTION_SUMMARY invalidation using `target` from extraAttrs.
    commentTargetIds.forEach((id) => {
      appInvalidateQueries([queryKeys.DOCUMENT_INTERACTION_SUMMARY, id])
    })
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

  // Document update changes: invalidate listing/library caches. Global library has
  // no account argument, but site-library and root-document caches can be targeted
  // from the Ref resource safely.
  if (seenBlobTypes.has('ref')) {
    appInvalidateQueries([queryKeys.LIBRARY])

    const siteUids = new Set<string>()
    let hasRootRef = false
    for (const id of refIds) {
      siteUids.add(id.uid)
      if ((id.path || []).length === 0) hasRootRef = true
    }
    if (siteUids.size > 0) {
      siteUids.forEach((uid) => appInvalidateQueries([queryKeys.SITE_LIBRARY, uid]))
    } else {
      appInvalidateQueries([queryKeys.SITE_LIBRARY])
      hasRootRef = true
    }

    if (hasRootRef) {
      appInvalidateQueries([queryKeys.LIST_ROOT_DOCUMENTS])
      appInvalidateQueries([queryKeys.ROOT_DOCUMENTS])
    }
  }

  // Citation invalidation: comments and refs can introduce new mentions/citations
  if (seenBlobTypes.has('comment') || seenBlobTypes.has('ref')) {
    appInvalidateQueries([queryKeys.CITATIONS])
    appInvalidateQueries([queryKeys.DOC_CITATIONS])
  }

  // Any feed-visible event type → invalidate feed caches once for the whole batch
  const feedTypes = ['comment', 'ref', 'capability', 'contact']
  if (feedTypes.some((t) => seenBlobTypes.has(t))) {
    appInvalidateQueries([queryKeys.ACTIVITY_FEED])
    appInvalidateQueries([queryKeys.FEED])
  }
}

/** Blob-only event types — excludes mentions (link types like comment/target, doc/embed). */
const ACTIVITY_BLOB_TYPES = ['Capability', 'Ref', 'Comment', 'DagPB', 'Profile', 'Contact']

/** Extract blobId from a newBlob event. Returns 0 for non-blob events. */
function getBlobId(event: Event): bigint {
  if (event.data.case === 'newBlob') return event.data.value.blobId
  return BigInt(0)
}

async function fetchNewEvents(): Promise<Event[]> {
  if (state.lastBlobId === BigInt(0)) {
    // First poll: set watermark so existing feed events are not replayed.
    const response = await grpcClient.activityFeed.listEvents({
      pageSize: 1,
      filterEventType: ACTIVITY_BLOB_TYPES,
      order: FeedOrder.OBSERVED_TIME,
    })
    const firstEvent = response.events[0]
    if (firstEvent) {
      state.lastBlobId = getBlobId(firstEvent)
    }
    // console.log('[Sync] Activity monitor watermark initialized', {
    //   watermarkBlobId: state.lastBlobId.toString(),
    // })
    return []
  }

  const eventsToProcess: Event[] = []
  let currentPageToken: string | undefined

  while (true) {
    const response = await grpcClient.activityFeed.listEvents({
      pageToken: currentPageToken,
      pageSize: ACTIVITY_PAGE_SIZE,
      filterEventType: ACTIVITY_BLOB_TYPES,
      order: FeedOrder.OBSERVED_TIME,
    })

    let reachedWatermark = false
    for (const event of response.events) {
      const blobId = getBlobId(event)
      if (blobId <= state.lastBlobId) {
        reachedWatermark = true
        break
      }
      eventsToProcess.push(event)
    }

    if (reachedWatermark) break
    if (!response.nextPageToken) break
    currentPageToken = response.nextPageToken
  }

  return eventsToProcess
}

const startTime = Date.now()
async function pollActivity() {
  if (state.isPolling) return
  state.isPolling = true

  try {
    await timeAsync('pollActivity', async () => {
      const newEvents = await fetchNewEvents()
      if (newEvents.length > 0) {
        const highestBlobId = getBlobId(newEvents[0]!)
        // console.log('[Sync] Activity poll found new events', {
        //   eventCount: newEvents.length,
        //   previousWatermarkBlobId: state.lastBlobId.toString(),
        //   nextWatermarkBlobId: highestBlobId.toString(),
        // })
        if (PROFILE_ENABLED) {
          profileLog(`pollActivity: ${newEvents.length} new events`)
        }
        processEvents(newEvents)
        state.lastBlobId = highestBlobId
      }
    })
  } catch (error) {
    console.error('Sync poll error:', error)
  } finally {
    state.isPolling = false
  }
}

function scheduleNextActivityPoll() {
  if (state.activityPollTimer) {
    clearTimeout(state.activityPollTimer)
  }
  state.activityPollTimer = setTimeout(() => {
    pollActivity().finally(() => {
      if (state.activityPollTimer !== null) {
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
  // console.log('[Sync] Starting activity monitor', {
  //   filterEventType: ACTIVITY_BLOB_TYPES,
  //   pageSize: ACTIVITY_PAGE_SIZE,
  //   intervalMs: getAdaptiveInterval(ACTIVITY_POLL_INTERVAL_MS),
  // })
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
    if (state.activityPollTimer && !state.isPolling) {
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

  if (DISCOVERY_VERBOSE) {
    discoveryLog('discoverDocument start', {id: discoverRequest.id, version: version || undefined, recursive, scope})
  }

  return await tryUntilSuccess(
    async () => {
      const discoverResp = await grpcClient.resources.discoverResource(discoverRequest)
      const progress = discoverResp.progress
      if (DISCOVERY_VERBOSE || discoverResp.lastError) {
        discoveryLog('discoverResource response', {
          id: discoverRequest.id,
          state: discoverResp.state,
          version: discoverResp.version || '(empty)',
          lastError: discoverResp.lastError || undefined,
          peersFound: progress?.peersFound,
          peersSyncedOk: progress?.peersSyncedOk,
          peersFailed: progress?.peersFailed,
          blobsDiscovered: progress?.blobsDiscovered,
          blobsDownloaded: progress?.blobsDownloaded,
          blobsFailed: progress?.blobsFailed,
        })
      }
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
      retryDelayMs: 2_000,
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
  const {id, recursive, scope} = sub
  const discoveryStream = getOrCreateDiscoveryStream(id.id)

  // Use effective recursive value - if any recursive subscription exists, report as recursive
  const getEffectiveRecursive = () => recursive || hasRecursiveSubscription(id.id)

  // Run discovery first (syncs data from network)
  let discoveryResult: {version: string} | null = null
  let blobsDownloaded = 0
  try {
    discoveryResult = await discoverDocument(
      id.uid,
      id.path,
      undefined,
      recursive,
      (progress) => {
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
      },
      scope,
    )
  } catch (e) {
    // Discovery failed (timeout, network error, etc.)
    // Check resource status anyway - data may have been synced.
    discoveryWarn('discoverDocument failed (will still check resource status)', {
      id: id.id,
      recursive: getEffectiveRecursive(),
      error: getErrorMessage(e),
    })
  }

  updateAggregatedDiscoveryState()

  // After discovery, check resource status via GetResource
  const status = await checkResourceStatus(id)
  discoveryLog('resource status after discovery', {
    id: id.id,
    status,
    discoveredVersion: discoveryResult?.version || undefined,
  })
  // if (!PROFILE_ENABLED) {
  //   console.log(`[Discovery] ${id.id}: status=${status}`)
  // }

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
  const scopeKey = sub.scope === 'profile' ? ':profile' : ''
  return sub.id.id + (sub.recursive ? '/*' : '') + scopeKey
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
  discoveryLog('subscribe', {id: id.id, recursive: !!recursive, scope: sub.scope ?? 'all'})

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
      .catch((error) => {
        if (cancelled) return
        // Keep discovering state and retry on errors — this is the path that keeps a resource stuck on a
        // loading spinner indefinitely, so surface it loudly.
        discoveryWarn('runDiscovery threw — keeping discovering state and retrying', {
          id: id.id,
          error: getErrorMessage(error),
        })
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
        scope: z.enum(['all', 'profile']).optional(),
      }),
    )
    .subscription(({input}) => {
      return observable<{status: 'subscribed' | 'unsubscribed'}>((emit) => {
        const unsubscribe = subscribe({
          id: input.id as UnpackedHypermediaId,
          recursive: input.recursive,
          scope: input.scope,
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
