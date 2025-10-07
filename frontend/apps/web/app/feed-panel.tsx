import {UnpackedHypermediaId} from '@shm/shared'
import {FeedEvent} from '@shm/ui/feed-items'
import {useCallback, useEffect, useRef} from 'react'
import {useDocFeed} from './models'

export function WebFeedPanel({
  docId,
  filterResource,
  filterAuthors,
  filterEventType,
}: {
  docId: UnpackedHypermediaId
  filterResource?: string
  filterAuthors?: string[]
  filterEventType?: string[]
}) {
  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
    error,
  } = useDocFeed({
    docId,
    filterResource: filterResource || `${docId.id}*`,
    filterAuthors,
    filterEventType,
  })

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
        if (entry?.isIntersecting && hasNextPage && !isFetchingNextPage) {
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
    return <div>Loading...</div>
  }

  if (error) {
    return <div>Error loading feed</div>
  }

  return (
    <>
      <div className="flex flex-col">
        {allEvents.map((event, index) => {
          if (!event) return null
          const isLast = index === allEvents.length - 1
          const item = <FeedEvent event={event} />
          return item ? (
            <div key={event.id} ref={isLast ? lastElementRef : undefined}>
              {item}
            </div>
          ) : null
        })}
      </div>
      {isFetchingNextPage && (
        <div className="text-muted-foreground py-3 text-center">
          Loading more...
        </div>
      )}
      {!hasNextPage && allEvents.length > 0 && (
        <div className="text-muted-foreground py-3 text-center">
          No more events
        </div>
      )}
    </>
  )
}
