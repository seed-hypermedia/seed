import {addSubscribedEntity, getDiscoveryStream, removeSubscribedEntity} from '@/models/entities'
import {deleteRecent, fetchRecents} from '@/models/recents'
import {client as trpcClient} from '@/trpc'
import type {HMSigner, UnpackedHypermediaId} from '@shm/shared'
import type {UniversalClient} from '@shm/shared/universal-client'
import {createSeedClient} from '@seed-hypermedia/client'
import {API_HTTP_URL} from '@shm/shared/constants'
import {base58btc} from 'multiformats/bases/base58'
import {CommentBox} from './components/commenting'
import {grpcClient} from './grpc-client'

const seedClient = createSeedClient(API_HTTP_URL)

function getSigner(accountUid: string): HMSigner {
  return {
    getPublicKey: async () => new Uint8Array(base58btc.decode(accountUid)),
    sign: async (data: Uint8Array) => {
      const result = await grpcClient.daemon.signData({
        signingKeyName: accountUid,
        data: new Uint8Array(data),
      })
      return new Uint8Array(result.signature)
    },
  }
}

export const desktopUniversalClient: UniversalClient = {
  CommentEditor: ({docId}: {docId: UnpackedHypermediaId}) => <CommentBox docId={docId} context="document-content" />,

  fetchRecents: fetchRecents,
  deleteRecent: deleteRecent,

  request: seedClient.request,
  publish: seedClient.publish,

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

  getSigner,
}
