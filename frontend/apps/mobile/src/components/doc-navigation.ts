import {createNavigationContainerRef, StackActions} from '@react-navigation/native'
import type {UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import type {RootStackParamList} from '../navigation/types'

/**
 * Navigation ref so deeply nested content (cards inside query blocks and
 * embeds) can open documents without threading navigation props through
 * every block renderer.
 */
export const navigationRef = createNavigationContainerRef<RootStackParamList>()

/**
 * Opens a document on a new screen.
 *
 * This pushes rather than navigates: every document page is the same `Document`
 * route, and `navigate` would find the route already in the stack and just swap
 * its params — replacing the current page instead of stacking a new one, so
 * back would never return to the document you followed the link from.
 */
export function openDocument(id: UnpackedHypermediaId, title?: string): void {
  if (!navigationRef.isReady()) return
  navigationRef.dispatch(
    StackActions.push('Document', {
      uid: id.uid,
      path: id.path ?? [],
      ...(title ? {title} : {}),
    }),
  )
}
