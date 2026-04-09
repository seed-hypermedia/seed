import {createSeedClient} from '@seed-hypermedia/client'
import type {HMSigner, UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import type {UniversalClient} from '@shm/shared'
import {createWebUniversalClient} from '@shm/shared/create-web-universal-client'
import {keyPairStore} from './auth'
import {preparePublicKey, signWithKeyPair} from './auth-utils'
import WebCommenting from './commenting'
import {deleteRecent, getRecents} from './local-db-recents'

const seedClient = createSeedClient('')

export const webUniversalClient = createWebUniversalClient({
  request: seedClient.request as UniversalClient['request'],
  publish: seedClient.publish,
  CommentEditor: ({docId}: {docId: UnpackedHypermediaId}) => {
    return <WebCommenting key={docId.id} docId={docId} />
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
      return signWithKeyPair(kp, new Uint8Array(data))
    },
  }),
})
