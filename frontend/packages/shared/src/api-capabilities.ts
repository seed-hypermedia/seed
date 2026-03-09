import {HMRequestImplementation, HMRequestParams} from './api-types'
import {BIG_INT} from './constants'
import {GRPCClient} from './grpc-client'
import {HMListCapabilitiesRequest} from '@seed-hypermedia/client/hm-types'
import {getErrorMessage, HMRedirectError} from './models/entity'
import {packHmId, unpackHmId} from './utils'
import {hmIdPathToEntityQueryPath} from './utils/path-api'

export const ListCapabilities: HMRequestImplementation<HMListCapabilitiesRequest> = {
  async getData(grpcClient: GRPCClient, input): Promise<HMListCapabilitiesRequest['output']> {
    try {
      const result = await grpcClient.accessControl.listCapabilities({
        account: input.targetId.uid,
        path: hmIdPathToEntityQueryPath(input.targetId.path),
        pageSize: BIG_INT,
      })

      return {
        capabilities: result.capabilities.map((c) => c.toJson({emitDefaultValues: true, enumAsInteger: false}) as any),
      }
    } catch (e) {
      const err = getErrorMessage(e)
      if (err instanceof HMRedirectError) {
        return {capabilities: []}
      }
      throw e
    }
  },
}

export const ListCapabilitiesParams: HMRequestParams<HMListCapabilitiesRequest> = {
  inputToParams: (input) => ({targetId: packHmId(input.targetId)}),
  paramsToInput: (params) => {
    const targetId = unpackHmId(params.targetId)
    if (!targetId) {
      throw new Error(`Invalid targetId query param: ${params.targetId}`)
    }
    return {targetId}
  },
}
