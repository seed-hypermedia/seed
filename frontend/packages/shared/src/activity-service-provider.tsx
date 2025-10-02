import {useInfiniteQuery} from '@tanstack/react-query'
import {createContext, PropsWithChildren, useContext, useMemo} from 'react'
import {ActivityService, ListEventsResponse} from './models/activity-service'
import {queryKeys} from './models/query-keys'
import {UnpackedHypermediaId} from './hm-types'

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
 */
export function useActivityFeed({
  docId,
  pageSize,
  filterAuthors,
  filterResource,
  filterEventType,
}: {
  docId: UnpackedHypermediaId
  pageSize?: number
  filterAuthors?: string[]
  filterResource?: string
  filterEventType?: string[]
}) {
  const context = useActivityServiceContext()

  return useInfiniteQuery(
    [queryKeys.ACTIVITY_FEED, docId.id],
    async ({pageParam}): Promise<ListEventsResponse> => {
      if (!context.service) {
        return {events: [], nextPageToken: ''}
      }
      return await context.service.listEvents({
        pageSize,
        filterAuthors,
        filterEventType,
        filterResource: filterResource ? filterResource : `${docId.id}*`,
        pageToken: pageParam as string | undefined,
      })
    },
    {
      getNextPageParam: (lastPage) => {
        return lastPage.nextPageToken || undefined
      },
      enabled: !!context.service,
    },
  )
}
