import {hmId, useResources} from '@shm/shared'
import {useMemo} from 'react'

/**
 * Desktop-only hook to subscribe to author resources for syncing.
 * This is a temporary workaround while syncing is improved.
 */
export function useHackyAuthorsSubscriptions(authorIds: string[]) {
  useResources(
    useMemo(() => authorIds.map((id) => hmId(id)), [authorIds]),
    {subscribed: true},
  )
}
