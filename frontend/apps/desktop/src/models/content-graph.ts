import {
  GRPCClient,
  queryKeys,
  UnpackedHypermediaId,
  unpackHmId,
} from '@shm/shared'
import {useQuery} from '@tanstack/react-query'
import {useGRPCClient} from '../app-context'

export type CitationLink = Awaited<
  ReturnType<GRPCClient['entities']['listEntityMentions']>
>

export function useEntityMentions(entityId?: UnpackedHypermediaId) {
  const grpcClient = useGRPCClient()
  return useQuery({
    queryFn: async () => {
      return {
        mentions: [],
      }
      const result = await grpcClient.entities.listEntityMentions({
        id: entityId,
        pageSize: 400000000,
      })

      return {
        ...result,
        mentions: result.mentions.filter((mention) => {
          const sourceId = unpackHmId(mention.source)
          if (sourceId?.type == 'g') return false
          return true
        }),
      }
    },
    queryKey: [queryKeys.ENTITY_CITATIONS, entityId],
    enabled: !!entityId,
  })
}
