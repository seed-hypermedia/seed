import {DocumentChange} from './client/.generated/documents/v3alpha/documents_pb'
import {HMRequestImplementation} from './api-types'
import {HMPrepareDocumentChangeRequest} from '@seed-hypermedia/client/hm-types'

const PRIVATE_DOC_DEBUG_PREFIX = '[private-doc-debug]'
const RESOURCE_VISIBILITY_PRIVATE = 2

export const PrepareDocumentChange: HMRequestImplementation<HMPrepareDocumentChangeRequest> = {
  async getData(grpcClient, input) {
    const request = {
      account: input.account,
      path: input.path ?? '',
      baseVersion: input.baseVersion ?? '',
      capability: input.capability ?? '',
      visibility: input.visibility ?? 0,
      changes: input.changes.map((c) => new DocumentChange(c as ConstructorParameters<typeof DocumentChange>[0])),
    }
    if (request.visibility === RESOURCE_VISIBILITY_PRIVATE) {
      console.log(PRIVATE_DOC_DEBUG_PREFIX, 'app api sending grpc documents.prepareChange', {
        ...request,
        changes: {
          count: request.changes.length,
          opCases: request.changes.map((change) => change.op.case),
        },
      })
    }
    const result = await grpcClient.documents.prepareChange(request)
    if (request.visibility === RESOURCE_VISIBILITY_PRIVATE) {
      console.log(PRIVATE_DOC_DEBUG_PREFIX, 'app api grpc documents.prepareChange success', {
        account: request.account,
        path: request.path,
        baseVersion: request.baseVersion,
        visibility: request.visibility,
        unsignedChangeBytes: result.unsignedChange?.length,
      })
    }
    return {unsignedChange: result.unsignedChange}
  },
}
