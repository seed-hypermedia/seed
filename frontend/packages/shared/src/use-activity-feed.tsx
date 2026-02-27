import {useInfiniteQuery} from '@tanstack/react-query'
import {HMListEventsInput, HMListEventsRequest} from './hm-types'
import {useSelectedAccountId} from './models/entity'
import {LoadedEventWithNotifMeta} from './models/activity-service'
import {queryKeys} from './models/query-keys'
import {useUniversalClient} from './routing'

type LoadedEventsResponse = {
  events: LoadedEventWithNotifMeta[]
  nextPageToken: string
}

/**
 * Hook for document-specific activity feed with infinite scroll pagination
 * Matches the existing useDocFeed pattern from both web and desktop apps
 * Automatically sets filterResource to docId.id* to get all events for a document
 *
 * Returns resolved/loaded events ready for UI rendering
 */
export function useActivityFeed({
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
  const client = useUniversalClient()
  const currentAccount = useSelectedAccountId()

  return useInfiniteQuery({
    queryKey: [queryKeys.ACTIVITY_FEED, filterResource, filterAuthors, filterEventType, currentAccount],
    queryFn: async ({pageParam}): Promise<LoadedEventsResponse> => {
      try {
        const input: HMListEventsInput = {
          pageSize,
          filterAuthors,
          filterEventType,
          filterResource,
          pageToken: pageParam as string | undefined,
          currentAccount: currentAccount ?? undefined,
        }

        // Fetch pre-resolved events from API
        const response = await client.request<HMListEventsRequest>('ListEvents', input)

        return {
          events: response.events as LoadedEventWithNotifMeta[],
          nextPageToken: response.nextPageToken,
        }
      } catch (error) {
        console.error('Activity feed query error:', error)
        // Return empty results instead of throwing to prevent error boundary activation
        return {events: [], nextPageToken: ''}
      }
    },
    getNextPageParam: (lastPage) => {
      return lastPage.nextPageToken || undefined
    },
    retry: 3,
    retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000),
  })
}
