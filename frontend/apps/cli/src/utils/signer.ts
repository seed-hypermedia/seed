import * as ed25519 from '@noble/ed25519'
import type {HMSigner} from '@seed-hypermedia/client/hm-types'
import type {KeyPair} from './key-derivation'

export function createSignerFromKey(key: KeyPair): HMSigner {
  return {
    getPublicKey: async () => key.publicKeyWithPrefix,
    sign: async (data: Uint8Array) => ed25519.signAsync(data, key.privateKey),
  }
}
