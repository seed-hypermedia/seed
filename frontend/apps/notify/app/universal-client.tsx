import type {UnpackedHypermediaId} from '@shm/shared'
import {createWebUniversalClient} from '@shm/shared'
import {queryAPI, useAPI} from './models'

// Placeholder comment editor for notify app
function NotifyCommentEditor({docId}: {docId: UnpackedHypermediaId}) {
  return <div>Comments not available in notify app</div>
}

export const notifyUniversalClient = createWebUniversalClient({
  queryAPI,
  useAPI,
  CommentEditor: NotifyCommentEditor,
  // Notify app doesn't have recents
  fetchRecents: async () => [],
  deleteRecent: async () => {},
})
