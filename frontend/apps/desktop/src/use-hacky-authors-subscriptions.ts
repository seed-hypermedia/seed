import {hmId} from '@shm/shared'
import {useUniversalClient} from '@shm/shared/routing'
import {useEffect, useMemo, useRef} from 'react'

/**
 * Desktop-only hook to subscribe to author resources for syncing.
 * Only creates subscriptions - does NOT use useResources/useDiscoveryStates
 * to avoid triggering re-renders of the parent component when discovery
 * states change (which would re-render hundreds of comments).
 */
export function useHackyAuthorsSubscriptions(authorIds: string[]) {
  const client = useUniversalClient()

  // Create stable key from sorted IDs to detect actual content changes
  const idsKey = useMemo(() => [...authorIds].sort().join(','), [authorIds])

  // Track previous IDs to avoid recreating hmId objects unnecessarily
  const prevIdsRef = useRef<string>('')
  const hmIdsRef = useRef<ReturnType<typeof hmId>[]>([])

  // Only recalculate hmIds when the actual content changes
  const hmIds = useMemo(() => {
    if (prevIdsRef.current !== idsKey) {
      prevIdsRef.current = idsKey
      hmIdsRef.current = authorIds.map((id) => hmId(id))
    }
    return hmIdsRef.current
  }, [idsKey, authorIds])

  // Subscribe directly without useResources to avoid re-render cascade
  useEffect(() => {
    if (!client.subscribeEntity) return
    const cleanups = hmIds
      .filter((id) => !!id)
      .map((id) => client.subscribeEntity!({id}))
    return () => cleanups.forEach((cleanup) => cleanup())
  }, [idsKey, client.subscribeEntity])
}
