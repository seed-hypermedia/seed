import type {HMSigner, UnpackedHypermediaId} from '@shm/shared'
import {createWebUniversalClient} from '@shm/shared'
import {createSeedClient} from '@seed-hypermedia/client'
import {cborEncode, postCBOR as rawPostCBOR} from './api'
import {preparePublicKey} from './auth-utils'
import WebCommenting from './commenting'
import {getStoredLocalKeys} from './local-db'
import {deleteRecent, getRecents} from './local-db-recents'

const seedClient = createSeedClient('')

export const webUniversalClient = createWebUniversalClient({
  request: seedClient.request,
  publish: seedClient.publish,
  postCBOR: (url: string, data: any) => rawPostCBOR(url, cborEncode(data)),
  CommentEditor: ({docId}: {docId: UnpackedHypermediaId}) => {
    return <WebCommenting docId={docId} />
  },
  fetchRecents: getRecents,
  deleteRecent: deleteRecent,
  getSigner: (): HMSigner => ({
    getPublicKey: async () => {
      const keys = await getStoredLocalKeys()
      if (!keys) throw new Error('No signing keys available')
      return preparePublicKey(keys.publicKey)
    },
    sign: async (data: Uint8Array) => {
      const keys = await getStoredLocalKeys()
      if (!keys) throw new Error('No signing keys available')
      const sig = await crypto.subtle.sign(
        {...keys.privateKey.algorithm, hash: {name: 'SHA-256'}},
        keys.privateKey,
        new Uint8Array(data),
      )
      return new Uint8Array(sig)
    },
  }),
})
