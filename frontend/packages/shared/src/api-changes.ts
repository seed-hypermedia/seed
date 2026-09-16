import {HMRequestImplementation, HMRequestParams} from './api-types'
import {BIG_INT} from './constants'
import {GRPCClient} from './grpc-client'
import {HMListChangesRequest} from '@seed-hypermedia/client/hm-types'
import {getErrorMessage, HMRedirectError} from './models/entity'
import {MAX_REDIRECT_HOPS} from './redirects'
import {packHmId, unpackHmId} from './utils'
import {hmIdPathToEntityQueryPath} from './utils/path-api'

export const ListChanges: HMRequestImplementation<HMListChangesRequest> = {
  async getData(grpcClient: GRPCClient, input): Promise<HMListChangesRequest['output']> {
    let targetId = input.targetId
    for (let hop = 0; ; hop++) {
      const path = hmIdPathToEntityQueryPath(targetId.path)
      try {
        // Get the latest document to determine version
        const latestDoc = await grpcClient.documents.getDocument({
          account: targetId.uid,
          path,
          version: undefined,
        })

        // List changes for that version
        const result = await grpcClient.documents.listDocumentChanges({
          account: targetId.uid,
          path,
          version: latestDoc.version,
          pageSize: BIG_INT,
        })

        return {
          changes: result.changes.map((c) => c.toJson({emitDefaultValues: true, enumAsInteger: false}) as any),
          latestVersion: latestDoc.version,
        }
      } catch (e) {
        const err = getErrorMessage(e)
        if (err instanceof HMRedirectError) {
          // A republish shows its target's history at its own address: follow the hop.
          if (err.republish && hop < MAX_REDIRECT_HOPS) {
            targetId = err.target
            continue
          }
          // A move's old address has no history of its own. The resource query follows
          // the move, so callers re-query with the target id and this answer is discarded.
          return {changes: [], latestVersion: ''}
        }
        throw e
      }
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
