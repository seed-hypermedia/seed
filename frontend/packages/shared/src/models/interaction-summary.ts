import {useQuery} from '@tanstack/react-query'
import {
  HMInteractionSummaryOutput,
  HMInteractionSummaryRequest,
  UnpackedHypermediaId,
} from '../hm-types'
import {useUniversalClient} from '../routing'
import {queryKeys} from './query-keys'

export function useInteractionSummary(
  docId?: UnpackedHypermediaId | null,
  {enabled}: {enabled?: boolean} = {},
) {
  const client = useUniversalClient()
  return useQuery({
    enabled: enabled !== false && !!docId,
    queryKey: [queryKeys.DOCUMENT_INTERACTION_SUMMARY, docId?.id],
    queryFn: async (): Promise<HMInteractionSummaryOutput> => {
      if (!docId) {
        return {
          citations: 0,
          comments: 0,
          changes: 0,
          children: 0,
          blocks: {},
        }
      }
      return client.request<HMInteractionSummaryRequest>('InteractionSummary', {
        id: docId,
      })
    },
  })
}
