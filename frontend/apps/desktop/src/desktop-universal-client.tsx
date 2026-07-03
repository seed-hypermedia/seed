import {createSeedClient} from '@seed-hypermedia/client'
import type {UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {API_HTTP_URL} from '@shm/shared/constants'
import type {UniversalClient} from '@shm/shared/universal-client'
import {base58btc} from 'multiformats/bases/base58'
import {grpcClient} from '@/grpc-client'
import {addSubscribedEntity, getDiscoveryStream, removeSubscribedEntity} from '@/models/entities'
import {deleteRecent, fetchRecents} from '@/models/recents'
import {client as trpcClient} from '@/trpc'
import {publishDesktopDocument} from '@/utils/publish-document'
import {CommentBox} from './components/commenting'

const seedClient = createSeedClient(API_HTTP_URL)

const publishSeedDocument: Parameters<typeof publishDesktopDocument>[0]['publishDocument'] = (input, signer) => {
  const publishDocument = seedClient.publishDocument as typeof seedClient.publishDocument | undefined
  if (typeof publishDocument !== 'function') {
    throw new Error(
      'Seed client publishDocument is not available. Rebuild frontend packages and restart the desktop app.',
    )
  }
  return publishDocument(input, signer)
}

function getSigner(accountUid: string) {
  return {
    getPublicKey: async () => new Uint8Array(base58btc.decode(accountUid)),
    sign: async (data: Uint8Array) => {
      const result = await grpcClient.daemon.signData({signingKeyName: accountUid, data: new Uint8Array(data)})
      return new Uint8Array(result.signature)
    },
  }
}

export const desktopUniversalClient: UniversalClient = {
  CommentEditor: ({docId}: {docId: UnpackedHypermediaId}) => <CommentBox docId={docId} context="document-content" />,

  fetchRecents: fetchRecents,
  deleteRecent: deleteRecent,

  request: seedClient.request as UniversalClient['request'],
  publish: seedClient.publish,

  subscribeEntity: ({id, recursive, scope}) => {
    const sub = {id, recursive, scope}
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

  publishDocument: (input) =>
    publishDesktopDocument(
      {
        publishDocument: publishSeedDocument,
        getSigner,
      },
      input,
    ),
}
