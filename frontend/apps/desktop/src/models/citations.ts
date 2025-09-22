import {grpcClient} from '@/grpc-client'
import {
  processMentionsToCitations,
  queryKeys,
  sortCitationsByType,
} from '@shm/shared'
import {BIG_INT} from '@shm/shared/constants'
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

      return processMentionsToCitations(results.mentions, docId)
    },
  })
}

export function useSortedCitations(
  docId?: UnpackedHypermediaId | null,
  {enabled}: {enabled?: boolean} = {},
) {
  const citations = useDocumentCitations(docId, {enabled})
  return sortCitationsByType(citations.data || [])
}
