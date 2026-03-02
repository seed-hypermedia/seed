import {HMRequestImplementation, HMRequestParams} from './api-types'
import {BIG_INT} from './constants'
import {GRPCClient} from './grpc-client'
import {HMListChangesRequest} from './hm-types'
import {getErrorMessage, HMRedirectError} from './models/entity'
import {packHmId, unpackHmId} from './utils'
import {hmIdPathToEntityQueryPath} from './utils/path-api'

export const ListChanges: HMRequestImplementation<HMListChangesRequest> = {
  async getData(grpcClient: GRPCClient, input): Promise<HMListChangesRequest['output']> {
    const path = hmIdPathToEntityQueryPath(input.targetId.path)

    try {
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
        changes: result.changes.map((c) => c.toJson({emitDefaultValues: true, enumAsInteger: false}) as any),
        latestVersion: latestDoc.version,
      }
    } catch (e) {
      // If the document has been redirected, return empty changes.
      // queryResource handles following redirects, so this query will be
      // re-fetched with the correct (target) ID after redirect resolution.
      const err = getErrorMessage(e)
      if (err instanceof HMRedirectError) {
        return {changes: [], latestVersion: ''}
      }
      throw e
    }
  },
}

export const ListChangesParams: HMRequestParams<HMListChangesRequest> = {
  inputToParams: (input) => ({targetId: packHmId(input.targetId)}),
  paramsToInput: (params) => {
    const targetId = unpackHmId(params.targetId)
    if (!targetId) {
      throw new Error(`Invalid targetId query param: ${params.targetId}`)
    }
    return {targetId}
  },
}
