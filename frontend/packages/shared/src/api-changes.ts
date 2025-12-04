import {HMRequestImplementation} from './api-types'
import {BIG_INT} from './constants'
import {GRPCClient} from './grpc-client'
import {HMListChangesRequest} from './hm-types'
import {hmIdPathToEntityQueryPath} from './utils/path-api'

export const ListChanges: HMRequestImplementation<HMListChangesRequest> = {
  async getData(
    grpcClient: GRPCClient,
    input,
  ): Promise<HMListChangesRequest['output']> {
    const path = hmIdPathToEntityQueryPath(input.targetId.path)

    // Get the latest document to determine version
    const latestDoc = await grpcClient.documents.getDocument({
      account: input.targetId.uid,
      path,
      version: undefined,
    })

    // List changes for that version
    const result = await grpcClient.documents.listDocumentChanges({
      account: input.targetId.uid,
      path,
      version: latestDoc.version,
      pageSize: BIG_INT,
    })

    return {
      changes: result.changes.map((c) => c.toJson() as any),
      latestVersion: latestDoc.version,
    }
  },
}
