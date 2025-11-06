import type {UnpackedHypermediaId} from '@shm/shared'
import {createWebUniversalClient} from '@shm/shared'
import WebCommenting from './commenting'
import {deleteRecent, getRecents} from './local-db-recents'
import {queryAPI, useAPI} from './models'

export const webUniversalClient = createWebUniversalClient({
  queryAPI,
  useAPI,
  CommentEditor: ({docId}: {docId: UnpackedHypermediaId}) => (
    <WebCommenting docId={docId} />
  ),
  loadRecents: getRecents,
  deleteRecent: deleteRecent,
})
