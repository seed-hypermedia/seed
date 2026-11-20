import {HMDocumentInfo, HMDocumentInfoRequest, UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {HMRequestImplementation, HMRequestParams} from './api-types'
import {GRPCClient} from './grpc-client'
import {prepareHMDocumentInfo} from './models/entity'
import {packHmId, unpackHmId} from './utils/entity-id-url'
import {hmIdPathToEntityQueryPath} from './utils/path-api'

/**
 * Reads a published document's indexed information, including its navigation Cards, via the lightweight
 * GetDocumentInfo call. It never loads the document's content.
 */
export const DocumentInfo: HMRequestImplementation<HMDocumentInfoRequest> = {
  async getData(grpcClient: GRPCClient, input: UnpackedHypermediaId): Promise<HMDocumentInfo | null> {
    try {
      const info = await grpcClient.documents.getDocumentInfo({
        account: input.uid,
        path: hmIdPathToEntityQueryPath(input.path),
      })
      return prepareHMDocumentInfo(info)
    } catch (e) {
      console.error(`Failed to load document info for ${input.id}:`, e)
      return null
    }
  },
}

export const DocumentInfoParams: HMRequestParams<HMDocumentInfoRequest> = {
  inputToParams: (input: UnpackedHypermediaId) => ({id: packHmId(input)}),
  paramsToInput: (params: Record<string, string>) => unpackHmId(params.id!)!,
}
