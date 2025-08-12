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
  const scrollContainerRef = useRef<HTMLDivElement>(null)

  const lastElementRef = useCallback(
    (node: HTMLDivElement) => {
      // Disconnect previous observer
      if (observerRef.current) {
        observerRef.current.disconnect()
        observerRef.current = undefined
      }

      // Early return if no node or still loading
      if (!node || isLoading) {
        return
      }

      const scrollContainer = scrollContainerRef.current

      // Use the ref container or fallback to default viewport
      const observerOptions = scrollContainer
        ? {
            root: scrollContainer,
            rootMargin: '100px',
          }
        : {
            rootMargin: '100px',
          }

      observerRef.current = new IntersectionObserver((entries) => {
        const entry = entries[0]
        if (entry.isIntersecting && hasNextPage && !isFetchingNextPage) {
          fetchNextPage()
        }
      }, observerOptions)

      observerRef.current.observe(node)
    },
    [isLoading, hasNextPage, isFetchingNextPage, fetchNextPage],
  )

  // Cleanup observer on component unmount
  useEffect(() => {
    return () => {
      if (observerRef.current) {
        observerRef.current.disconnect()
        observerRef.current = undefined
      }
    }
  }, [])

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
    </AccessoryContent>
  )
}
