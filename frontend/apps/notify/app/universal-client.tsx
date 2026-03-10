import type {UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import type {UniversalClient} from '@shm/shared'
import {createWebUniversalClient} from '@shm/shared/create-web-universal-client'
import {createSeedClient} from '@seed-hypermedia/client'
import {SITE_BASE_URL} from '@shm/shared/constants'

const seedClient = createSeedClient(SITE_BASE_URL)

// Placeholder comment editor for notify app
function NotifyCommentEditor({docId}: {docId: UnpackedHypermediaId}) {
  return <div>Comments not available in notify app</div>
}

export const notifyUniversalClient = createWebUniversalClient({
  request: seedClient.request as UniversalClient['request'],
  publish: seedClient.publish,
  CommentEditor: NotifyCommentEditor,
  // Notify app doesn't have recents
  fetchRecents: async () => [],
  deleteRecent: async () => {},
})
