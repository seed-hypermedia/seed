import {useQueryClient} from '@tanstack/react-query'
import {useCallback, useEffect, useRef, useState} from 'react'
import {useNavigate} from 'react-router-dom'
import {useInfiniteFeed, useLatestEvent} from '../models'
import DataViewer from './DataViewer'

export default function Feed() {
  const queryClient = useQueryClient()
  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
    error,
    refetch,
  } = useInfiniteFeed(10)
  const {data: latestEvent} = useLatestEvent()
  const navigate = useNavigate()
  const observerRef = useRef<IntersectionObserver>()
  const [showNewContentPill, setShowNewContentPill] = useState(false)
  const [isAtTop, setIsAtTop] = useState(true)
  const [latestKnownCid, setLatestKnownCid] = useState<string | null>(null)

  const lastElementRef = useCallback(
    (node: HTMLDivElement) => {
      if (isLoading) return
      if (observerRef.current) observerRef.current.disconnect()
      observerRef.current = new IntersectionObserver((entries) => {
        if (entries[0].isIntersecting && hasNextPage && !isFetchingNextPage) {
          fetchNextPage()
        }
      })
      if (node) observerRef.current.observe(node)
    },
    [isLoading, hasNextPage, isFetchingNextPage, fetchNextPage],
  )

  // Flatten all pages into a single array of events
  const allEvents = data?.pages.flatMap((page) => page.events) || []

  // Check for new content
  useEffect(() => {
    if (latestEvent && allEvents.length > 0) {
      const currentLatestCid = allEvents[0].newBlob.cid

      // Update the latest known CID when we have new data
      if (latestKnownCid !== currentLatestCid) {
        setLatestKnownCid(currentLatestCid)
      }

      if (latestEvent.newBlob.cid !== currentLatestCid) {
        if (isAtTop) {
          // If at top, automatically refresh by invalidating the entire query
          queryClient.invalidateQueries({queryKey: ['infinite-feed']})
        } else {
          // If scrolled down, show the pill
          setShowNewContentPill(true)
        }
      } else {
        // If CIDs match, hide the pill
        setShowNewContentPill(false)
      }
    }
  }, [latestEvent, allEvents, isAtTop, queryClient, latestKnownCid])

  // Track scroll position
  useEffect(() => {
    const handleScroll = () => {
      const scrollTop = window.scrollY
      setIsAtTop(scrollTop < 100) // Consider "at top" if within 100px
    }

    window.addEventListener('scroll', handleScroll)
    return () => window.removeEventListener('scroll', handleScroll)
  }, [])

  // Handle clicking the new content pill
  const handleNewContentClick = () => {
    setShowNewContentPill(false)
    // Invalidate the entire infinite query to get all new pages
    queryClient.invalidateQueries({queryKey: ['infinite-feed']})
    window.scrollTo({top: 0, behavior: 'smooth'})
  }

  console.log('feed.data', allEvents)

  if (isLoading) {
    return (
      <div className="container mx-auto max-w-4xl p-4">
        <h1 className="mb-6 text-3xl font-bold text-gray-900">Event Feed</h1>
        <div className="text-center">Loading...</div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="container mx-auto max-w-4xl p-4">
        <h1 className="mb-6 text-3xl font-bold text-gray-900">Event Feed</h1>
        <div className="text-center text-red-600">Error loading feed</div>
      </div>
    )
  }

  return (
    <div className="container mx-auto max-w-4xl p-4">
      {/* New Content Pill */}
      {showNewContentPill && (
        <div className="fixed top-20 left-1/2 z-50 -translate-x-1/2 transform">
          <button
            onClick={handleNewContentClick}
            className="bg-link hover:bg-link-hover flex items-center justify-center gap-2 rounded-full px-4 py-2 font-medium whitespace-nowrap text-white shadow-lg transition-colors duration-200"
          >
            <svg
              className="h-4 w-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
              />
            </svg>
            New events available
          </button>
        </div>
      )}

      <h1 className="mb-6 text-3xl font-bold text-gray-900">Event Feed</h1>
      <div className="flex flex-col gap-4">
        {allEvents.map((event: any, index: number) => (
          <div
            className="container mx-auto max-w-4xl rounded-lg bg-white p-4 shadow"
            key={event.newBlob.cid}
            ref={index === allEvents.length - 1 ? lastElementRef : undefined}
          >
            <DataViewer data={event} onNavigate={navigate} />
          </div>
        ))}
        {isFetchingNextPage && (
          <div className="py-4 text-center">
            <div className="inline-block h-6 w-6 animate-spin rounded-full border-b-2 border-gray-900"></div>
            <span className="ml-2">Loading more...</span>
          </div>
        )}
      </div>
    </div>
  )
}
