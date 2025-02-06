import {grpcClient} from '@/grpc-client'
import {toPlainMessage} from '@bufbuild/protobuf'
import {
  DocumentRoute,
  DraftRoute,
  GRPCClient,
  HMDocumentInfo,
  HMDocumentSchema,
  HMEntityContent,
  hmId,
  hmIdPathToEntityQueryPath,
  invalidateQueries,
  NavRoute,
  queryClient,
  queryKeys,
  UnpackedHypermediaId,
  unpackHmId,
} from '@shm/shared'
import {
  useMutation,
  UseMutationOptions,
  useQueries,
  useQuery,
  UseQueryOptions,
} from '@tanstack/react-query'
import {useEffect, useMemo} from 'react'
import {useGRPCClient} from '../app-context'
import {queryListDirectory} from './documents'
import {useDeleteRecent} from './recents'

type DeleteEntitiesInput = {
  ids: UnpackedHypermediaId[]
  capabilityId?: string
  signingAccountUid: string
}

export function useDeleteEntities(
  opts: UseMutationOptions<void, unknown, DeleteEntitiesInput>,
) {
  const deleteRecent = useDeleteRecent()
  const grpcClient = useGRPCClient()
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
  const grpcClient = useGRPCClient()
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
  const grpcClient = useGRPCClient()
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
        invalidateQueries([queryKeys.ACCOUNT_DOCUMENTS])
        invalidateQueries([queryKeys.LIST_ACCOUNTS])
        invalidateQueries([queryKeys.ACCOUNT, hmId.uid])
      } else if (hmId?.type === 'comment') {
        invalidateQueries([queryKeys.COMMENT, variables.id])
        invalidateQueries([queryKeys.DOCUMENT_COMMENTS])
      }
      invalidateQueries([queryKeys.FEED])
      invalidateQueries([queryKeys.FEED_LATEST_EVENT])
      invalidateQueries([queryKeys.RESOURCE_FEED])
      invalidateQueries([queryKeys.RESOURCE_FEED_LATEST_EVENT])
      invalidateQueries([queryKeys.ENTITY_CITATIONS])
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

function getRouteBreadcrumbRoutes(
  route: NavRoute,
): Array<DocumentRoute | DraftRoute> {
  if (route.key === 'document') {
    return getParentPaths(route.id.path).map((path) => ({
      key: 'document',
      id: hmId(route.id.type, route.id.uid, {path}),
    }))
  }
  if (route.key === 'draft') {
    // TODO: eric determine breadcrumbs based on route.id
    return [route]
  }
  return []
}

export function useRouteBreadcrumbRoutes(
  route: NavRoute,
): Array<DocumentRoute | DraftRoute> {
  return useMemo(() => {
    const routes = getRouteBreadcrumbRoutes(route)
    return routes
  }, [route])
}

function catchNotFound<Result>(
  promise: Promise<Result>,
): Promise<Result | null> {
  return promise.catch((error) => {
    // if (isActuallyNotFound) throw error;
    return null
  })
}

export function queryEntity(
  grpcClient: GRPCClient,
  id: UnpackedHypermediaId | null | undefined,
  options?: UseQueryOptions<HMEntityContent | null>,
): UseQueryOptions<HMEntityContent | null> {
  const version = id?.latest ? undefined : id?.version || undefined
  return {
    ...options,
    enabled: options?.enabled ?? !!id,
    queryKey: [queryKeys.ENTITY, id?.id, version],
    queryFn: async (): Promise<HMEntityContent | null> => {
      if (!id) return null
      try {
        const grpcDocument = await grpcClient.documents.getDocument({
          account: id.uid,
          path: hmIdPathToEntityQueryPath(id.path),
          version,
        })

        const serverDocument = grpcDocument.toJson()

        const result = HMDocumentSchema.safeParse(serverDocument)
        if (result.success) {
          const document = result.data
          return {
            id: {...id, version: document.version},
            document,
          }
        } else {
          console.error('Invalid Document!', serverDocument, result.error)
          return {id, document: undefined}
        }
      } catch (e) {
        return {id, document: undefined}
      }
    },
  }
}

export function useDiscoverEntity(id: UnpackedHypermediaId) {
  const grpcClient = useGRPCClient()
  return useMutation({
    mutationFn: async () => {
      await grpcClient.entities.discoverEntity({
        account: id.uid,
        path: hmIdPathToEntityQueryPath(id.path),
        version: id.latest ? undefined : id.version || undefined,
        recursive: true,
      })
      return {}
    },
    onSuccess: () => {
      invalidateQueries([queryKeys.SEARCH])
      invalidateQueries([queryKeys.ENTITY]) // because children may have changed, we have to invalidate all entities
      invalidateQueries([queryKeys.DOC_LIST_DIRECTORY, id.uid])
    },
  })
}

export function useEntity(
  id: UnpackedHypermediaId | null | undefined,
  options?: UseQueryOptions<HMEntityContent | null>,
) {
  const grpcClient = useGRPCClient()
  return useQuery(queryEntity(grpcClient, id, options))
}

export function useEntities(
  ids: (UnpackedHypermediaId | null | undefined)[],
  options?: UseQueryOptions<HMEntityContent | null>,
) {
  const grpcClient = useGRPCClient()
  return useQueries({
    queries: ids.map((id) => queryEntity(grpcClient, id)),
    ...(options || {}),
  })
}

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
      loopTimer = setTimeout(_updateSubscriptionLoop, 10_000)
    })
  }
  loopTimer = setTimeout(
    _updateSubscriptionLoop,
    500 + Math.random() * 1000, // delay the first discovery to avoid too many simultaneous updates
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
) {
  return useSubscribedEntities([{id, recursive}])[0]
}

export function useRouteEntities(
  routes: Array<DocumentRoute | DraftRoute>,
): {route: DocumentRoute | DraftRoute; entity?: HMEntityContent}[] {
  return useSubscribedEntities(
    routes.map((r) => {
      if (r.key === 'document') return {id: r.id}
      return {id: null}
    }),
  ).map((result, i) => {
    const route = routes[i]
    return {route, entity: result.data || undefined}
  })
}
