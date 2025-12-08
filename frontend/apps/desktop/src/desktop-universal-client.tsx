import {
  addSubscribedEntity,
  getDiscoveryStream,
  removeSubscribedEntity,
} from '@/models/entities'
import {deleteRecent, fetchRecents} from '@/models/recents'
import type {UnpackedHypermediaId} from '@shm/shared'
import type {
  DeleteCommentInput,
  UniversalClient,
} from '@shm/shared/universal-client'
import {CommentBox} from './components/commenting'
import {desktopRequest} from './desktop-api'
import {grpcClient} from './grpc-client'

async function deleteComment(input: DeleteCommentInput): Promise<void> {
  await grpcClient.comments.deleteComment({
    id: input.commentId,
    signingKeyName: input.signingAccountId,
  })
}

export const desktopUniversalClient: UniversalClient = {
  CommentEditor: ({docId}: {docId: UnpackedHypermediaId}) => (
    <CommentBox docId={docId} context="document-content" />
  ),

  fetchRecents: fetchRecents,
  deleteRecent: deleteRecent,
  deleteComment: deleteComment,

  request: desktopRequest,

  subscribeEntity: ({id, recursive}) => {
    const sub = {id, recursive}
    addSubscribedEntity(sub)
    return () => removeSubscribedEntity(sub)
  },

  discovery: {
    getDiscoveryStream,
  },
}
