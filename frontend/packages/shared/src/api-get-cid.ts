import {HMRequestImplementation, QueryDaemonFn} from './api-types'
import {HMGetCIDRequest} from '@seed-hypermedia/client/hm-types'

export const GetCID: HMRequestImplementation<HMGetCIDRequest> = {
  async getData(_grpcClient, input, queryDaemon?: QueryDaemonFn): Promise<HMGetCIDRequest['output']> {
    if (!queryDaemon) {
      throw new Error('GetCID requires queryDaemon to be provided')
    }
    const result = await queryDaemon<any>(`/ipfs/${input.cid}.dagjson`)
    return {value: result}
  },
}
