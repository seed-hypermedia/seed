import {HMRequestImplementation, QueryDaemonFn} from './api-types'
import {HMGetCIDRequest} from './hm-types'

export const GetCID: HMRequestImplementation<HMGetCIDRequest> = {
  async getData(
    _grpcClient,
    input,
    queryDaemon?: QueryDaemonFn,
  ): Promise<HMGetCIDRequest['output']> {
    if (!queryDaemon) {
      throw new Error('GetCID requires queryDaemon to be provided')
    }
    // GetCID requires direct HTTP access to debug endpoint, not gRPC
    // Use queryAPI to fetch from /debug/cid/{cid}
    const result = await queryDaemon<any>(`/debug/cid/${input.cid}`)
    return {value: result}
  },
}
