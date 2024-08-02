import {toPlainMessage} from '@bufbuild/protobuf'
import {
  GRPCClient,
  HMEntityContent,
  hmId,
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
import {useMemo} from 'react'
import {useGRPCClient, useQueryInvalidator} from '../app-context'
import {DocumentRoute, DraftRoute, NavRoute} from '../utils/routes'
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
        invalidate([queryKeys.PUBLICATION_COMMENTS])
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
        invalidate([queryKeys.PUBLICATION_COMMENTS])
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

function getParentPaths(path?: string[] | null): string[][] {
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

function getRouteBreadrumbRoutes(
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
    const routes = getRouteBreadrumbRoutes(route)
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
    queryKey: [queryKeys.ENTITY, id?.id],
    queryFn: async (): Promise<HMEntityContent | null> => {
      if (!id) return null
      try {
        const document = await grpcClient.documents.getDocument({
          account: id.uid,
          path: id.path?.length ? `/${id.path.join('/')}` : '',
        })
        return {id, document: toPlainMessage(document)}
      } catch (e) {
        return null
      }
    },
  }
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

export function useRouteEntities(
  routes: Array<DocumentRoute | DraftRoute>,
): {route: DocumentRoute | DraftRoute; entity?: HMEntityContent}[] {
  return useEntities(
    routes.map((r) => {
      if (r.key === 'document') return r.id
      return null
    }),
  ).map((result, i) => {
    const route = routes[i]
    return {route, entity: result.data || undefined}
  })
}
