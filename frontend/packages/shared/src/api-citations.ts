import {HMRequestImplementation, HMRequestParams} from './api-types'
import {BIG_INT} from './constants'
import {GRPCClient} from './grpc-client'
import {HMListCitationsRequest} from './hm-types'
import {packHmId, unpackHmId} from './utils'

export const ListCitations: HMRequestImplementation<HMListCitationsRequest> = {
  async getData(
    grpcClient: GRPCClient,
    input,
  ): Promise<HMListCitationsRequest['output']> {
    const result = await grpcClient.entities.listEntityMentions({
      id: packHmId(input.targetId),
      pageSize: BIG_INT,
    })
    return {
      citations: result.mentions.map(
        (m) => m.toJson({emitDefaultValues: true, enumAsInteger: false}) as any,
      ),
    }
  },
}

export const ListCitationsParams: HMRequestParams<HMListCitationsRequest> = {
  inputToParams: (input) => ({targetId: packHmId(input.targetId)}),
  paramsToInput: (params) => {
    const targetId = unpackHmId(params.targetId)
    if (!targetId) {
      throw new Error(`Invalid targetId query param: ${params.targetId}`)
    }
    return {targetId}
  },
}
