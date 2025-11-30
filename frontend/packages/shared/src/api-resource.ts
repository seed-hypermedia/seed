import {HMRequestImplementation} from './api-types'
import {HMResourceRequest} from './hm-types'

export const Resource: HMRequestImplementation<HMResourceRequest> = {
  // @ts-expect-error
  async getData(grpcClient: GRPCClient, input: UnpackedHypermediaId) {
    return
  },
}
