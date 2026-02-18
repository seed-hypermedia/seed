import type {UnpackedHypermediaId} from '@shm/shared'
import {createWebUniversalClient} from '@shm/shared'
import {cborEncode, postCBOR as rawPostCBOR} from './api'
import WebCommenting from './commenting'
import {deleteRecent, getRecents} from './local-db-recents'
import {queryAPI} from './models'

export const webUniversalClient = createWebUniversalClient({
  queryAPI,
  postCBOR: (url: string, data: any) => rawPostCBOR(url, cborEncode(data)),
  CommentEditor: ({docId}: {docId: UnpackedHypermediaId}) => {
    return <WebCommenting docId={docId} />
  },
  fetchRecents: getRecents,
  deleteRecent: deleteRecent,
})
