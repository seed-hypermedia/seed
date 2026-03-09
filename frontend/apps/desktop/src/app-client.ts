import {createSeedClient} from '@seed-hypermedia/client'
import {API_HTTP_URL} from '@shm/shared/constants'
import {base58btc} from 'multiformats/bases/base58'
import {grpcClient} from './app-grpc'

export const seedClient = createSeedClient(API_HTTP_URL)

export function getSigner(accountUid: string) {
  return {
    getPublicKey: async () => new Uint8Array(base58btc.decode(accountUid)),
    sign: async (data: Uint8Array) => {
      const result = await grpcClient.daemon.signData({signingKeyName: accountUid, data: new Uint8Array(data)})
      return new Uint8Array(result.signature)
    },
  }
}
