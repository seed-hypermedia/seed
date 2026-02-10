import {hmId, useResources} from '@shm/shared'
import {useMemo, useRef} from 'react'

/**
 * Desktop-only hook to subscribe to author resources for syncing.
 * This is a temporary workaround while syncing is improved.
 *
 * Uses stable ID references to prevent subscription churn when
 * authorIds array reference changes but content is the same.
 */
export function useHackyAuthorsSubscriptions(authorIds: string[]) {
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

  useResources(hmIds, {subscribed: true})
}
