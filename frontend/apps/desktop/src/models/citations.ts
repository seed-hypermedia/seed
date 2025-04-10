import {grpcClient} from '@/grpc-client'
import {BIG_INT, parseFragment, queryKeys, unpackHmId} from '@shm/shared'
import {HMCitation, UnpackedHypermediaId} from '@shm/shared/hm-types'
import {useQuery} from '@tanstack/react-query'

export function useEntityCitations(docId?: UnpackedHypermediaId | null) {
  return useQuery({
    queryKey: [queryKeys.DOC_CITATIONS, docId?.id],
    queryFn: async (): Promise<HMCitation[]> => {
      if (!docId) return []
      const results = await grpcClient.entities.listEntityMentions({
        id: docId.id,
        // type: docId.type,
        pageSize: BIG_INT,
      })
      // console.log('~~~ raw results', docId.id, results)
      return results.mentions
        .map(({source, isExactVersion, ...mention}) => {
          const sourceId = unpackHmId(source)
          if (!sourceId) return null
          const targetFragment = parseFragment(mention.targetFragment)
          if (sourceId.type === 'c') {
            return {
              source: {
                id: sourceId,
                type: 'c',
                author: mention.sourceBlob?.author,
                time: mention.sourceBlob?.createTime,
              },
              targetFragment,
              isExactVersion,
            } satisfies HMCitation
          } else if (sourceId.type === 'd') {
            console.log('~~~ handling doc citation', sourceId, mention)
            return {
              source: {
                id: sourceId,
                type: 'd',
                author: mention.sourceBlob?.author,
                time: mention.sourceBlob?.createTime,
              },
              targetFragment,
              isExactVersion,
            } satisfies HMCitation
          }
          return null
        })
        .filter((citation) => !!citation)
    },
  })
}
