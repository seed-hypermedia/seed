import {useInfiniteQuery} from '@tanstack/react-query'
import {createContext, PropsWithChildren, useContext, useMemo} from 'react'
import {ActivityService, LoadedEvent} from './models/activity-service'
import {queryKeys} from './models/query-keys'

type LoadedEventsResponse = {
  events: LoadedEvent[]
  failedCount: number
  nextPageToken: string
}

type ActivityProviderValue = {
  service: ActivityService | null
}

const defaultActivityContext: ActivityProviderValue = {
  service: null,
}

const ActivityContext = createContext<ActivityProviderValue>(
  defaultActivityContext,
)

export function ActivityProvider({
  children,
  service = null,
}: PropsWithChildren<ActivityProviderValue>) {
  return (
    <ActivityContext.Provider value={useMemo(() => ({service}), [service])}>
      {children}
    </ActivityContext.Provider>
  )
}

export function useActivityServiceContext() {
  const context = useContext(ActivityContext)
  if (!context) {
    throw new Error('ActivityContext not found')
  }
  return context
}

/**
 * Hook for document-specific activity feed with infinite scroll pagination
 * Matches the existing useDocFeed pattern from both web and desktop apps
 * Automatically sets filterResource to docId.id* to get all events for a document
 *
 * Returns resolved/loaded events ready for UI rendering
 */
export function useActivityFeed({
  currentAccount,
  pageSize,
  filterAuthors,
  filterResource,
  filterEventType,
}: {
  currentAccount: string
  pageSize?: number
  filterAuthors?: string[]
  filterResource?: string
  filterEventType?: string[]
}) {
  const context = useActivityServiceContext()

  return useInfiniteQuery({
    queryKey: [
      queryKeys.ACTIVITY_FEED,
      filterResource,
      filterAuthors,
      filterEventType,
      currentAccount,
    ],
    queryFn: async ({pageParam}): Promise<LoadedEventsResponse> => {
      if (!context.service) {
        return {events: [], failedCount: 0, nextPageToken: ''}
      }

      try {
        // Fetch the page of events
        const response = await context.service.listEvents({
          pageSize,
          filterAuthors,
          filterEventType,
          filterResource,
          pageToken: pageParam as string | undefined,
        })

        // Resolve all events in this page with individual error handling
        const resolvedEvents = await Promise.allSettled(
          response.events.map((event) =>
            context.service!.resolveEvent(event, currentAccount),
          ),
        )

        // Filter out failed promises and null values
        const filteredEvents = resolvedEvents
          .filter((result) => result.status === 'fulfilled' && result.value)
          .map(
            (result) => (result as PromiseFulfilledResult<LoadedEvent>).value,
          )

        // Count failures (rejected promises or null results)
        const failedCount = resolvedEvents.filter(
          (result) => result.status === 'rejected' || !result.value,
        ).length

        return {
          events: filteredEvents,
          failedCount,
          nextPageToken: response.nextPageToken,
        }
      } catch (error) {
        console.error('Activity feed query error:', error)
        // Return empty results instead of throwing to prevent error boundary activation
        return {events: [], failedCount: 0, nextPageToken: ''}
      }
    },
    getNextPageParam: (lastPage) => {
      return lastPage.nextPageToken || undefined
    },
    retry: 3,
    retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000),
    enabled: !!context.service,
  })
}
