import {useQueries, useQuery, UseQueryOptions} from '@tanstack/react-query'
import {
  HMDocument,
  HMDocumentSchema,
  HMEntityContent,
  UnpackedHypermediaId,
} from '../hm-types'
import {queryKeys} from './query-keys'

let queryEntity: ((hmId: UnpackedHypermediaId) => Promise<HMDocument>) | null =
  null

export function setEntityQuery(
  handler: (hmId: UnpackedHypermediaId) => Promise<HMDocument>,
) {
  queryEntity = handler
}

export function getEntityQuery(
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
        if (!queryEntity) throw new Error('queryEntity not injected')

        const serverDocument = await queryEntity(id)

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

export function useEntity(
  id: UnpackedHypermediaId | null | undefined,
  options?: UseQueryOptions<HMEntityContent | null>,
) {
  return useQuery(getEntityQuery(id, options))
}

export function useEntities(
  ids: (UnpackedHypermediaId | null | undefined)[],
  options?: UseQueryOptions<HMEntityContent | null>,
) {
  return useQueries({
    queries: ids.map((id) => getEntityQuery(id)),
    ...(options || {}),
  })
}
