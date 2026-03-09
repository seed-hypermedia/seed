import {base58btc} from 'multiformats/bases/base58'
import type {GRPCClient} from '@shm/shared/grpc-client'
import type {HMSigner} from '@seed-hypermedia/client/hm-types'

/**
 * Create an HMSigner backed by the daemon's keystore.
 * Uses the daemon's SignData RPC for signing and derives the public key from the account UID.
 */
export function createDaemonSigner(grpcClient: GRPCClient, signingKeyName: string): HMSigner {
  return {
    async getPublicKey() {
      return new Uint8Array(base58btc.decode(signingKeyName))
    },
    async sign(data: Uint8Array) {
      const resp = await grpcClient.daemon.signData({
        signingKeyName,
        data: new Uint8Array(data),
      })
      return new Uint8Array(resp.signature)
    },
  }
}
