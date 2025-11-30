import {HMRequestImplementation} from './api-types'
import {GRPCClient} from './grpc-client'
import {HMResource, HMResourceRequest, UnpackedHypermediaId} from './hm-types'
import {createResourceFetcher} from './resource-loader'

export const Resource: HMRequestImplementation<HMResourceRequest> = {
  async getData(
    grpcClient: GRPCClient,
    input: UnpackedHypermediaId,
  ): Promise<HMResource> {
    const fetchResource = createResourceFetcher(grpcClient)
    return await fetchResource(input)
  },
}
