import {grpcClient} from '@/grpc-client'
import {PartialMessage} from '@bufbuild/protobuf'
import {
  Entity,
  SearchEntitiesRequest,
} from '@shm/shared/client/.generated/entities/v1alpha/entities_pb'
import {SearchPayload, setSearchQuery} from '@shm/shared/models/search'
import {hmId, unpackHmId} from '@shm/shared/utils/entity-id-url'

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
  const query: PartialMessage<SearchEntitiesRequest> = {
    query: searchQuery,
    includeBody: includeBody,
    contextSize: contextSize,
    accountUid: accountUid,
    loggedAccountUid: perspectiveAccountUid,
  }
  const result = await grpcClient.entities.searchEntities(query)
  return {
    searchQuery,
    entities: result.entities
      .map((entity) => {
        const id = unpackHmId(entity.id)
        if (entity.type === 'contact' && id) {
          return {
            // TO FIX when @juligasa changes this. We should reference the docId instead of the contact id uid
            id: hmId(id.uid),
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
          subtitle: 'Document',
          value: entity.id,
        } as SearchItem
      })
      .filter(Boolean) || []
  )
}
