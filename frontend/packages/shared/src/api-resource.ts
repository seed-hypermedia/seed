import {HMRequestImplementation, HMRequestParams} from './api-types'
import {GRPCClient} from './grpc-client'
import {HMResource, HMResourceRequest, UnpackedHypermediaId} from './hm-types'
import {createResourceFetcher} from './resource-loader'
import {packHmId, unpackHmId} from './utils'

export const Resource: HMRequestImplementation<HMResourceRequest> = {
  async getData(
    grpcClient: GRPCClient,
    input: UnpackedHypermediaId,
  ): Promise<HMResource> {
    const fetchResource = createResourceFetcher(grpcClient)
    return await fetchResource(input)
  },
}

export const ResourceParams: HMRequestParams<HMResourceRequest> = {
  inputToParams: (input: UnpackedHypermediaId) => ({id: packHmId(input)}),
  paramsToInput: (params: Record<string, string>) => unpackHmId(params.id!)!,
}
