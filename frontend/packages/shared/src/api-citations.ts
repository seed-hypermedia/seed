import {HMRequestImplementation} from './api-types'
import {BIG_INT} from './constants'
import {GRPCClient} from './grpc-client'
import {HMListCitationsRequest} from './hm-types'
import {packHmId} from './utils'

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
