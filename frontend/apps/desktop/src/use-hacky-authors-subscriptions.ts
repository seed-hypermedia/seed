import {hmId} from '@shm/shared'
import {useMemo} from 'react'
import {useSubscribedResources} from './models/entities'

/**
 * Desktop-only hook to subscribe to author resources for syncing.
 * This is a temporary workaround while syncing is improved.
 */
export function useHackyAuthorsSubscriptions(authorIds: string[]) {
  useSubscribedResources(
    useMemo(
      () => authorIds.map((id) => ({id: hmId(id), recursive: false})),
      [authorIds],
    ),
  )
}
