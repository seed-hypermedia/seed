import {grpcClient} from '@/grpc-client'
import {toPlainMessage} from '@bufbuild/protobuf'
import {DiscoverEntityResponse} from '@shm/shared'
import {prepareHMComment, prepareHMDocument} from '@shm/shared/document-utils'
import {
  HMAccountsMetadata,
  HMDocument,
  HMDocumentInfo,
  HMDocumentMetadataSchema,
  HMEntityContent,
  HMMetadataPayload,
  HMResource,
  HMResourceComment,
  HMResourceDocument,
  HMResourceNotFound,
  HMResourceRedirect,
  UnpackedHypermediaId,
} from '@shm/shared/hm-types'
import {
  createBatchAccountsResolver,
  getErrorMessage,
  HMRedirectError,
  useResources,
} from '@shm/shared/models/entity'
import {invalidateQueries, queryClient} from '@shm/shared/models/query-client'
import {queryKeys} from '@shm/shared/models/query-keys'
import {useDeleteRecent} from '@shm/shared/models/recents'
import {tryUntilSuccess} from '@shm/shared/try-until-success'
import {hmId, packHmId, unpackHmId} from '@shm/shared/utils/entity-id-url'
import {hmIdPathToEntityQueryPath} from '@shm/shared/utils/path-api'
import {useMutation, UseMutationOptions, useQuery} from '@tanstack/react-query'
import {useEffect, useMemo} from 'react'
import {queryListDirectory} from './documents'

type DeleteEntitiesInput = {
  ids: UnpackedHypermediaId[]
  capabilityId?: string
  signingAccountUid: string
}

export function useDeleteEntities(
  opts: UseMutationOptions<void, unknown, DeleteEntitiesInput>,
) {
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

export function getParentPaths(path?: string[] | null): string[][] {
  if (!path) return [[]]
  let walkParentPaths: string[] = []
  return [
    [],
    ...path.map((term) => {
      walkParentPaths = [...walkParentPaths, term]
      return walkParentPaths
    }),
  ]
}

function getIdsFromIds(id: UnpackedHypermediaId): Array<UnpackedHypermediaId> {
  return getParentPaths(id.path).map((path) => hmId(id.uid, {path}))
}

export function useItemsFromId(
  id: UnpackedHypermediaId,
): Array<UnpackedHypermediaId> {
  return useMemo(() => {
    const ids = getIdsFromIds(id)
    return ids
  }, [id])
}

function catchNotFound<Result>(
  promise: Promise<Result>,
): Promise<Result | null> {
  return promise.catch((error) => {
    // if (isActuallyNotFound) throw error;
    return null
  })
}

export async function loadResource(
  hmId: UnpackedHypermediaId,
): Promise<HMResource> {
  try {
    const resource = await grpcClient.resources.getResource({
      iri: packHmId(hmId),
    })
    if (resource.kind.case === 'document') {
      return {
        type: 'document',
        id: hmId satisfies UnpackedHypermediaId,
        document: prepareHMDocument(resource.kind.value) satisfies HMDocument,
      } satisfies HMResourceDocument
    }
    if (resource.kind.case === 'comment') {
      return {
        type: 'comment',
        id: hmId,
        comment: prepareHMComment(resource.kind.value),
      } satisfies HMResourceComment
    }
    throw new Error('Unsupported resource kind: ' + resource.kind.case)
  } catch (e) {
    if (e instanceof HMRedirectError) {
      return {
        type: 'redirect',
        id: hmId,
        redirectTarget: e.target,
      } satisfies HMResourceRedirect
    }
    return {
      type: 'not-found',
      id: hmId,
    } satisfies HMResourceNotFound
  }
}

export async function loadAccount(
  accountUid: string,
): Promise<HMMetadataPayload> {
  try {
    const grpcAccount = await grpcClient.documents.getAccount({
      id: accountUid,
    })

    const serverAccount = toPlainMessage(grpcAccount)
    if (serverAccount.aliasAccount) {
      return await loadAccount(serverAccount.aliasAccount)
    }
    const serverMetadata = grpcAccount.metadata?.toJson() || {}
    const metadata = HMDocumentMetadataSchema.parse(serverMetadata)
    return {
      id: hmId(accountUid, {
        // this is mega confusing, sorry. We need to include this version of the home document so we know when to invalidate the account after discovery completes.
        // it is technically incorrect, because the version should be the version of the profile, not the fallback home document where we currently load account metadata from.
        // one day we can have improved data normalization in the client, and the backend should give details if the metadata is coming from the profile or the home doc.
        // this is used by discoveryResultWithLatestVersion to invalidate the account after discovery completes
        version: serverAccount.homeDocumentInfo?.version,
        // If this confuses you, ask Eric and hopefully he still remembers this.
      }),
      metadata,
    } as HMMetadataPayload
  } catch (error) {
    return {
      id: hmId(accountUid),
      metadata: {},
    } as HMMetadataPayload
  }
}

export const loadBatchAccounts = createBatchAccountsResolver(grpcClient)

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
  useEffect(() => {
    // @ts-expect-error
    if (result.data?.redirectTarget) {
      handleRedirectOrDeleted?.({
        isDeleted: false,
        // @ts-expect-error
        redirectTarget: result.data?.redirectTarget,
      })
    }
    // todo: handle deleted
    // @ts-expect-error
  }, [result.data?.redirectTarget])
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
