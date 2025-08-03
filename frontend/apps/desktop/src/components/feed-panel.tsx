import {useDocFeed} from '@/models/feed'
import {UnpackedHypermediaId} from '@shm/shared'
import {FeedEvent} from '@shm/ui/feed-items'
import {useCallback, useEffect, useRef} from 'react'
import {AccessoryContent} from './accessory-sidebar'

export function FeedPanel({docId}: {docId: UnpackedHypermediaId}) {
  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
    error,
  } = useDocFeed(docId)
  const observerRef = useRef<IntersectionObserver>()

  const lastElementRef = useCallback(
    (node: HTMLDivElement) => {
      if (isLoading) return
      if (observerRef.current) observerRef.current.disconnect()

      observerRef.current = new IntersectionObserver(
        (entries) => {
          if (entries[0].isIntersecting && hasNextPage && !isFetchingNextPage) {
            fetchNextPage()
          }
        },
        {
          // Use the scroll area viewport as the root
          root: document.querySelector('[data-radix-scroll-area-viewport]'),
          rootMargin: '200px', // Increased to load earlier
        },
      )
      if (node) observerRef.current.observe(node)
    },
    [isLoading, hasNextPage, isFetchingNextPage, fetchNextPage],
  )

  // Flatten all pages into a single array of events
  const allEvents = data?.pages.flatMap((page) => page.events) || []

  // Auto-load more items if we don't have enough to fill the viewport
  useEffect(() => {
    if (
      !isLoading &&
      !isFetchingNextPage &&
      hasNextPage &&
      allEvents.length < 10
    ) {
      fetchNextPage()
    }
  }, [
    isLoading,
    isFetchingNextPage,
    hasNextPage,
    allEvents.length,
    fetchNextPage,
  ])

  if (isLoading) {
    return (
      <AccessoryContent>
        <div>Loading...</div>
      </AccessoryContent>
    )
  }

  if (error) {
    return (
      <AccessoryContent>
        <div>Error loading feed</div>
      </AccessoryContent>
    )
  }

  return (
    <AccessoryContent title="Feed">
      <div>
        {allEvents.map((event, index) => {
          const isLast = index === allEvents.length - 1
          return (
            <div key={event.id} ref={isLast ? lastElementRef : undefined}>
              <FeedEvent event={event} />
            </div>
          )
        })}
        {isFetchingNextPage && (
          <div className="py-3 text-center text-muted-foreground">
            Loading more...
          </div>
        )}
        {!hasNextPage && allEvents.length > 0 && (
          <div className="py-3 text-center text-muted-foreground">
            No more events
          </div>
        )}
      </div>
    </AccessoryContent>
  )
}
