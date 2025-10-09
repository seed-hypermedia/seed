import {
  HMCitationsPayload,
  HMMetadataPayload,
  HMMetadataPayloadSchema,
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
import {
  useInfiniteQuery,
  useQuery,
  UseQueryOptions,
} from '@tanstack/react-query'
import {serverOnly$} from 'vite-env-only/macros'
import {grpcClient} from './client.server'
import {deleteRecent, getRecents} from './local-db-recents'
import {HMDocumentChangesPayload} from './routes/api.changes.$'
import {ActivityPayload} from './routes/hm.api.activity'
import {HMFeedPayload} from './routes/hm.api.feed'
import {InteractionSummaryPayload} from './routes/hm.api.interaction-summary'
import {unwrap} from './wrapping'

export async function queryAPI<ResponsePayloadType>(url: string) {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.statusText}`)
  }
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
    perspectiveAccountUid,
  }: {
    accountUid?: string
    includeBody?: boolean
    contextSize?: number
    perspectiveAccountUid?: string
  } = {},
) {
  const url = `/hm/api/search?q=${input}&a=${
    accountUid || ''
  }&b=${includeBody}&c=${contextSize}&d=${perspectiveAccountUid || ''}`
  return queryAPI<SearchPayload>(url)
}

async function accountQuery(accountUid: string) {
  const response = await queryAPI<HMMetadataPayload>(
    `/hm/api/account/${accountUid}`,
  )
  return HMMetadataPayloadSchema.parse(response)
}

// The batchAccountQuery has to be this weird because this file mixes client-side and server-side concerns,
// and dev builds with Vite are not happy about it. The batchAccountQuery is only used on the server,
// so here we use a dynamic import to avoid loading the grpc stuff on the client.
//
// TODO: all of this would be so much easier to reason about if it was all passed down explicitly as parameters to the relevant pieces of code,
// without globals, singletons, and confusing injectModels() calls. Dependency Injection FTW.

const batchAccountQuery = serverOnly$(createBatchAccountsResolver(grpcClient))

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

export function useDocFeed({
  pageSize,
  filterAuthors,
  filterResource,
  filterEventType,
}: {
  pageSize?: number
  filterAuthors?: string[]
  filterResource?: string
  filterEventType?: string[]
}) {
  return useInfiniteQuery(
    [queryKeys.FEED, filterResource, filterAuthors, filterEventType],
    async ({pageParam}) => {
      if (!filterResource) throw Error('No filterResource on Feed API')

      let url = `/hm/api/feed?filterResource=${filterResource}`
      if (pageSize) {
        url += `&pageSize=${pageSize}`
      }
      if (filterAuthors) {
        url += `&filterAuthors=${filterAuthors.join(',')}`
      }
      if (filterEventType) {
        url += `&filterEventType=${filterEventType.join(',')}`
      }
      if (pageParam) {
        url += `&pageToken=${pageParam}`
      }
      return await queryAPI<HMFeedPayload>(url)
    },
    {
      getNextPageParam: (lastPage, allPages) => {
        const next = lastPage.nextPageToken
        return next || undefined
      },
    },
  )
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
  console.log('WEB RESOURCE QUERY', url)
  return queryAPI<HMResource>(url)
}

export function injectModels() {
  console.log('INJECTING MODELS')
  setSearchQuery(searchQuery)
  setResourceQuery(resourceQuery)
  setRecentsQuery(getRecents)
  setDeleteRecents(deleteRecent)
  setAccountQuery(accountQuery)

  // This needs to be conditional because we only load this on the server.
  // We do this to prevent the grpc stuff leaking into the dev client builds,
  // as Vite is not being too smart about it.
  if (batchAccountQuery) {
    setBatchAccountQuery(batchAccountQuery)
  }
}
