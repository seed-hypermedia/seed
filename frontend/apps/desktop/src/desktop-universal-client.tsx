import {addSubscribedEntity, removeSubscribedEntity} from '@/models/entities'
import {deleteRecent, fetchRecents} from '@/models/recents'
import type {UnpackedHypermediaId} from '@shm/shared'
import type {UniversalClient} from '@shm/shared/universal-client'
import {CommentBox} from './components/commenting'
import {desktopRequest} from './desktop-api'

export const desktopUniversalClient: UniversalClient = {
  CommentEditor: ({docId}: {docId: UnpackedHypermediaId}) => (
    <CommentBox docId={docId} context="document-content" />
  ),

  fetchRecents: fetchRecents,
  deleteRecent: deleteRecent,

  request: desktopRequest,

  subscribeEntity: ({id, recursive}) => {
    const sub = {id, recursive}
    addSubscribedEntity(sub)
    return () => removeSubscribedEntity(sub)
  },
}
