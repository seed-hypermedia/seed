import {
  HMCitationsPayload,
  HMCommentsPayload,
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
import {ActivityPayload} from './routes/hm.api.activity'
import {HMDocumentChangeInfo} from './routes/hm.api.changes'
import {DiscussionPayload} from './routes/hm.api.discussion'
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
  return useAPI<Array<HMDocumentChangeInfo>>(
    id ? `/hm/api/changes?id=${packHmId(id)}` : undefined,
    {enabled: !!id},
  )
}

export function useDiscussion(
  docId: UnpackedHypermediaId,
  targetCommentId?: string,
) {
  let url = `/hm/api/discussion?id=${docId.id}`
  if (targetCommentId) {
    url += `&targetCommentId=${targetCommentId}`
  }
  const response = useAPI<DiscussionPayload>(url, {
    queryKey: [queryKeys.DOCUMENT_DISCUSSION, docId.id, targetCommentId],
  })
  return response
}

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

export function searchQuery(input: string, accountUid?: string) {
  return queryAPI<SearchPayload>(`/hm/api/search?q=${input}&a=${accountUid}`)
}

async function accountQuery(accountUid: string) {
  const response = await queryAPI<HMMetadataPayload>(
    `/hm/api/account/${accountUid}`,
  )
  return response
}

export function useCitations(id: UnpackedHypermediaId) {
  const response = useAPI<HMCitationsPayload>(`/hm/api/citations?id=${id.id}`)

  return response
}

export function useComments(id: UnpackedHypermediaId) {
  const response = useAPI<HMCommentsPayload>(`/hm/api/comments?id=${id.id}`, {
    queryKey: [queryKeys.DOCUMENT_DISCUSSION, id.id],
  })
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
