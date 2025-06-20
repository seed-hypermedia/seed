import {grpcClient} from '@/grpc-client'
import {Entity} from '@shm/shared/client/.generated/entities/v1alpha/entities_pb'
import {SearchPayload, setSearchQuery} from '@shm/shared/models/search'
import {
  HYPERMEDIA_ENTITY_TYPES,
  unpackHmId,
} from '@shm/shared/utils/entity-id-url'

export async function querySearch(
  searchQuery: string,
  accountUid?: string,
  includeBody?: boolean,
  contextSize?: number,
): Promise<SearchPayload> {
  const result = await grpcClient.entities.searchEntities({
    query: searchQuery,
    includeBody: includeBody,
    contextSize: contextSize,
    accountUid: accountUid,
  })
  return {
    searchQuery,
    entities: result.entities
      .map((entity) => {
        const id = unpackHmId(entity.id)
        return id
          ? {
              id,
              title: entity.content,
              parentNames: entity.parentNames,
              icon: entity.icon,
              versionTime: entity.versionTime,
              searchQuery: searchQuery,
            }
          : undefined
      })
      .filter((result) => !!result),
  }
}

setSearchQuery(querySearch)

interface SearchItem {
  title: string
  subtitle: string
  value: string
}

export function transformResultsToItems(
  results: Array<Entity>,
): Array<SearchItem> {
  // @ts-expect-error
  return (
    results
      .map((entity) => {
        const id = unpackHmId(entity.id)
        if (!id) return null

        return {
          title: entity.content,
          subtitle: HYPERMEDIA_ENTITY_TYPES[id.type],
          value: entity.id,
        } as SearchItem
      })
      .filter(Boolean) || []
  )
}
