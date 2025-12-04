import {HMRequestImplementation} from './api-types'
import {BIG_INT} from './constants'
import {GRPCClient} from './grpc-client'
import {HMListCapabilitiesRequest} from './hm-types'
import {hmIdPathToEntityQueryPath} from './utils/path-api'

export const ListCapabilities: HMRequestImplementation<HMListCapabilitiesRequest> =
  {
    async getData(
      grpcClient: GRPCClient,
      input,
    ): Promise<HMListCapabilitiesRequest['output']> {
      const result = await grpcClient.accessControl.listCapabilities({
        account: input.targetId.uid,
        path: hmIdPathToEntityQueryPath(input.targetId.path),
        pageSize: BIG_INT,
      })

      return {
        capabilities: result.capabilities.map((c) => c.toJson() as any),
      }
    },
  }
