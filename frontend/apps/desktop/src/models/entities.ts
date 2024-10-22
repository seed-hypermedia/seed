import {toPlainMessage} from '@bufbuild/protobuf'
import {
  DocumentRoute,
  DraftRoute,
  GRPCClient,
  HMDocumentSchema,
  HMEntityContent,
  hmId,
  hmIdPathToEntityQueryPath,
  NavRoute,
  packHmId,
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
import {useGRPCClient, useQueryInvalidator} from '../app-context'
import {queryKeys} from './query-keys'
import {useDeleteRecent} from './recents'

export function useDeleteEntity(
  opts: UseMutationOptions<void, unknown, {id: string; reason: string}>,
) {
  const deleteRecent = useDeleteRecent()
  const invalidate = useQueryInvalidator()
  const grpcClient = useGRPCClient()
  return useMutation({
    ...opts,
    mutationFn: async ({id, reason}: {id: string; reason: string}) => {
      await deleteRecent.mutateAsync(id)
      await grpcClient.entities.deleteEntity({id, reason})
    },
    onSuccess: (
      result: void,
      variables: {id: string; reason: string},
      context,
    ) => {
      const hmId = unpackHmId(variables.id)
      if (hmId?.type === 'd') {
        invalidate([queryKeys.ENTITY, variables.id])
        invalidate([queryKeys.ACCOUNT_DOCUMENTS])
        invalidate([queryKeys.LIST_ACCOUNTS])
        invalidate([queryKeys.ACCOUNT, hmId.uid])
      } else if (hmId?.type === 'comment') {
        invalidate([queryKeys.ENTITY, variables.id])
        invalidate([queryKeys.COMMENT, variables.id])
        invalidate([queryKeys.DOCUMENT_COMMENTS])
      }
      invalidate([queryKeys.FEED])
      invalidate([queryKeys.FEED_LATEST_EVENT])
      invalidate([queryKeys.RESOURCE_FEED])
      invalidate([queryKeys.RESOURCE_FEED_LATEST_EVENT])
      invalidate([queryKeys.ENTITY_CITATIONS])
      invalidate([queryKeys.SEARCH])
      opts?.onSuccess?.(result, variables, context)
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
  const invalidate = useQueryInvalidator()
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
        invalidate([queryKeys.ENTITY, variables.id])
        invalidate([queryKeys.ACCOUNT_DOCUMENTS])
        invalidate([queryKeys.LIST_ACCOUNTS])
        invalidate([queryKeys.ACCOUNT, hmId.uid])
      } else if (hmId?.type === 'comment') {
        invalidate([queryKeys.COMMENT, variables.id])
        invalidate([queryKeys.DOCUMENT_COMMENTS])
      }
      invalidate([queryKeys.FEED])
      invalidate([queryKeys.FEED_LATEST_EVENT])
      invalidate([queryKeys.RESOURCE_FEED])
      invalidate([queryKeys.RESOURCE_FEED_LATEST_EVENT])
      invalidate([queryKeys.ENTITY_CITATIONS])
      invalidate([queryKeys.SEARCH])
      invalidate([queryKeys.DELETED])
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
  return {
    ...options,
    enabled: options?.enabled ?? !!id,
    queryKey: [queryKeys.ENTITY, id?.id, id?.version],
    queryFn: async (): Promise<HMEntityContent | null> => {
      if (!id) return null
      try {
        const grpcDocument = await grpcClient.documents.getDocument({
          account: id.uid,
          path: hmIdPathToEntityQueryPath(id.path),
          version: id.version || undefined,
        })
        const serverDocument = toPlainMessage(grpcDocument)

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
  const invalidate = useQueryInvalidator()
  const grpcClient = useGRPCClient()
  return useMutation({
    mutationFn: async () => {
      await grpcClient.entities.discoverEntity({
        account: id.uid,
        path: hmIdPathToEntityQueryPath(id.path),
        version: id.latest ? undefined : id.version || undefined,
      })
      return {}
    },
    onSuccess: () => {
      invalidate([queryKeys.SEARCH])
      invalidate([queryKeys.ENTITY, id.id])
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

export function useSubscribedEntity(
  id: UnpackedHypermediaId | null | undefined,
  recursive?: boolean,
) {
  return useSubscribedEntities([{id, recursive}])[0]
}

const entitySubscriptions: Record<string, () => void> = {}
const entitySubscriptionCounts: Record<string, number> = {}

export function useSubscribedEntities(
  subs: {id: UnpackedHypermediaId | null | undefined; recursive?: boolean}[],
) {
  const entities = useEntities(subs.map((sub) => sub.id))
  const invalidate = useQueryInvalidator()
  const grpcClient = useGRPCClient()
  useEffect(() => {
    const idKeys = subs.map(({id, recursive}) => {
      if (!id) return null
      return packHmId(id) + (recursive ? '-recursive' : '')
    })
    idKeys.forEach((key, index) => {
      const sub = subs[index]
      const {id, recursive} = sub
      const entity = entities[index]
      const loadedVersion = entity.data?.document?.version
      if (!key || !id) return
      entitySubscriptionCounts[key] = (entitySubscriptionCounts[key] ?? 0) + 1
      let discoveryComplete = loadedVersion === id.version && !id.latest
      let nextDiscoverTimeout: NodeJS.Timeout | null = null

      function handleDiscover() {
        if (!id) return

        const discoveryRequest = {
          account: id.uid,
          path: hmIdPathToEntityQueryPath(id.path),
          recursive,
        }
        grpcClient.entities
          .discoverEntity(discoveryRequest)
          .then((result) => {
            console.log('[sync] discovery completed', discoveryRequest, result)
            // discovery completed. result.version is the new version
            if (result.version === loadedVersion && !recursive)
              discoveryComplete = true
            invalidate([queryKeys.ENTITY, id.id])
            invalidate([queryKeys.DOC_LIST_DIRECTORY, id.uid])
          })
          .catch((e) => {
            console.log('[sync] discovery error', e)
          })
          .finally(() => {
            if (!discoveryComplete) {
              nextDiscoverTimeout = setTimeout(handleDiscover, 10_000)
            }
          })
      }
      if (!entitySubscriptions[key]) {
        if (loadedVersion === id.version && !id.latest && !recursive) return
        handleDiscover()
        entitySubscriptions[key] = () => {
          discoveryComplete = true
          nextDiscoverTimeout && clearTimeout(nextDiscoverTimeout)
        }
      }
    })
    return () => {
      idKeys.forEach((key, index) => {
        if (!key) return
        if (entitySubscriptionCounts[key]) {
          entitySubscriptionCounts[key] = entitySubscriptionCounts[key] - 1
          if (entitySubscriptionCounts[key] === 0) {
            entitySubscriptions[key]?.()
            delete entitySubscriptions[key]
          }
        } else {
          entitySubscriptions[key]?.()
          delete entitySubscriptions[key]
        }
        entitySubscriptionCounts[key] = (entitySubscriptionCounts[key] ?? 0) + 1
      })
    }
  }, [
    subs, // because subs/ids are expected to be volatile, this effect will probably run every time
    entities,
  ])
  return entities
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
