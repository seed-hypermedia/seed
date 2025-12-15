import {grpcClient} from '@/grpc-client'
import {toPlainMessage} from '@bufbuild/protobuf'
import {DiscoverEntityResponse} from '@shm/shared'
import {DISCOVERY_DEBOUNCE_MS} from '@shm/shared/constants'
import {
  AggregatedDiscoveryState,
  DiscoveryProgress,
  DiscoveryState,
  HMResource,
  UnpackedHypermediaId,
} from '@shm/shared/hm-types'
import {createQueryResolver} from '@shm/shared/models/directory'
import {
  createBatchAccountsResolver,
  getErrorMessage,
  HMRedirectError,
} from '@shm/shared/models/entity'
import {invalidateQueries, queryClient} from '@shm/shared/models/query-client'
import {queryKeys} from '@shm/shared/models/query-keys'
import {useDeleteRecent} from '@shm/shared/models/recents'
import {createResourceFetcher} from '@shm/shared/resource-loader'
import {tryUntilSuccess} from '@shm/shared/try-until-success'
import {hmId, unpackHmId} from '@shm/shared/utils/entity-id-url'
import {getParentPaths} from '@shm/shared/utils/breadcrumbs'
import {hmIdPathToEntityQueryPath} from '@shm/shared/utils/path-api'
import {StateStream, writeableStateStream} from '@shm/shared/utils/stream'
import {useMutation, UseMutationOptions, useQuery} from '@tanstack/react-query'
import {usePushResource} from './documents'

type DeleteEntitiesInput = {
  ids: UnpackedHypermediaId[]
  capabilityId?: string
  signingAccountUid: string
}

const DISCOVERY_POLL_INTERVAL_MS = 3_000 // 3 seconds

export function useDeleteEntities(
  opts: UseMutationOptions<void, unknown, DeleteEntitiesInput>,
) {
  const push = usePushResource()
  const deleteRecent = useDeleteRecent()
  return useMutation({
    ...opts,
    mutationFn: async ({
      ids,
      capabilityId,
      signingAccountUid,
    }: DeleteEntitiesInput) => {
      await Promise.all(
        ids.map(async (id) => {
          await deleteRecent.mutateAsync(id.id)
          await grpcClient.documents.createRef({
            account: id.uid || '',
            path: hmIdPathToEntityQueryPath(id.path),
            signingKeyName: signingAccountUid,
            capability: capabilityId,
            target: {target: {case: 'tombstone', value: {}}},
          })
        }),
      )
      await Promise.all(ids.map((id) => push(id)))
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
      const deleted = (
        await grpcClient.entities.listDeletedEntities({})
      ).deletedEntities.map((d) => toPlainMessage(d))
      return deleted
    },
    queryKey: [queryKeys.DELETED],
  })
}

export function useUndeleteEntity(
  opts?: UseMutationOptions<void, unknown, {id: string}>,
) {
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

function catchNotFound<Result>(
  promise: Promise<Result>,
): Promise<Result | null> {
  return promise.catch((error) => {
    // if (isActuallyNotFound) throw error;
    return null
  })
}

// Use shared resource fetcher
export const fetchResource = createResourceFetcher(grpcClient)

export const fetchBatchAccounts = createBatchAccountsResolver(grpcClient)

export const fetchQuery = createQueryResolver(grpcClient)

export type EntitySubscription = {
  id?: UnpackedHypermediaId | null
  recursive?: boolean
}

// Discovery state tracking with StateStream
const discoveryStreams = new Map<
  string,
  {
    write: (state: DiscoveryState | null) => void
    stream: StateStream<DiscoveryState | null>
  }
>()

// Track which entities have active recursive subscriptions
const recursiveSubscriptions = new Set<string>()

function getOrCreateDiscoveryStream(entityId: string) {
  if (!discoveryStreams.has(entityId)) {
    const [write, stream] = writeableStateStream<DiscoveryState | null>(null)
    discoveryStreams.set(entityId, {write, stream})
  }
  return discoveryStreams.get(entityId)!
}

export function getDiscoveryStream(
  entityId: string,
): StateStream<DiscoveryState | null> {
  return getOrCreateDiscoveryStream(entityId).stream
}

// Aggregated discovery state across all entities
const [writeAggregatedDiscovery, aggregatedDiscoveryStream] =
  writeableStateStream<AggregatedDiscoveryState>({
    activeCount: 0,
    blobsDiscovered: 0,
    blobsDownloaded: 0,
    blobsFailed: 0,
  })

export function getAggregatedDiscoveryStream(): StateStream<AggregatedDiscoveryState> {
  return aggregatedDiscoveryStream
}

function updateAggregatedDiscoveryState() {
  let activeCount = 0
  let blobsDiscovered = 0
  let blobsDownloaded = 0
  let blobsFailed = 0

  discoveryStreams.forEach(({stream}) => {
    const state = stream.get()
    if (state?.isDiscovering) {
      activeCount++
      if (state.progress) {
        blobsDiscovered += state.progress.blobsDiscovered
        blobsDownloaded += state.progress.blobsDownloaded
        blobsFailed += state.progress.blobsFailed
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

// Check if entity is covered by a parent's recursive subscription
function isEntityCoveredByRecursive(id: UnpackedHypermediaId): boolean {
  if (!id.path?.length) return false

  // Build all parent paths and check if any have recursive subscription
  // e.g., for uid/foo/bar/baz, check hm://uid/*, hm://uid/foo/*, hm://uid/foo/bar/*
  const basePath = `hm://${id.uid}`
  for (let i = 0; i <= id.path.length; i++) {
    const parentPath =
      i === 0
        ? `${basePath}/*`
        : `${basePath}/${id.path.slice(0, i).join('/')}/*`
    if (recursiveSubscriptions.has(parentPath)) {
      return true
    }
  }
  return false
}

function discoveryResultWithLatestVersion(
  id: UnpackedHypermediaId,
  version: string,
) {
  const lastEntity = queryClient.getQueryData<HMResource | null>([
    queryKeys.ENTITY,
    id.id,
    undefined, // this signifies the "latest" version we have in cache
  ])

  // Invalidate if:
  // 1. No cached entity yet
  // 2. Cached entity is not-found (discovery succeeded, so refetch)
  // 3. Cached entity has a different version
  const cachedVersion =
    lastEntity?.type === 'document' ? lastEntity.document?.version : undefined
  const shouldInvalidate =
    !lastEntity || lastEntity?.type === 'not-found' || cachedVersion !== version

  if (shouldInvalidate) {
    invalidateQueries([queryKeys.ENTITY, id.id])
    invalidateQueries([queryKeys.ACCOUNT, id.uid])
    invalidateQueries([queryKeys.RESOLVED_ENTITY, id.id])
  }
}

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
  function checkDiscoverySuccess(discoverResp: DiscoverEntityResponse) {
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

// Invalidate directory queries for an entity and all its parents
// This ensures recursive queries at parent levels are also refreshed
function invalidateDirectoryQueries(id: UnpackedHypermediaId) {
  // Invalidate the entity's own directory query
  invalidateQueries([queryKeys.DOC_LIST_DIRECTORY, id.id])

  // Invalidate all parent directory queries (they may have recursive queries)
  const path = id.path || []
  for (let i = 0; i < path.length; i++) {
    const parentId = hmId(id.uid, {path: path.slice(0, i)})
    invalidateQueries([queryKeys.DOC_LIST_DIRECTORY, parentId.id])
  }

  // Also invalidate the root (account home)
  const rootId = hmId(id.uid)
  invalidateQueries([queryKeys.DOC_LIST_DIRECTORY, rootId.id])
}

async function updateEntitySubscription(
  sub: EntitySubscription,
  onProgress?: (progress: DiscoveryProgress) => void,
) {
  const {id, recursive} = sub
  if (!id) return
  await discoverDocument(id.uid, id.path, undefined, recursive, onProgress)
    .then((result) => {
      discoveryResultWithLatestVersion(id, result.version)
      if (recursive) {
        // Invalidate directory queries for this entity and all parents
        invalidateDirectoryQueries(id)
        fetchQuery({
          includes: [
            {
              space: id.uid,
              mode: 'Children',
              path: hmIdPathToEntityQueryPath(id.path),
            },
          ],
        }).then((result) => {
          result?.results?.forEach((doc) => {
            discoveryResultWithLatestVersion(doc.id, doc.version)
          })
        })
      }
    })
    .finally(() => {})
}

const entitySubscriptions: Record<string, () => void> = {}
const entitySubscriptionCounts: Record<string, number> = {}

function createEntitySubscription(sub: EntitySubscription) {
  const key = getEntitySubscriptionKey(sub)
  if (!key) return () => {}

  const {id, recursive} = sub
  if (!id) return () => {}

  // Track recursive subscriptions for deduplication
  if (recursive) {
    recursiveSubscriptions.add(key)
  }

  // Skip discovery if covered by a parent's recursive subscription
  const isCovered = !recursive && isEntityCoveredByRecursive(id)

  // Set discovering state (even if covered, to handle race conditions)
  const discoveryStream = getOrCreateDiscoveryStream(id.id)
  if (!isCovered) {
    discoveryStream.write({
      isDiscovering: true,
      startedAt: Date.now(),
      entityId: id.id,
    })
  }

  let loopTimer: NodeJS.Timeout | null = null

  function _updateSubscriptionLoop() {
    if (isCovered) {
      // If covered by parent, just schedule next check (parent handles discovery)
      loopTimer = setTimeout(
        _updateSubscriptionLoop,
        DISCOVERY_POLL_INTERVAL_MS,
      )
      return
    }

    updateEntitySubscription(sub, (progress) => {
      discoveryStream.write({
        isDiscovering: true,
        startedAt: Date.now(),
        entityId: id!.id,
        progress,
      })
      updateAggregatedDiscoveryState()
    })
      .then(() => {
        // Discovery completed successfully - clear discovering state
        discoveryStream.write(null)
        updateAggregatedDiscoveryState()
      })
      .catch(() => {
        // Discovery failed but will retry - keep discovering state
      })
      .finally(() => {
        loopTimer = setTimeout(
          _updateSubscriptionLoop,
          DISCOVERY_POLL_INTERVAL_MS,
        )
      })
  }

  // Debounce initial discovery
  loopTimer = setTimeout(
    _updateSubscriptionLoop,
    DISCOVERY_DEBOUNCE_MS + Math.random() * 100,
  )

  return () => {
    loopTimer && clearTimeout(loopTimer)
    if (recursive) {
      recursiveSubscriptions.delete(key)
    }
  }
}

function getEntitySubscriptionKey(sub: EntitySubscription) {
  const {id, recursive} = sub
  if (!id) return null
  return id.id + (recursive ? '/*' : '')
}

export function addSubscribedEntity(sub: EntitySubscription) {
  const key = getEntitySubscriptionKey(sub)
  // console.log('[sync] addSubscribedEntity', sub, key)
  if (!key) return
  if (!entitySubscriptionCounts[key]) {
    entitySubscriptionCounts[key] = 1
    if (!entitySubscriptions[key]) {
      entitySubscriptions[key] = createEntitySubscription(sub)
    }
  } else {
    entitySubscriptionCounts[key] = (entitySubscriptionCounts[key] ?? 0) + 1
  }
}

export function removeSubscribedEntity(sub: EntitySubscription) {
  const key = getEntitySubscriptionKey(sub)
  if (!key) return
  // console.log('[sync] removeSubscribedEntity', key)
  if (!entitySubscriptionCounts[key]) return
  entitySubscriptionCounts[key] = entitySubscriptionCounts[key] - 1
  if (entitySubscriptionCounts[key] === 0) {
    setTimeout(() => {
      // timeout in case another subscription arrives quickly afterward, just leave it going for a moment
      if (entitySubscriptionCounts[key] === 0) {
        entitySubscriptions[key]?.()
        delete entitySubscriptions[key]
      }
    }, 300) // no rush
  }
}
