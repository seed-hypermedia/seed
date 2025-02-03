import {useQuery} from '@tanstack/react-query'
import {UnpackedHypermediaId} from '../utils'
import {queryKeys} from './query-keys'

export type SearchPayload = {
  entities: {
    id: UnpackedHypermediaId
    title: string
  }[]
  searchQuery: string
}

let searchQuery: ((query: string) => Promise<SearchPayload>) | null = null

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
      return await searchQuery(query)
    },
    enabled: opts?.enabled,
  })
}
