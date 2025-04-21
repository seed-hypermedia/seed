import {HMMetadataPayload, UnpackedHypermediaId} from './hm-types'

export type ListAPIResponse = {
  documents: HMMetadataPayload[]
  invalidDocuments: {
    id: UnpackedHypermediaId
    error: any
    metadata: any
  }[]
}
