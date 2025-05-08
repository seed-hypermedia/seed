import {grpcClient} from '@/grpc-client'
import {toPlainMessage} from '@bufbuild/protobuf'
import {
  HMAccountsMetadata,
  HMDocument,
  HMDocumentInfo,
  HMDocumentMetadataSchema,
  HMEntityContent,
  HMLoadedDocument,
  HMMetadataPayload,
  UnpackedHypermediaId,
} from '@shm/shared/hm-types'
import {
  setAccountQuery,
  setEntityQuery,
  useEntities,
  useEntity,
} from '@shm/shared/models/entity'
import {invalidateQueries, queryClient} from '@shm/shared/models/query-client'
import {queryKeys} from '@shm/shared/models/query-keys'
import {useDeleteRecent} from '@shm/shared/models/recents'
import {hmId, unpackHmId} from '@shm/shared/utils/entity-id-url'
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
      if (hmId?.type === 'd') {
        invalidateQueries([queryKeys.ENTITY, variables.id])
        invalidateQueries([queryKeys.RESOLVED_ENTITY, variables.id])
        invalidateQueries([queryKeys.ACCOUNT_DOCUMENTS])
        invalidateQueries([queryKeys.LIST_ACCOUNTS])
        invalidateQueries([queryKeys.ACCOUNT, hmId.uid])
      } else if (hmId?.type === 'c') {
        invalidateQueries([queryKeys.COMMENT, variables.id])
        invalidateQueries([queryKeys.DOCUMENT_COMMENTS])
      }
      invalidateQueries([queryKeys.FEED])
      invalidateQueries([queryKeys.FEED_LATEST_EVENT])
      invalidateQueries([queryKeys.RESOURCE_FEED])
      invalidateQueries([queryKeys.RESOURCE_FEED_LATEST_EVENT])
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
  if (id.type === 'd') {
    return getParentPaths(id.path).map((path) => hmId('d', id.uid, {path}))
  }
  return []
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

setEntityQuery(async (hmId) => {
  const grpcDocument = await grpcClient.documents.getDocument({
    account: hmId.uid,
    path: hmIdPathToEntityQueryPath(hmId.path),
    version: (hmId.latest ? undefined : hmId.version) || undefined,
  })

  const serverDocument = grpcDocument.toJson()

  return serverDocument as HMDocument // zod validation is done by the entity model
})

async function getAccount(accountUid: string) {
  const grpcAccount = await grpcClient.documents.getAccount({
    id: accountUid,
  })

  const serverAccount = toPlainMessage(grpcAccount)
  if (serverAccount.aliasAccount) {
    return await getAccount(serverAccount.aliasAccount)
  }
  const serverMetadata = grpcAccount.metadata?.toJson() || {}
  const metadata = HMDocumentMetadataSchema.parse(serverMetadata)
  return {
    id: hmId('d', accountUid),
    metadata,
  } as HMMetadataPayload
}

setAccountQuery(getAccount)

type EntitySubscription = {
  id?: UnpackedHypermediaId | null
  recursive?: boolean
}

function invalidateEntityWithVersion(id: string, version?: string) {
  if (!version) return
  const lastEntity = queryClient.getQueryData<HMEntityContent>([
    queryKeys.ENTITY,
    id,
    undefined,
  ])
  if (lastEntity && lastEntity.document?.version !== version) {
    // console.log('[sync] new version discovered for entity', id, version)
    invalidateQueries([queryKeys.ENTITY, id])
    invalidateQueries([queryKeys.RESOLVED_ENTITY, id])
  }
}

async function updateEntitySubscription(sub: EntitySubscription) {
  const {id, recursive} = sub
  if (!id) return
  const discoveryRequest = {
    account: id.uid,
    path: hmIdPathToEntityQueryPath(id.path),
    recursive,
  }
  // console.log('[sync] discovery request', discoveryRequest)
  await grpcClient.entities
    .discoverEntity(discoveryRequest)
    .then((result) => {
      // console.log('[sync] discovery complete', sub)
      invalidateEntityWithVersion(id.id, result.version)
      if (recursive) {
        invalidateQueries([queryKeys.DOC_LIST_DIRECTORY, id.uid])
        queryClient
          .fetchQuery(queryListDirectory(id))
          .then((newDir: HMDocumentInfo[]) => {
            newDir.forEach((doc) => {
              invalidateEntityWithVersion(
                hmId('d', doc.account, {path: doc.path}).id,
                doc.version,
              )
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
      loopTimer = setTimeout(_updateSubscriptionLoop, 2_000)
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

export function useSubscribedEntities(
  subs: {id: UnpackedHypermediaId | null | undefined; recursive?: boolean}[],
) {
  const entities = useEntities(subs.map((sub) => sub.id))
  const isAllEntitiesInitialLoaded = entities.every(
    (entity) => entity.isInitialLoading === false,
  )
  useEffect(() => {
    if (!isAllEntitiesInitialLoaded) return
    // console.log('[sync] useSubscribedEntities effect', subs)
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

export function useSubscribedEntity(
  id: UnpackedHypermediaId | null | undefined,
  recursive?: boolean,
  handleRedirectOrDeleted?: (opts: {
    isDeleted: boolean
    redirectTarget: UnpackedHypermediaId | null
  }) => void,
) {
  const result = useSubscribedEntities([{id, recursive}])[0]
  // id && console.log('~~ useSubscribedEntity', id.id, result.data)
  useEffect(() => {
    if (result.data?.redirectTarget) {
      console.error(
        '~~ Redirected entity',
        result.data?.redirectTarget,
        !!handleRedirectOrDeleted,
      )
      handleRedirectOrDeleted?.({
        isDeleted: false,
        redirectTarget: result.data?.redirectTarget,
      })
    }
    // todo: handle deleted
  }, [result.data?.redirectTarget])
  return result
}

export function useDesktopLoadedEntity(
  id: UnpackedHypermediaId | undefined,
  opts: {
    subscribed?: boolean
    recursive?: boolean
    onRedirectOrDeleted?: (opts: {
      isDeleted: boolean
      redirectTarget: UnpackedHypermediaId | null
    }) => void
  } = {},
) {
  const useTheEntity = opts.subscribed ? useSubscribedEntity : useEntity
  const entity = useTheEntity(id, opts.recursive, opts.onRedirectOrDeleted)
  if (!entity.data) return entity
  const {document} = entity.data
  if (!document) return entity
  return {
    ...entity,
    data: {
      id: entity.data.id,
      version: document.version,
      content: document.content,
      metadata: document.metadata,
      authors: document.authors,
    } satisfies HMLoadedDocument,
  } satisfies {
    data: HMLoadedDocument
  }
}

export function useIdEntities(
  ids: Array<UnpackedHypermediaId>,
): {id: UnpackedHypermediaId; entity?: HMEntityContent}[] {
  return useSubscribedEntities(
    ids.map((id) => {
      return {id}
    }),
  ).map((result, i) => {
    return {id: ids[i], entity: result.data || undefined}
  })
}

export function useAccountsMetadata(ids: string[]): HMAccountsMetadata {
  const accounts = useEntities(ids.map((id) => hmId('d', id)))
  return Object.fromEntries(
    accounts
      .map((account) => {
        if (!account.data) return null
        return [
          account.data.id.uid,
          {id: account.data.id, metadata: account.data.document?.metadata},
        ]
      })
      .filter((entry) => !!entry),
  )
}
