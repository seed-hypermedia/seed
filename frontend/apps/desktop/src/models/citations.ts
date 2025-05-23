import {grpcClient} from '@/grpc-client'
import {BIG_INT, hmId, parseFragment, queryKeys, unpackHmId} from '@shm/shared'
import {HMCitation, UnpackedHypermediaId} from '@shm/shared/hm-types'
import {useQuery} from '@tanstack/react-query'

export function useEntityCitations(docId?: UnpackedHypermediaId | null) {
  return useQuery({
    queryKey: [queryKeys.DOC_CITATIONS, docId?.id],
    queryFn: async (): Promise<HMCitation[]> => {
      if (!docId) return []
      const results = await grpcClient.entities.listEntityMentions({
        id: docId.id,
        pageSize: BIG_INT,
      })
      return results.mentions
        .map(({source, isExactVersion, ...mention}) => {
          const sourceId = unpackHmId(source)
          const targetId = hmId(docId.type, docId.uid, {
            path: docId.path,
            version: mention.targetVersion,
          })
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
              targetId,
            } satisfies HMCitation
          } else if (sourceId.type === 'd') {
            return {
              source: {
                id: sourceId,
                type: 'd',
                author: mention.sourceBlob?.author,
                time: mention.sourceBlob?.createTime,
              },
              targetFragment,
              isExactVersion,
              targetId,
            } satisfies HMCitation
          }
          return null
        })
        .filter((citation) => !!citation)
    },
  })
}

export function useSortedCitations(docId?: UnpackedHypermediaId | null) {
  const citations = useEntityCitations(docId)
  const docCitations: HMCitation[] = []
  const commentCitations: HMCitation[] = []
  citations.data?.forEach((citation) => {
    if (citation.source.id.type === 'd') {
      docCitations.push(citation)
    } else if (citation.source.id.type === 'c') {
      commentCitations.push(citation)
    }
  })
  return {docCitations, commentCitations}
}
