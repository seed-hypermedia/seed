import {
  HMCitationsPayload,
  HMDocument,
  HMMetadataPayload,
  packHmId,
  queryKeys,
  setSearchQuery,
  UnpackedHypermediaId,
} from '@shm/shared'
import {setAccountQuery, setEntityQuery} from '@shm/shared/models/entity'
import {setDeleteRecents, setRecentsQuery} from '@shm/shared/models/recents'
import {SearchPayload} from '@shm/shared/models/search'
import {useQuery, UseQueryOptions} from '@tanstack/react-query'
import {deleteRecent, getRecents} from './local-db-recents'
import {HMDocumentChangesPayload} from './routes/api.changes.$'
import {ActivityPayload} from './routes/hm.api.activity'
import {HMBlockDiscussionsPayload} from './routes/hm.api.block-discussions'
import {HMDiscussionPayload} from './routes/hm.api.discussion'
import {HMDiscussionsPayload} from './routes/hm.api.discussions'
import {InteractionSummaryPayload} from './routes/hm.api.interaction-summary'
import {unwrap} from './wrapping'

async function queryAPI<ResponsePayloadType>(url: string) {
  const response = await fetch(url)
  const fullData = await response.json()
  const data = unwrap<ResponsePayloadType>(fullData)
  return data
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
  return useAPI<HMDocumentChangesPayload>(
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

export function searchQuery(
  input: string,
  {
    accountUid,
    includeBody,
    contextSize,
  }: {
    accountUid?: string
    includeBody?: boolean
    contextSize?: number
  } = {},
) {
  return queryAPI<SearchPayload>(
    `/hm/api/search?q=${input}&a=${accountUid}&b=${includeBody}&c=${contextSize}`,
  )
}

async function accountQuery(accountUid: string) {
  const response = await queryAPI<HMMetadataPayload>(
    `/hm/api/account/${accountUid}`,
  )
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

export function useDiscussion(
  targetId: UnpackedHypermediaId,
  commentId?: string,
  opts: {enabled?: boolean} = {},
) {
  const response = useAPI<HMDiscussionPayload>(
    `/hm/api/discussion?targetId=${targetId.id}&commentId=${commentId}`,
    {
      queryKey: [queryKeys.DOCUMENT_DISCUSSION, targetId.id, commentId],
      enabled: opts.enabled,
    },
  )
  return response
}

export function useAllDiscussions(
  id: UnpackedHypermediaId,
  opts: {enabled?: boolean} = {},
) {
  const response = useAPI<HMDiscussionsPayload>(
    `/hm/api/discussions?targetId=${id.id}`,
    {
      queryKey: [queryKeys.DOCUMENT_DISCUSSION, id.id],
      enabled: opts.enabled,
    },
  )
  return response
}

export function useBlockDiscussions(
  id: UnpackedHypermediaId,
  blockId: string,
  opts: {enabled?: boolean} = {},
) {
  const response = useAPI<HMBlockDiscussionsPayload>(
    `/hm/api/block-discussions?targetId=${id.id}&blockId=${blockId}`,
    {
      queryKey: [queryKeys.BLOCK_DISCUSSIONS, id.id, blockId],
      enabled: opts.enabled,
    },
  )
  return response
}

export function entityQuery(id: UnpackedHypermediaId): Promise<HMDocument> {
  const queryString = new URLSearchParams({
    v: id?.version || '',
    l: id?.latest ? 'true' : '',
  }).toString()
  const url = `/hm/api/entity/${id?.uid}${
    id?.path ? `/${id.path.join('/')}` : ''
  }?${queryString}`
  return queryAPI<HMDocument>(url)
}

export function injectModels() {
  setSearchQuery(searchQuery)
  setEntityQuery(entityQuery)
  setRecentsQuery(getRecents)
  setDeleteRecents(deleteRecent)
  setAccountQuery(accountQuery)
}
