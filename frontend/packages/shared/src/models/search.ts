import {useQuery} from '@tanstack/react-query'
import {UnpackedHypermediaId} from '../hm-types'
import {queryKeys} from './query-keys'
import {Timestamp} from '@bufbuild/protobuf'
import {packHmId} from '../utils/entity-id-url'

export type SearchResultItem = {
  id: UnpackedHypermediaId
  title: string
  icon: string
  parentNames: string[]
  versionTime: Timestamp
  searchQuery: string
}

export type SearchPayload = {
  entities: SearchResultItem[]
  searchQuery: string
}

export let searchQuery:
  | ((query: string, accountUid?: string) => Promise<SearchPayload>)
  | null = null

export function setSearchQuery(
  handler: (query: string, accountUid?: string) => Promise<SearchPayload>,
) {
  searchQuery = handler
}

export function useSearch(
  query: string,
  {enabled = true, accountUid}: {enabled?: boolean; accountUid?: string} = {},
) {
  return useQuery({
    queryKey: [queryKeys.SEARCH, accountUid || null, query],
    queryFn: async () => {
      if (!searchQuery) throw new Error('searchQuery not injected')
      const out = await searchQuery(query, accountUid || undefined)
      const alreadySeenIds = new Set<string>()
      const entities: SearchResultItem[] = []
      out.entities.forEach((result) => {
        const key = packHmId(result.id)
        if (!alreadySeenIds.has(key)) {
          alreadySeenIds.add(key)
          entities.push(result)
        }
      })
      return {out, entities}
    },
    enabled,
  })
}
