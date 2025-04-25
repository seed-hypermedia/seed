import {useFetcher} from '@remix-run/react'
import {
  HMCitationsPayload,
  HMDocument,
  packHmId,
  queryKeys,
  setSearchQuery,
  UnpackedHypermediaId,
} from '@shm/shared'
import {setEntityQuery} from '@shm/shared/models/entity'
import {setDeleteRecents, setRecentsQuery} from '@shm/shared/models/recents'
import {SearchPayload} from '@shm/shared/models/search'
import {useQuery, UseQueryOptions} from '@tanstack/react-query'
import {useEffect} from 'react'
import {deleteRecent, getRecents} from './local-db-recents'
import {ActivityPayload} from './routes/hm.api.activity'
import {HMDocumentChangeInfo} from './routes/hm.api.changes'
import {DiscussionPayload} from './routes/hm.api.discussion'
import {unwrap} from './wrapping'

export function useDocumentChanges(id: UnpackedHypermediaId | undefined) {
  const fetcher = useFetcher()
  useEffect(() => {
    if (!id?.uid) return
    const url = `/hm/api/changes?id=${packHmId(id)}`
    fetcher.load(url)
  }, [id?.uid, id?.path?.join('/')])

  return {
    data: fetcher.data
      ? unwrap<Array<HMDocumentChangeInfo>>(fetcher.data)
      : null,
    isLoading: fetcher.state === 'loading',
  }
}

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

export function useCitations(id: UnpackedHypermediaId) {
  const response = useAPI<HMCitationsPayload>(`/hm/api/citations?id=${id.id}`)
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
}
