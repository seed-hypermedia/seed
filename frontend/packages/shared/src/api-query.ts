import {HMRequestImplementation} from './api-types'
import {GRPCClient} from './grpc-client'
import {HMQuery, HMQueryRequest, HMQueryResult} from './hm-types'
import {createQueryResolver} from './models/directory'

export const Query: HMRequestImplementation<HMQueryRequest> = {
  async getData(
    grpcClient: GRPCClient,
    input: HMQuery,
  ): Promise<HMQueryResult | null> {
    const getQueryResults = createQueryResolver(grpcClient)
    return await getQueryResults(input)
  },
}
