import {grpcClient} from '@/grpc-client'
import {GRPCClient} from '@shm/shared/grpc-client'
import {queryKeys} from '@shm/shared/models/query-keys'
import {UnpackedHypermediaId, unpackHmId} from '@shm/shared/utils/entity-id-url'
import {useQuery} from '@tanstack/react-query'

export type CitationLink = Awaited<
  ReturnType<GRPCClient['entities']['listEntityMentions']>
>

export function useEntityMentions(entityId?: UnpackedHypermediaId) {
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
