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
      console.log('~~~ raw results', docId.id, results)
      return results.mentions
        .map((m) => {
          const source = unpackHmId(m.source)
          const targetFragment = parseFragment(m.targetFragment)
          if (!source) return null
          return {
            source,
            targetFragment,
            isExactVersion: m.isExactVersion,
          }
        })
        .filter((citation) => !!citation)
    },
  })
}
