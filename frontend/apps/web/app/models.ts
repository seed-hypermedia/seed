import {useFetcher} from '@remix-run/react'
import {
  packHmId,
  queryKeys,
  setSearchQuery,
  UnpackedHypermediaId,
} from '@shm/shared'
import {useQuery, UseQueryOptions} from '@tanstack/react-query'
import {useEffect} from 'react'
import {WebBaseDocumentPayload} from './loaders'
import {ActivityPayload} from './routes/hm.api.activity'
import {HMDocumentChangeInfo} from './routes/hm.api.changes'
import {DiscussionPayload} from './routes/hm.api.discussion'
import {SearchPayload} from './routes/hm.api.search'
import {unwrap} from './wrapping'

export function useEntity(id: UnpackedHypermediaId | undefined) {
  const queryString = new URLSearchParams({
    v: id?.version || '',
    l: id?.latest ? 'true' : '',
  }).toString()
  const url = `/hm/api/entity/${id?.uid}${
    id?.path ? `/${id.path.join('/')}` : ''
  }?${queryString}`
  return useAPI<WebBaseDocumentPayload>(url, {
    enabled: !!id?.uid,
  })
}

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

async function queryAPI<ResponsePayloadType>(url: string | undefined) {
  if (!url) return
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

export function searchQuery(input: string) {
  return queryAPI<SearchPayload>(`/hm/api/search?q=${input}`)
}

setSearchQuery(searchQuery)
