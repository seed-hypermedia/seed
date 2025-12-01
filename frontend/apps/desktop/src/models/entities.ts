import {grpcClient} from '@/grpc-client'
import {toPlainMessage} from '@bufbuild/protobuf'
import {DiscoverEntityResponse} from '@shm/shared'
import {
  HMAccountsMetadata,
  HMEntityContent,
  UnpackedHypermediaId,
} from '@shm/shared/hm-types'
import {createQueryResolver} from '@shm/shared/models/directory'
import {
  createBatchAccountsResolver,
  getErrorMessage,
  HMRedirectError,
  useResources,
} from '@shm/shared/models/entity'
import {invalidateQueries, queryClient} from '@shm/shared/models/query-client'
import {queryKeys} from '@shm/shared/models/query-keys'
import {useDeleteRecent} from '@shm/shared/models/recents'
import {createResourceFetcher} from '@shm/shared/resource-loader'
import {tryUntilSuccess} from '@shm/shared/try-until-success'
import {hmId, unpackHmId} from '@shm/shared/utils/entity-id-url'
import {hmIdPathToEntityQueryPath} from '@shm/shared/utils/path-api'
import {useMutation, UseMutationOptions, useQuery} from '@tanstack/react-query'
import {useEffect, useRef} from 'react'
import {queryListDirectory, usePushResource} from './documents'

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

type EntitySubscription = {
  id?: UnpackedHypermediaId | null
  recursive?: boolean
}

function discoveryResultWithLatestVersion(
  id: UnpackedHypermediaId,
  version: string,
) {
  const lastEntity = queryClient.getQueryData<HMEntityContent>([
    queryKeys.ENTITY,
    id.id,
    undefined, // this signifies the "latest" version we have in cache
  ])
  if (lastEntity && lastEntity?.document?.version !== version) {
    // console.log('[sync] new version discovered for entity', id, version)
    invalidateQueries([queryKeys.ENTITY, id.id])
    invalidateQueries([queryKeys.ACCOUNT, id.uid])
    invalidateQueries([queryKeys.RESOLVED_ENTITY, id.id])
  }
  // we should also invalidate the queryKeys.ACCOUNT entry in the cache
}

export async function discoverDocument(
  uid: string,
  path: string[] | null,
  version?: string | null,
  recursive?: boolean,
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
      if (checkDiscoverySuccess(discoverResp))
        return {version: discoverResp.version}

      return null
    },
    {
      maxRetryMs: 10_000, // 10 seconds because subscriptions are scheduled to run discovery every 10 seconds
      retryDelayMs: 2_000,
      immediateCatch: (e) => {
        const error = getErrorMessage(e)
        return error instanceof HMRedirectError
      },
    },
  )
}

async function updateEntitySubscription(sub: EntitySubscription) {
  const {id, recursive} = sub
  if (!id) return
  await discoverDocument(id.uid, id.path, undefined, recursive)
    .then((result) => {
      discoveryResultWithLatestVersion(id, result.version)
      if (recursive) {
        invalidateQueries([queryKeys.DOC_LIST_DIRECTORY, id.uid])
        queryClient
          .fetchQuery(queryListDirectory(id))
          // @ts-expect-error
          .then((newDir: HMDocumentInfo[]) => {
            newDir.forEach((doc) => {
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
  // console.log('[sync] createEntitySubscription', key)

  let loopTimer: NodeJS.Timeout | null = null
  function _updateSubscriptionLoop() {
    updateEntitySubscription(sub).finally(() => {
      loopTimer = setTimeout(_updateSubscriptionLoop, 10_000)
    })
  }
  loopTimer = setTimeout(
    _updateSubscriptionLoop,
    100 + Math.random() * 300, // delay the first discovery to avoid too many simultaneous updates
  )

  return () => {
    // console.log('[sync] releaseEntitySubscription', key)
    loopTimer && clearTimeout(loopTimer)
  }
}

function getEntitySubscriptionKey(sub: EntitySubscription) {
  const {id, recursive} = sub
  if (!id) return null
  return id.id + (recursive ? '/*' : '')
}

function addSubscribedEntity(sub: EntitySubscription) {
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

function removeSubscribedEntity(sub: EntitySubscription) {
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

export function useSubscribedResources(
  subs: {id: UnpackedHypermediaId | null | undefined; recursive?: boolean}[],
) {
  const entities = useResources(subs.map((sub) => sub.id))
  const isAllEntitiesInitialLoaded = entities.every(
    (entity) => entity.isInitialLoading === false,
  )
  useEffect(() => {
    if (!isAllEntitiesInitialLoaded) return
    subs.forEach(addSubscribedEntity)
    return () => {
      // console.log('[sync] unsubscribing', subs)
      subs.forEach(removeSubscribedEntity)
    }
  }, [
    subs, // because subs/ids are expected to be volatile, this effect will probably run every time
    isAllEntitiesInitialLoaded,
  ])
  return entities
}

export function useSubscribedResource(
  id: UnpackedHypermediaId | null | undefined,
  recursive?: boolean,
  handleRedirectOrDeleted?: (opts: {
    isDeleted: boolean
    redirectTarget: UnpackedHypermediaId | null
  }) => void,
) {
  const result = useSubscribedResources([{id, recursive}])[0]
  const redirectTarget =
    result.data?.type === 'redirect' ? result.data.redirectTarget : null

  // Use ref to avoid re-triggering effect when callback changes
  const handleRedirectOrDeletedRef = useRef(handleRedirectOrDeleted)
  handleRedirectOrDeletedRef.current = handleRedirectOrDeleted

  // Track if we've already handled this redirect to prevent duplicate toasts
  const handledRedirectRef = useRef<string | null>(null)

  useEffect(() => {
    if (redirectTarget && handledRedirectRef.current !== redirectTarget.id) {
      handledRedirectRef.current = redirectTarget.id
      handleRedirectOrDeletedRef.current?.({
        isDeleted: false,
        redirectTarget,
      })
    }
    // todo: handle deleted
  }, [redirectTarget])
  return result
}

export function useSubscribedResourceIds(
  ids: Array<UnpackedHypermediaId>,
): {id: UnpackedHypermediaId; entity?: HMEntityContent}[] {
  // @ts-ignore
  return useSubscribedResources(
    ids.map((id) => {
      return {id}
    }),
  ).map((result, i) => {
    return {id: ids[i], entity: result.data || undefined}
  })
}

export function useAccountsMetadata(ids: string[]): HMAccountsMetadata {
  const accounts = useSubscribedResources(ids.map((id) => ({id: hmId(id)})))
  return Object.fromEntries(
    accounts
      .map((account) => {
        if (!account.data) return null
        return [
          account.data.id.uid,
          // @ts-expect-error
          {id: account.data.id, metadata: account.data.document?.metadata},
        ]
      })
      .filter((entry) => !!entry),
  )
}
