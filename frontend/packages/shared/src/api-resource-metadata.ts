import {GRPCClient} from './grpc-client'
import {HMRequestImplementation, HMRequestParams} from './api-types'
import {HMMetadataPayload, HMResourceMetadataRequest, UnpackedHypermediaId} from './hm-types'
import {packHmId, unpackHmId} from './utils/entity-id-url'

export const ResourceMetadata: HMRequestImplementation<HMResourceMetadataRequest> = {
  async getData(_grpcClient: GRPCClient, input: UnpackedHypermediaId) {
    return Promise.resolve({
      id: input,
      metadata: null,
    } as HMMetadataPayload)
  },
}

export const ResourceMetadataParams: HMRequestParams<HMResourceMetadataRequest> = {
  inputToParams: (input: UnpackedHypermediaId) => ({id: packHmId(input)}),
  paramsToInput: (params: Record<string, string>) => unpackHmId(params.id!)!,
}
