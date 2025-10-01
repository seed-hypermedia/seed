import {grpcClient} from '@/grpc-client'
import {queryKeys, UnpackedHypermediaId} from '@shm/shared'
import {createFeedLoader} from '@shm/shared/feed-loader'
import {useInfiniteQuery} from '@tanstack/react-query'

const {loadDocumentFeed} = createFeedLoader(grpcClient)

export function useDocFeed({
  docId,
  pageSize,
  filterAuthors,
  filterResource,
  filterEventType,
}: {
  docId: UnpackedHypermediaId
  pageSize?: number
  filterAuthors?: string[]
  filterResource?: string
  filterEventType?: string[]
}) {
  return useInfiniteQuery(
    [queryKeys.FEED, docId.id],
    async ({pageParam}) => {
      return await loadDocumentFeed({
        docId,
        pageToken: pageParam,
        pageSize,
        filterAuthors,
        filterResource,
        filterEventType,
      })
    },
    {
      getNextPageParam: (lastPage, allPages) => {
        const next = lastPage.nextPageToken
        return next || undefined
      },
    },
  )
}
