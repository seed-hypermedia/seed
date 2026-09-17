import {HMRequestImplementation, HMRequestParams} from './api-types'
import {GRPCClient} from './grpc-client'
import {HMListRefsRequest} from '@seed-hypermedia/client/hm-types'
import {packHmId, unpackHmId} from './utils'
import {hmIdPathToEntityQueryPath} from './utils/path-api'

/**
 * Every Ref blob published at a document path, newest generation first: the
 * current one plus the history of versions, moves, redirects and deletions.
 * Unlike Resource, a redirect at the path is listed, not followed.
 */
export const ListRefs: HMRequestImplementation<HMListRefsRequest> = {
  async getData(grpcClient: GRPCClient, input): Promise<HMListRefsRequest['output']> {
    const result = await grpcClient.documents.listRefs({
      account: input.targetId.uid,
      path: hmIdPathToEntityQueryPath(input.targetId.path),
    })
    return {
      refs: result.refs.map((r) => r.toJson({emitDefaultValues: false, enumAsInteger: false}) as any),
    }
  },
}

export const ListRefsParams: HMRequestParams<HMListRefsRequest> = {
  inputToParams: (input) => ({targetId: packHmId(input.targetId)}),
  paramsToInput: (params) => {
    const targetId = unpackHmId(params.targetId)
    if (!targetId) {
      throw new Error(`Invalid targetId query param: ${params.targetId}`)
    }
    return {targetId}
  },
}
