import {createNavigationContainerRef} from '@react-navigation/native'
import type {UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import type {RootStackParamList} from '../navigation/types'

/**
 * Navigation ref so deeply nested content (cards inside query blocks and
 * embeds) can open documents without threading navigation props through
 * every block renderer.
 */
export const navigationRef = createNavigationContainerRef<RootStackParamList>()

export function openDocument(id: UnpackedHypermediaId, title?: string): void {
  if (!navigationRef.isReady()) return
  navigationRef.navigate('Document', {
    uid: id.uid,
    path: id.path ?? [],
    ...(title ? {title} : {}),
  })
}
