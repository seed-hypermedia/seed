import {useQuery} from '@tanstack/react-query'
import {UnpackedHypermediaId} from '../hm-types'
import {queryKeys} from './query-keys'

export type SearchResultItem = {
  id: UnpackedHypermediaId
  title: string
  icon: string
  parentNames: string[]
}

export type SearchPayload = {
  entities: SearchResultItem[]
  searchQuery: string
}

export let searchQuery: ((query: string) => Promise<SearchPayload>) | null =
  null

export function setSearchQuery(
  handler: (query: string) => Promise<SearchPayload>,
) {
  searchQuery = handler
}

export function useSearch(query: string, opts?: {enabled?: boolean}) {
  return useQuery({
    queryKey: [queryKeys.SEARCH, query],
    queryFn: async () => {
      if (!searchQuery) throw new Error('searchQuery not injected')
      const out = await searchQuery(query)
      const alreadySeenIds = new Set<string>()
      const entities: SearchResultItem[] = []
      out.entities.forEach((result) => {
        if (!alreadySeenIds.has(result.id.id)) {
          alreadySeenIds.add(result.id.id)
          entities.push(result)
        }
      })
      return {out, entities}
    },
    enabled: opts?.enabled,
  })
}
