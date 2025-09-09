import {
  HMCitationsPayload,
  HMMetadataPayload,
  HMResource,
  packHmId,
  queryKeys,
  setSearchQuery,
  UnpackedHypermediaId,
} from '@shm/shared'
import {
  createBatchAccountsResolver,
  setAccountQuery,
  setBatchAccountQuery,
  setResourceQuery,
} from '@shm/shared/models/entity'
import {setDeleteRecents, setRecentsQuery} from '@shm/shared/models/recents'
import {SearchPayload} from '@shm/shared/models/search'
import {useQuery, UseQueryOptions} from '@tanstack/react-query'
import {grpcClient} from './client'
import {deleteRecent, getRecents} from './local-db-recents'
import {HMDocumentChangesPayload} from './routes/api.changes.$'
import {ActivityPayload} from './routes/hm.api.activity'
import {InteractionSummaryPayload} from './routes/hm.api.interaction-summary'
import {unwrap} from './wrapping'

export async function queryAPI<ResponsePayloadType>(url: string) {
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
    contextSize, // perspectiveAccountUid,
  }: {
    accountUid?: string
    includeBody?: boolean
    contextSize?: number
    // perspectiveAccountUid?: string
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

const batchAccountQuery = createBatchAccountsResolver(grpcClient)

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

export function resourceQuery(id: UnpackedHypermediaId): Promise<HMResource> {
  const queryString = new URLSearchParams({
    v: id?.version || '',
    l: id?.latest ? 'true' : '',
  }).toString()
  const url = `/hm/api/resource/${id?.uid}${
    id?.path ? `/${id.path.join('/')}` : ''
  }?${queryString}`
  return queryAPI<HMResource>(url)
}

export function injectModels() {
  setSearchQuery(searchQuery)
  setResourceQuery(resourceQuery)
  setRecentsQuery(getRecents)
  setDeleteRecents(deleteRecent)
  setAccountQuery(accountQuery)
  setBatchAccountQuery(batchAccountQuery)
}
