import {grpcClient} from '@/grpc-client'
import {
  BIG_INT,
  deduplicateCitations,
  hmId,
  parseFragment,
  queryKeys,
  unpackHmId,
} from '@shm/shared'
import {HMCitation, UnpackedHypermediaId} from '@shm/shared/hm-types'
import {useQuery} from '@tanstack/react-query'

export function useDocumentCitations(
  docId?: UnpackedHypermediaId | null,
  {enabled}: {enabled?: boolean} = {},
) {
  return useQuery({
    enabled: enabled !== false && !!docId,
    queryKey: [queryKeys.DOC_CITATIONS, docId?.id],
    queryFn: async (): Promise<HMCitation[]> => {
      if (!docId) return []
      const results = await grpcClient.entities.listEntityMentions({
        id: docId.id,
        pageSize: BIG_INT,
      })
      return results.mentions
        .map(
          ({
            source,
            isExactVersion,
            sourceType,
            targetVersion,
            sourceBlob,
            ...restMention
          }) => {
            const sourceId = unpackHmId(source)
            const targetId = hmId(docId.uid, {
              path: docId.path,
              version: targetVersion,
            })
            if (!sourceId) return null
            const targetFragment = parseFragment(restMention.targetFragment)
            if (sourceType === 'Comment') {
              return {
                source: {
                  id: sourceId,
                  type: 'c',
                  author: sourceBlob?.author,
                  time: sourceBlob?.createTime,
                },
                targetFragment,
                isExactVersion,
                targetId,
              } satisfies HMCitation
            } else if (sourceType === 'Ref') {
              return {
                source: {
                  id: sourceId,
                  type: 'd',
                  author: sourceBlob?.author,
                  time: sourceBlob?.createTime,
                },
                targetFragment,
                isExactVersion,
                targetId,
              } satisfies HMCitation
            }
            return null
          },
        )
        .filter((citation) => !!citation)
    },
  })
}

export function useSortedCitations(
  docId?: UnpackedHypermediaId | null,
  {enabled}: {enabled?: boolean} = {},
) {
  const citations = useDocumentCitations(docId, {enabled})
  const dedupedCitations = deduplicateCitations(citations.data || [])
  const docCitations: HMCitation[] = []
  const commentCitations: HMCitation[] = []
  dedupedCitations.forEach((citation) => {
    if (citation.source.type === 'd') {
      docCitations.push(citation)
    } else if (citation.source.type === 'c') {
      commentCitations.push(citation)
    }
  })
  return {docCitations, commentCitations}
}
