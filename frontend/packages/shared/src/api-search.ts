import {HMRequestImplementation} from './api-types'
import {GRPCClient} from './grpc-client'
import {HMSearchInput, HMSearchPayload, HMSearchRequest} from './hm-types'
import {hmId, unpackHmId} from './utils'

export const Search: HMRequestImplementation<HMSearchRequest> = {
  async getData(
    grpcClient: GRPCClient,
    input: HMSearchInput,
  ): Promise<HMSearchPayload> {
    const {query, accountUid, includeBody, contextSize, perspectiveAccountUid} =
      input
    const result = await grpcClient.entities.searchEntities({
      query,
      includeBody,
      contextSize,
      accountUid,
      loggedAccountUid: perspectiveAccountUid,
    })
    return {
      searchQuery: query,
      entities: result.entities
        .map((entity) => {
          const id = unpackHmId(entity.id)
          if (entity.type === 'contact' && id) {
            return {
              id: hmId(id.uid),
              title: entity.content,
              parentNames: entity.parentNames,
              icon: entity.icon,
              versionTime: entity.versionTime,
              searchQuery: query,
              type: 'contact' as const,
            }
          }
          return id
            ? {
                id,
                title: entity.content,
                parentNames: entity.parentNames,
                icon: entity.icon,
                versionTime: entity.versionTime,
                searchQuery: query,
                type: 'document' as const,
              }
            : undefined
        })
        .filter((result): result is NonNullable<typeof result> => !!result),
    }
  },
}
