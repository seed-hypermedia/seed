import {GRPCClient} from '.'
import {HMMetadataPayload, HMRequest, UnpackedHypermediaId} from './hm-types'

export type ListAPIResponse = {
  documents: HMMetadataPayload[]
  invalidDocuments: {
    id: UnpackedHypermediaId
    error: any
    metadata: any
  }[]
}

export type HMRequestImplementation<Request extends HMRequest> = {
  getData: (
    grpcClient: GRPCClient,
    input: Request['input'],
  ) => Promise<Request['output']>
}
