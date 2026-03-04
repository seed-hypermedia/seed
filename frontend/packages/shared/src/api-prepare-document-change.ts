import {DocumentChange} from './client/.generated/documents/v3alpha/documents_pb'
import {HMRequestImplementation} from './api-types'
import {HMPrepareDocumentChangeRequest} from './hm-types'

export const PrepareDocumentChange: HMRequestImplementation<HMPrepareDocumentChangeRequest> = {
  async getData(grpcClient, input) {
    const result = await grpcClient.documents.prepareChange({
      account: input.account,
      path: input.path ?? '',
      baseVersion: input.baseVersion ?? '',
      capability: input.capability ?? '',
      visibility: input.visibility ?? 0,
      changes: input.changes.map((c) => new DocumentChange(c as ConstructorParameters<typeof DocumentChange>[0])),
    })
    return {unsignedChange: result.unsignedChange}
  },
}
