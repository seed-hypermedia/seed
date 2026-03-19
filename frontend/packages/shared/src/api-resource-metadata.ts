import {GRPCClient} from './grpc-client'
import {HMRequestImplementation, HMRequestParams} from './api-types'
import {
  HMDocumentMetadataSchema,
  HMMetadataPayload,
  HMResourceMetadataRequest,
  UnpackedHypermediaId,
} from '@seed-hypermedia/client/hm-types'
import {packHmId, unpackHmId} from './utils/entity-id-url'
import {hmIdPathToEntityQueryPath} from './utils/path-api'
import {documentMetadataParseAdjustments} from './models/entity'

/**
 * Fetches document metadata via the lightweight GetDocumentInfo gRPC call.
 */
export const ResourceMetadata: HMRequestImplementation<HMResourceMetadataRequest> = {
  async getData(grpcClient: GRPCClient, input: UnpackedHypermediaId): Promise<HMMetadataPayload> {
    try {
      const docInfo = await grpcClient.documents.getDocumentInfo({
        account: input.uid,
        path: hmIdPathToEntityQueryPath(input.path),
      })
      const metadataJSON = docInfo.metadata?.toJson({
        emitDefaultValues: true,
        enumAsInteger: false,
      })
      documentMetadataParseAdjustments(metadataJSON)
      const parsed = HMDocumentMetadataSchema.safeParse(metadataJSON)
      if (!parsed.success) {
        console.error(`Failed to parse document metadata for ${input.id}:`, parsed.error)
        return {id: input, metadata: {}}
      }
      return {id: input, metadata: parsed.data}
    } catch (e) {
      console.error(`Failed to load document metadata for ${input.id}:`, e)
      return {id: input, metadata: null}
    }
  },
}

export const ResourceMetadataParams: HMRequestParams<HMResourceMetadataRequest> = {
  inputToParams: (input: UnpackedHypermediaId) => ({id: packHmId(input)}),
  paramsToInput: (params: Record<string, string>) => unpackHmId(params.id!)!,
}
