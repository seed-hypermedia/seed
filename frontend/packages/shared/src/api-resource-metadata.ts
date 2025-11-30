import {GRPCClient} from '.'
import {HMRequestImplementation} from './api-types'
import {
  HMMetadataPayload,
  HMResourceMetadataRequest,
  UnpackedHypermediaId,
} from './hm-types'

export const ResourceMetadata: HMRequestImplementation<HMResourceMetadataRequest> =
  {
    async getData(_grpcClient: GRPCClient, input: UnpackedHypermediaId) {
      return Promise.resolve({
        id: input,
        metadata: null,
      } as HMMetadataPayload)
    },
  }
