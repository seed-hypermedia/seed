import {useCallback, useRef} from 'react'
import {useNavigate} from 'react-router-dom'
import {useInfiniteFeed} from '../models'
import DataViewer from './DataViewer'

export default function Feed() {
  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
    error,
  } = useInfiniteFeed(10)
  const navigate = useNavigate()
  const observerRef = useRef<IntersectionObserver>()
  const loadingRef = useRef<HTMLDivElement>(null)

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

  console.log('feed.data', allEvents)

  if (isLoading) {
    return (
      <div className="container p-4 mx-auto max-w-4xl">
        <h1 className="mb-6 text-3xl font-bold text-gray-900">Event Feed</h1>
        <div className="text-center">Loading...</div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="container p-4 mx-auto max-w-4xl">
        <h1 className="mb-6 text-3xl font-bold text-gray-900">Event Feed</h1>
        <div className="text-center text-red-600">Error loading feed</div>
      </div>
    )
  }

  return (
    <div className="container p-4 mx-auto max-w-4xl">
      <h1 className="mb-6 text-3xl font-bold text-gray-900">Event Feed</h1>
      <div className="flex flex-col gap-4">
        {allEvents.map((event: any, index: number) => (
          <div
            className="container p-4 mx-auto bg-white rounded-lg shadow max-w-4xl"
            key={event.newBlob.cid}
            ref={index === allEvents.length - 1 ? lastElementRef : undefined}
          >
            <DataViewer data={event} onNavigate={navigate} />
          </div>
        ))}
        {isFetchingNextPage && (
          <div className="text-center py-4">
            <div className="inline-block animate-spin rounded-full h-6 w-6 border-b-2 border-gray-900"></div>
            <span className="ml-2">Loading more...</span>
          </div>
        )}
      </div>
    </div>
  )
}
