import {useDocFeed} from '@/models/feed'
import {UnpackedHypermediaId} from '@shm/shared'
import {FeedEvent} from '@shm/ui/feed-items'
import {useCallback, useRef} from 'react'
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
          rootMargin: '100px',
        },
      )
      if (node) observerRef.current.observe(node)
    },
    [isLoading, hasNextPage, isFetchingNextPage, fetchNextPage],
  )

  // Flatten all pages into a single array of events
  const allEvents = data?.pages.flatMap((page) => page.events) || []

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
          return <FeedEvent event={event} key={event.id} />
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
