import {grpcClient} from '@/grpc-client'
import {client} from '@/trpc'
import {toPlainMessage} from '@bufbuild/protobuf'
import {createTombstoneRef} from '@seed-hypermedia/client'
import {DiscoveryState, UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {createQueryResolver} from '@shm/shared/models/directory'
import {invalidateQueries} from '@shm/shared/models/query-client'
import {queryKeys} from '@shm/shared/models/query-keys'
import {useDeleteRecent} from '@shm/shared/models/recents'
import {createResourceFetcher} from '@shm/shared/resource-loader'
import {useUniversalClient} from '@shm/shared/routing'
import {getParentPaths} from '@shm/shared/utils/breadcrumbs'
import {hmId, unpackHmId} from '@shm/shared/utils/entity-id-url'
import {hmIdPathToEntityQueryPath} from '@shm/shared/utils/path-api'
import {StateStream, writeableStateStream} from '@shm/shared/utils/stream'
import {useMutation, UseMutationOptions, useQuery} from '@tanstack/react-query'
import {usePushResource} from './documents'
import {isThisWindowFocused, onThisWindowFocusChange} from './window-focus'

type DeleteEntitiesInput = {
  ids: UnpackedHypermediaId[]
  capabilityId?: string
  signingAccountUid: string
}

/**
 * Pushes deleted entity updates to peers without converting a successful local
 * delete into a failed mutation when propagation is unavailable.
 */
export async function pushDeletedEntitiesBestEffort(
  push: (id: UnpackedHypermediaId) => Promise<unknown>,
  ids: UnpackedHypermediaId[],
): Promise<void> {
  const results = await Promise.allSettled(
    ids.map(async (id) => {
      return push(id)
    }),
  )

  results.forEach((result, index) => {
    if (result.status === 'rejected') {
      console.error('Failed to push deleted entity update', ids[index].id, result.reason)
    }
  })
}

export function useDeleteEntities(opts: UseMutationOptions<void, unknown, DeleteEntitiesInput>) {
  const push = usePushResource()
  const deleteRecent = useDeleteRecent()
  const universalClient = useUniversalClient()
  return useMutation({
    ...opts,
    mutationFn: async ({ids, capabilityId, signingAccountUid}: DeleteEntitiesInput) => {
      if (!universalClient.getSigner) throw new Error('Signing not available')
      const signer = universalClient.getSigner(signingAccountUid)
      await Promise.all(
        ids.map(async (id) => {
          await deleteRecent.mutateAsync(id.id)
          const resource = await universalClient.request('Resource', id)
          if (resource.type !== 'document') throw new Error(`Cannot delete: resource is ${resource.type}`)
          const doc = resource.document
          const generation = doc.generationInfo ? Number(doc.generationInfo.generation) : 0
          const refInput = await createTombstoneRef(
            {
              space: id.uid || '',
              path: hmIdPathToEntityQueryPath(id.path),
              genesis: doc.genesis,
              generation,
              capability: capabilityId,
            },
            signer,
          )
          await universalClient.publish(refInput)
        }),
      )
      void pushDeletedEntitiesBestEffort(push, ids).catch((error) => {
        console.error('Failed to push deleted entity updates', error)
      })
    },
    onSuccess: (result: void, input: DeleteEntitiesInput, context) => {
      invalidateQueries([])
      input.ids.forEach((id) => {
        invalidateQueries([queryKeys.DOCUMENT_INTERACTION_SUMMARY, id.id])
        getParentPaths(id.path).forEach((path) => {
          const parentId = hmId(id.uid, {path})
          invalidateQueries([queryKeys.DOCUMENT_INTERACTION_SUMMARY, parentId.id])
        })
      })
      opts?.onSuccess?.(result, input, context)
    },
  })
}

export function useDeletedContent() {
  return useQuery({
    queryFn: async () => {
      const deleted = (await grpcClient.entities.listDeletedEntities({})).deletedEntities.map((d) => toPlainMessage(d))
      return deleted
    },
    queryKey: [queryKeys.DELETED],
  })
}

export function useUndeleteEntity(opts?: UseMutationOptions<void, unknown, {id: string}>) {
  const deleteRecent = useDeleteRecent()

  return useMutation({
    ...opts,
    mutationFn: async ({id}: {id: string}) => {
      await deleteRecent.mutateAsync(id)
      await grpcClient.entities.undeleteEntity({id})
    },
    onSuccess: (result: void, variables: {id: string}, context) => {
      const hmId = unpackHmId(variables.id)
      if (hmId) {
        invalidateQueries([queryKeys.ENTITY, variables.id])
        invalidateQueries([queryKeys.ACCOUNT, hmId.uid])
        invalidateQueries([queryKeys.RESOLVED_ENTITY, variables.id])
        invalidateQueries([queryKeys.ACCOUNT_DOCUMENTS])
        invalidateQueries([queryKeys.LIST_ACCOUNTS])
        invalidateQueries([queryKeys.ACCOUNT, hmId.uid])
        // for comments
        invalidateQueries([queryKeys.COMMENT, variables.id])
        invalidateQueries([queryKeys.DOCUMENT_DISCUSSION])
      }
      invalidateQueries([queryKeys.FEED])
      invalidateQueries([queryKeys.DOC_CITATIONS])
      invalidateQueries([queryKeys.SEARCH])
      invalidateQueries([queryKeys.DELETED])
      opts?.onSuccess?.(result, variables, context)
    },
  })
}

// Use shared resource fetcher
export const fetchResource = createResourceFetcher(grpcClient)

export const fetchQuery = createQueryResolver(grpcClient)

// Discovery state streams - one per entity ID, persists for the lifetime of
// the renderer process. The live tRPC update subscription is owned by the
// matching entity state (see `entityStates` below) so that multiple callers
// for the same entity share one update stream rather than racing each other.
const discoveryStreams = new Map<
  string,
  {
    write: (state: DiscoveryState | null) => void
    stream: StateStream<DiscoveryState | null>
  }
>()

function getOrCreateDiscoveryStream(entityId: string) {
  let entry = discoveryStreams.get(entityId)
  if (!entry) {
    const [write, stream] = writeableStateStream<DiscoveryState | null>(null)
    entry = {write, stream}
    discoveryStreams.set(entityId, entry)
  }
  return entry
}

export function getDiscoveryStream(entityId: string): StateStream<DiscoveryState | null> {
  return getOrCreateDiscoveryStream(entityId).stream
}

// Aggregated discovery state - subscribe to main process
const [writeAggregatedDiscovery, aggregatedDiscoveryStream] = writeableStateStream({
  activeCount: 0,
  tombstoneCount: 0,
  notFoundCount: 0,
  blobsDiscovered: 0,
  blobsDownloaded: 0,
  blobsFailed: 0,
})

let aggregatedStateSubscription: {unsubscribe: () => void} | null = null

function ensureAggregatedStateSubscription() {
  if (aggregatedStateSubscription) return
  aggregatedStateSubscription = client.sync.aggregatedState.subscribe(undefined, {
    onData: (state) => {
      writeAggregatedDiscovery(state)
    },
  })
}

export function getAggregatedDiscoveryStream() {
  ensureAggregatedStateSubscription()
  return aggregatedDiscoveryStream
}

// Active discoveries list - subscribe to main process
const [writeActiveDiscoveries, activeDiscoveriesStream] = writeableStateStream<DiscoveryState[]>([])

let activeDiscoveriesSubscription: {unsubscribe: () => void} | null = null

function ensureActiveDiscoveriesSubscription() {
  if (activeDiscoveriesSubscription) return
  activeDiscoveriesSubscription = client.sync.activeDiscoveries.subscribe(undefined, {
    onData: (discoveries) => {
      writeActiveDiscoveries(discoveries)
    },
  })
}

export function getActiveDiscoveriesStream() {
  ensureActiveDiscoveriesSubscription()
  return activeDiscoveriesStream
}

/** Clean up all renderer-side subscriptions. Call on window unload to prevent leaks. */
export function cleanupAllEntitySubscriptions() {
  // Clean up global lazy subscriptions
  if (aggregatedStateSubscription) {
    aggregatedStateSubscription.unsubscribe()
    aggregatedStateSubscription = null
  }
  if (activeDiscoveriesSubscription) {
    activeDiscoveriesSubscription.unsubscribe()
    activeDiscoveriesSubscription = null
  }

  // Tear down per-entity tRPC subs
  for (const state of entityStates.values()) {
    state.daemonSub?.unsubscribe()
    state.discoveryStateSub?.unsubscribe()
  }
  entityStates.clear()
  discoveryStreams.clear()
}

export type EntitySubscription = {
  id?: UnpackedHypermediaId | null
  recursive?: boolean
  /** `'high'` polls faster (3s while focused) for the active document. */
  priority?: 'normal' | 'high'
  /** Discovery scope. `'profile'` only fetches profile blobs (name + icon). */
  scope?: 'all' | 'profile'
}

// Entity subscription management - dedupes by entity ID across all callers.
//
// Why entity-ID-only (and not also recursive/priority/scope)?
//   - The daemon-side `subscribe` tRPC API only accepts `{id, recursive}`, and
//     internally collapses non-recursive subs that are covered by a parent
//     recursive sub. Priority and scope have no representation on the wire.
//   - When the dedup key included priority/scope, two callers for the same
//     entity (e.g. the resource page with priority 'high' and an embed with
//     priority 'normal') created separate ref-counted entries, separate tRPC
//     streams, and — worse — overwrote each other's discovery-state subscription
//     handle, leaking one of them and causing the shared stream entry to be
//     deleted out from under the still-active caller.
//   - Dedup by entity ID lets us run one tRPC sub and one discovery-state sub
//     per entity, and merge caller options (currently just `recursive`) up to
//     the strongest requested value. The daemon dedups again on its side.
type CallerOptions = {
  recursive: boolean
  priority: 'normal' | 'high'
  scope: 'all' | 'profile'
}

type EntityState = {
  id: UnpackedHypermediaId
  /** Map keyed by sub object identity so add/remove of the same caller pair correctly. */
  callers: Map<EntitySubscription, CallerOptions>
  daemonSub: {unsubscribe: () => void} | null
  discoveryStateSub: {unsubscribe: () => void} | null
  /** The recursive value currently applied to the daemon sub. */
  currentRecursive: boolean
}

const entityStates = new Map<string, EntityState>()

// Per-window pause state: when this renderer window has been blurred for
// longer than BLUR_PAUSE_GRACE_MS we tear down all of its outbound daemon
// subscriptions; on focus we re-issue them. The grace window absorbs quick
// alt-tabs without churning the daemon.
const BLUR_PAUSE_GRACE_MS = 30_000
let blurPauseTimer: ReturnType<typeof setTimeout> | null = null
let isPaused = false

/** Stream of current subscription display keys for the footer panel. */
const [writeSubscriptionKeys, subscriptionKeysStream] = writeableStateStream<string[]>([])

/** Returns the stream of current subscription display keys. */
export function getSubscriptionKeysStream(): StateStream<string[]> {
  return subscriptionKeysStream
}

function emitSubscriptionKeys() {
  const keys: string[] = []
  for (const state of entityStates.values()) {
    if (state.callers.size === 0) continue
    keys.push(state.id.id + (state.currentRecursive ? '/*' : ''))
  }
  keys.sort()
  writeSubscriptionKeys(keys)
}

function mergeCallerOptions(callers: Iterable<CallerOptions>): {recursive: boolean} {
  let recursive = false
  for (const c of callers) {
    if (c.recursive) {
      recursive = true
      break
    }
  }
  return {recursive}
}

function syncEntityState(state: EntityState) {
  if (state.callers.size === 0) {
    state.daemonSub?.unsubscribe()
    state.daemonSub = null
    state.discoveryStateSub?.unsubscribe()
    state.discoveryStateSub = null
    entityStates.delete(state.id.id)
    return
  }

  if (isPaused) {
    // Window-blurred: tear down outbound subs but keep callers and state so we
    // can resume on focus without losing the caller list.
    if (state.daemonSub) {
      state.daemonSub.unsubscribe()
      state.daemonSub = null
    }
    if (state.discoveryStateSub) {
      state.discoveryStateSub.unsubscribe()
      state.discoveryStateSub = null
    }
    return
  }

  const merged = mergeCallerOptions(state.callers.values())

  if (!state.daemonSub || state.currentRecursive !== merged.recursive) {
    // (Re)issue the daemon sub when the merged options change. This is the
    // only place we touch the daemon sub, so we never end up with two streams
    // racing for the same entity.
    state.daemonSub?.unsubscribe()
    state.daemonSub = client.sync.subscribe.subscribe(
      {
        id: state.id,
        recursive: merged.recursive,
      },
      {
        onData: () => {
          // Status updates handled by main process
        },
      },
    )
    state.currentRecursive = merged.recursive
  }

  if (!state.discoveryStateSub) {
    const stream = getOrCreateDiscoveryStream(state.id.id)
    const sub = client.sync.discoveryState.subscribe(state.id.id, {
      onData: (s) => stream.write(s),
    })
    state.discoveryStateSub = sub
  }
}

function syncAllEntityStates() {
  // Iterate over a snapshot — syncEntityState may delete from entityStates
  // when a state has zero callers.
  for (const state of Array.from(entityStates.values())) {
    syncEntityState(state)
  }
}

// Wire window focus to the pause flag. Module-level so the listener registers
// once per renderer process. Initial value reflects whether the window is
// focused at module load time.
if (typeof window !== 'undefined') {
  if (!isThisWindowFocused()) {
    // Started blurred — schedule the same grace timer we would on a transition.
    blurPauseTimer = setTimeout(() => {
      blurPauseTimer = null
      isPaused = true
      syncAllEntityStates()
    }, BLUR_PAUSE_GRACE_MS)
  }
  onThisWindowFocusChange((focused) => {
    if (focused) {
      if (blurPauseTimer) {
        clearTimeout(blurPauseTimer)
        blurPauseTimer = null
      }
      if (isPaused) {
        isPaused = false
        syncAllEntityStates()
      }
      return
    }
    if (blurPauseTimer) clearTimeout(blurPauseTimer)
    blurPauseTimer = setTimeout(() => {
      blurPauseTimer = null
      if (isPaused) return
      isPaused = true
      syncAllEntityStates()
    }, BLUR_PAUSE_GRACE_MS)
  })
}

export function addSubscribedEntity(sub: EntitySubscription) {
  if (!sub.id) return
  const entityId = sub.id.id

  let state = entityStates.get(entityId)
  if (!state) {
    state = {
      id: sub.id,
      callers: new Map(),
      daemonSub: null,
      discoveryStateSub: null,
      currentRecursive: false,
    }
    entityStates.set(entityId, state)
  }

  state.callers.set(sub, {
    recursive: !!sub.recursive,
    priority: sub.priority || 'normal',
    scope: sub.scope || 'all',
  })

  syncEntityState(state)
  emitSubscriptionKeys()
}

export function removeSubscribedEntity(sub: EntitySubscription) {
  if (!sub.id) return
  const entityId = sub.id.id
  const state = entityStates.get(entityId)
  if (!state) return

  state.callers.delete(sub)

  // Defer the actual sync so React 18 can batch cleanup+setup in the same
  // commit without churning the daemon subscription on rapid unmount/remount.
  // If a new caller is added before the microtask runs, the current sub stays
  // in place; if no caller arrives, the microtask tears it down.
  queueMicrotask(() => {
    const cur = entityStates.get(entityId)
    if (!cur) return
    syncEntityState(cur)
    emitSubscriptionKeys()
  })
}
