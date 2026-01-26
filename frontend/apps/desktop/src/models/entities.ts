import {grpcClient} from '@/grpc-client'
import {client} from '@/trpc'
import {toPlainMessage} from '@bufbuild/protobuf'
import {DiscoveryState, UnpackedHypermediaId} from '@shm/shared/hm-types'
import {createQueryResolver} from '@shm/shared/models/directory'
import {invalidateQueries} from '@shm/shared/models/query-client'
import {queryKeys} from '@shm/shared/models/query-keys'
import {useDeleteRecent} from '@shm/shared/models/recents'
import {createResourceFetcher} from '@shm/shared/resource-loader'
import {getParentPaths} from '@shm/shared/utils/breadcrumbs'
import {hmId, unpackHmId} from '@shm/shared/utils/entity-id-url'
import {hmIdPathToEntityQueryPath} from '@shm/shared/utils/path-api'
import {StateStream, writeableStateStream} from '@shm/shared/utils/stream'
import {useMutation, UseMutationOptions, useQuery} from '@tanstack/react-query'
import {usePushResource} from './documents'

type DeleteEntitiesInput = {
  ids: UnpackedHypermediaId[]
  capabilityId?: string
  signingAccountUid: string
}

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
          invalidateQueries([
            queryKeys.DOCUMENT_INTERACTION_SUMMARY,
            parentId.id,
          ])
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

// Use shared resource fetcher
export const fetchResource = createResourceFetcher(grpcClient)

export const fetchQuery = createQueryResolver(grpcClient)

// Discovery state streams - managed locally but updated via tRPC subscriptions
const discoveryStreams = new Map<
  string,
  {
    write: (state: DiscoveryState | null) => void
    stream: StateStream<DiscoveryState | null>
    unsubscribe?: () => void
  }
>()

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

// Aggregated discovery state - subscribe to main process
const [writeAggregatedDiscovery, aggregatedDiscoveryStream] =
  writeableStateStream({
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
  aggregatedStateSubscription = client.sync.aggregatedState.subscribe(
    undefined,
    {
      onData: (state) => {
        writeAggregatedDiscovery(state)
      },
    },
  )
}

export function getAggregatedDiscoveryStream() {
  ensureAggregatedStateSubscription()
  return aggregatedDiscoveryStream
}

// Active discoveries list - subscribe to main process
const [writeActiveDiscoveries, activeDiscoveriesStream] = writeableStateStream<
  DiscoveryState[]
>([])

let activeDiscoveriesSubscription: {unsubscribe: () => void} | null = null

function ensureActiveDiscoveriesSubscription() {
  if (activeDiscoveriesSubscription) return
  activeDiscoveriesSubscription = client.sync.activeDiscoveries.subscribe(
    undefined,
    {
      onData: (discoveries) => {
        writeActiveDiscoveries(discoveries)
      },
    },
  )
}

export function getActiveDiscoveriesStream() {
  ensureActiveDiscoveriesSubscription()
  return activeDiscoveriesStream
}

export type EntitySubscription = {
  id?: UnpackedHypermediaId | null
  recursive?: boolean
}

// Entity subscription management - delegates to main process via tRPC
const entitySubscriptions: Record<string, {unsubscribe: () => void}> = {}
const entitySubscriptionCounts: Record<string, number> = {}

function getEntitySubscriptionKey(sub: EntitySubscription) {
  const {id, recursive} = sub
  if (!id) return null
  return id.id + (recursive ? '/*' : '')
}

export function addSubscribedEntity(sub: EntitySubscription) {
  const key = getEntitySubscriptionKey(sub)
  if (!key || !sub.id) return

  const currentCount = entitySubscriptionCounts[key] || 0
  entitySubscriptionCounts[key] = currentCount + 1

  // Only create subscription on first reference
  if (currentCount === 0) {
    // Subscribe via tRPC to the main process
    const subscription = client.sync.subscribe.subscribe(
      {
        id: sub.id,
        recursive: sub.recursive,
      },
      {
        onData: () => {
          // Status updates handled by main process
        },
      },
    )
    entitySubscriptions[key] = subscription

    // Also subscribe to discovery state updates for this entity
    const discoveryStreamEntry = getOrCreateDiscoveryStream(sub.id.id)
    const discoveryStateSub = client.sync.discoveryState.subscribe(sub.id.id, {
      onData: (state) => {
        discoveryStreamEntry.write(state)
      },
    })
    discoveryStreamEntry.unsubscribe = () => discoveryStateSub.unsubscribe()
  }
}

export function removeSubscribedEntity(sub: EntitySubscription) {
  const key = getEntitySubscriptionKey(sub)
  if (!key) return
  if (!entitySubscriptionCounts[key]) return

  entitySubscriptionCounts[key] = entitySubscriptionCounts[key] - 1
  if (entitySubscriptionCounts[key] === 0) {
    setTimeout(() => {
      // timeout in case another subscription arrives quickly afterward
      if (entitySubscriptionCounts[key] === 0) {
        entitySubscriptions[key]?.unsubscribe()
        delete entitySubscriptions[key]

        // Also cleanup discovery state subscription
        if (sub.id) {
          const discoveryStreamEntry = discoveryStreams.get(sub.id.id)
          discoveryStreamEntry?.unsubscribe?.()
        }
      }
    }, 300)
  }
}
