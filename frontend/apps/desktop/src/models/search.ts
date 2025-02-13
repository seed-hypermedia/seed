import {grpcClient} from '@/grpc-client'
import {PlainMessage, toPlainMessage} from '@bufbuild/protobuf'
import {Entity} from '@shm/shared/client/.generated/entities/v1alpha/entities_pb'
import {SearchPayload, setSearchQuery} from '@shm/shared/models/search'
import {
  HYPERMEDIA_ENTITY_TYPES,
  unpackHmId,
} from '@shm/shared/utils/entity-id-url'
import {useCallback, useMemo, useState} from 'react'
import {useGRPCClient} from '../app-context'
import {useRecents} from './recents'

export async function querySearch(searchQuery: string): Promise<SearchPayload> {
  const result = await grpcClient.entities.searchEntities({query: searchQuery})
  return {
    searchQuery,
    entities: result.entities
      .map((entity) => {
        const id = unpackHmId(entity.id)
        return (
          id && {
            id,
            title: entity.title,
          }
        )
      })
      .filter((result) => !!result),
  }
}

setSearchQuery(querySearch)

export function useInlineMentions() {
  const recents = useRecents()
  const grpcClient = useGRPCClient()
  const [queryResult, setQueryResult] = useState<PlainMessage<Entity>[]>([])
  let emptyRespose = {
    Accounts: [],
    Groups: [],
    Documents: [],
    Recents: recents.data,
  }
  const inlineMentionsQuery = useCallback(
    async function searchQuery(query: string) {
      if (!query) {
        return emptyRespose
      }
      const resp = await grpcClient.entities.searchEntities({query})
      const entities = resp.entities.map(toPlainMessage)
      setQueryResult(entities)
    },
    [grpcClient],
  )

  const result = useMemo(() => {
    if (!queryResult?.length) return emptyRespose
    return queryResult.reduce((acc: GroupResults, entity) => {
      if (entity.id.startsWith('hm://')) {
        acc.Documents.push({
          title: entity.title,
          subtitle: 'Document',
          value: entity.id,
        })
      }
      return acc
    }, emptyRespose)
  }, [queryResult])

  return {
    inlineMentionsData: {
      ...result,
      Recents: recents.data,
    },
    inlineMentionsQuery,
  }
}

type InlineMentionsResult = {
  title: string
  subtitle: string
  value: string
}

type GroupResults = {
  Accounts: Array<InlineMentionsResult>
  Groups: Array<InlineMentionsResult>
  Documents: Array<InlineMentionsResult>
}

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
          title: entity.title,
          subtitle: HYPERMEDIA_ENTITY_TYPES[id.type],
          value: entity.id,
        } as SearchItem
      })
      .filter(Boolean) || []
  )
}
