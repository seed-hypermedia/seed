import {addSubscribedEntity, getDiscoveryStream, removeSubscribedEntity} from '@/models/entities'
import {deleteRecent, fetchRecents} from '@/models/recents'
import {client as trpcClient} from '@/trpc'
import type {HMSigner, UnpackedHypermediaId} from '@shm/shared'
import type {DeleteCommentInput, UniversalClient} from '@shm/shared/universal-client'
import {base58btc} from 'multiformats/bases/base58'
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
  CommentEditor: ({docId}: {docId: UnpackedHypermediaId}) => <CommentBox docId={docId} context="document-content" />,

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

  drafts: {
    listAccountDrafts: (accountUid) => trpcClient.drafts.listAccount.query(accountUid),
  },

  getSigner: (accountUid: string): HMSigner => ({
    getPublicKey: async () => new Uint8Array(base58btc.decode(accountUid)),
    sign: async (data: Uint8Array) => {
      const result = await grpcClient.daemon.signData({
        signingKeyName: accountUid,
        data: new Uint8Array(data),
      })
      return new Uint8Array(result.signature)
    },
  }),
}
