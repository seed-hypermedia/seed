import {grpcClient} from '@/grpc-client'
import {queryKeys, UnpackedHypermediaId} from '@shm/shared'
import {createFeedLoader} from '@shm/shared/feed-loader'
import {useInfiniteQuery} from '@tanstack/react-query'

const {loadDocumentFeed} = createFeedLoader(grpcClient)

export function useDocFeed(docId: UnpackedHypermediaId) {
  return useInfiniteQuery(
    [queryKeys.FEED, docId.id],
    async ({pageParam}) => {
      return await loadDocumentFeed(docId, pageParam)
    },
    {
      getNextPageParam: (lastPage, allPages) => {
        const next = lastPage.nextPageToken
        return next || undefined
      },
    },
  )
}
