import {grpcClient} from '@/grpc-client'
import {queryKeys} from '@shm/shared'
import {createFeedLoader} from '@shm/shared/feed-loader'
import {useInfiniteQuery} from '@tanstack/react-query'

const {loadDocumentFeed} = createFeedLoader(grpcClient)

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
      return await loadDocumentFeed({
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
