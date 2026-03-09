import {createSeedClient} from '@seed-hypermedia/client'
import type {HMSigner, UnpackedHypermediaId, UniversalClient} from '@shm/shared'
import {createWebUniversalClient} from '@shm/shared/create-web-universal-client'
import {keyPairStore} from './auth'
import {preparePublicKey} from './auth-utils'
import WebCommenting from './commenting'
import {deleteRecent, getRecents} from './local-db-recents'

const seedClient = createSeedClient('')

export const webUniversalClient = createWebUniversalClient({
  request: seedClient.request as UniversalClient['request'],
  publish: seedClient.publish,
  CommentEditor: ({docId}: {docId: UnpackedHypermediaId}) => {
    return <WebCommenting docId={docId} />
  },
  fetchRecents: getRecents,
  deleteRecent: deleteRecent,
  getSigner: (): HMSigner => ({
    getPublicKey: async () => {
      const kp = keyPairStore.get()
      if (!kp) throw new Error('No signing keys available')
      return preparePublicKey(kp.publicKey)
    },
    sign: async (data: Uint8Array) => {
      const kp = keyPairStore.get()
      if (!kp) throw new Error('No signing keys available')
      const sig = await crypto.subtle.sign(
        {...kp.privateKey.algorithm, hash: {name: 'SHA-256'}},
        kp.privateKey,
        new Uint8Array(data),
      )
      return new Uint8Array(sig)
    },
  }),
})
