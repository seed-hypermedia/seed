import {
  HMCitationsPayload,
  HMListChangesOutput,
  packHmId,
  queryKeys,
  UnpackedHypermediaId,
} from '@shm/shared'
import {useQuery, UseQueryOptions} from '@tanstack/react-query'
import {ActivityPayload} from './routes/hm.api.activity'
import {InteractionSummaryPayload} from './routes/hm.api.interaction-summary'
import {unwrap} from './wrapping'

// queryAPI for universal client and useAPI hook - unwraps superjson
export async function queryAPI<ResponsePayloadType>(url: string) {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.statusText}`)
  }
  const fullData = await response.json()
  return unwrap<ResponsePayloadType>(fullData)
}

export function useAPI<ResponsePayloadType>(
  url?: string,
  queryOptions?: UseQueryOptions<unknown, unknown, ResponsePayloadType>,
) {
  const query = useQuery({
    queryKey: ['api', url],
    queryFn: async () => {
      if (!url) return
      return await queryAPI<ResponsePayloadType>(url)
    },
    ...queryOptions,
  })
  return query
}

export function useDocumentChanges(id: UnpackedHypermediaId | undefined) {
  return useAPI<HMListChangesOutput>(
    id ? `/hm/api/changes?id=${packHmId(id)}` : undefined,
    {enabled: !!id},
  )
}

// export function useDiscussion(
//   docId: UnpackedHypermediaId,
//   targetCommentId?: string,
// ) {
//   let url = `/hm/api/discussion?id=${docId.id}`
//   if (targetCommentId) {
//     url += `&targetCommentId=${targetCommentId}`
//   }
//   const response = useAPI<DiscussionPayload>(url, {
//     queryKey: [queryKeys.DOCUMENT_DISCUSSION, docId.id, targetCommentId],
//   })
//   return response
// }

export function useActivity(
  docId: UnpackedHypermediaId,
  targetCommentId?: string,
) {
  let url = `/hm/api/activity?id=${docId.id}`
  if (targetCommentId) {
    url += `&targetCommentId=${targetCommentId}`
  }
  const response = useAPI<ActivityPayload>(url, {
    queryKey: [queryKeys.DOCUMENT_ACTIVITY, docId.id],
  })

  return response
}

export function useCitations(
  id: UnpackedHypermediaId,
  opts: {enabled?: boolean} = {},
) {
  const response = useAPI<HMCitationsPayload>(`/hm/api/citations?id=${id.id}`, {
    queryKey: [queryKeys.DOC_CITATIONS, id.id],
    enabled: opts.enabled,
  })

  return response
}

export function useInteractionSummary(
  id: UnpackedHypermediaId,
  opts: {enabled?: boolean} = {},
) {
  const response = useAPI<InteractionSummaryPayload>(
    `/hm/api/interaction-summary?id=${id.id}`,
    {
      queryKey: [queryKeys.DOCUMENT_INTERACTION_SUMMARY, id.id],
      enabled: opts.enabled,
    },
  )
  return response
}
