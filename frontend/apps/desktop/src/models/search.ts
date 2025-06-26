import {grpcClient} from '@/grpc-client'
import {Entity} from '@shm/shared/client/.generated/entities/v1alpha/entities_pb'
import {SearchPayload, setSearchQuery} from '@shm/shared/models/search'
import {
  hmId,
  HYPERMEDIA_ENTITY_TYPES,
  unpackHmId,
} from '@shm/shared/utils/entity-id-url'

export async function querySearch(
  searchQuery: string,
  opts?: {
    accountUid?: string
    includeBody?: boolean
    contextSize?: number
    perspectiveAccountUid?: string
  },
): Promise<SearchPayload> {
  const {accountUid, includeBody, contextSize, perspectiveAccountUid} =
    opts || {}
  const result = await grpcClient.entities.searchEntities({
    query: searchQuery,
    includeBody: includeBody,
    contextSize: contextSize,
    accountUid: accountUid,
    loggedAccountUid: perspectiveAccountUid,
  })
  return {
    searchQuery,
    entities: result.entities
      .map((entity) => {
        const id = unpackHmId(entity.id)
        const docId = unpackHmId(entity.docId)
        if (entity.type === 'contact' && id) {
          return {
            // TO FIX when @juligasa changes this. We should reference the docId instead of the contact id uid
            id: hmId('d', id.uid),
            title: entity.content,
            parentNames: entity.parentNames,
            icon: entity.icon,
            versionTime: entity.versionTime,
            type: 'contact',
          }
        }
        return id
          ? {
              id,
              title: entity.content,
              parentNames: entity.parentNames,
              icon: entity.icon,
              versionTime: entity.versionTime,
              searchQuery: searchQuery,
              type: 'document',
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
