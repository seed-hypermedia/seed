import {HMRequestImplementation} from './api-types'
import {GRPCClient} from './grpc-client'
import {HMSearchInput, HMSearchPayload, HMSearchRequest} from '@seed-hypermedia/client/hm-types'
import {hmId, unpackHmId} from './utils'

export const Search: HMRequestImplementation<HMSearchRequest> = {
  async getData(grpcClient: GRPCClient, input: HMSearchInput): Promise<HMSearchPayload> {
    const {query, accountUid, includeBody, contextSize, perspectiveAccountUid, searchType, pageSize} = input
    const t0 = performance.now()
    console.log(`[SEARCH-DEBUG] gRPC searchEntities START | query="${query}" searchType=${searchType}`)
    const result = await grpcClient.entities.searchEntities({
      query,
      includeBody,
      contextSize,
      accountUid,
      loggedAccountUid: perspectiveAccountUid,
      searchType,
      pageSize,
    })
    const t1 = performance.now()
    console.log(
      `[SEARCH-DEBUG] gRPC searchEntities END | query="${query}" | ${(t1 - t0).toFixed(1)}ms | ${result.entities.length} raw entities`,
    )
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
              versionTime: entity.versionTime ? entity.versionTime.toDate().toLocaleString() : undefined,
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
                versionTime: entity.versionTime ? entity.versionTime.toDate().toLocaleString() : undefined,
                searchQuery: query,
                type: 'document' as const,
              }
            : undefined
        })
        .filter((result): result is NonNullable<typeof result> => !!result),
    }
  },
}
