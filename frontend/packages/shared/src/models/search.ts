import {Timestamp} from '@bufbuild/protobuf'
import {useQuery} from '@tanstack/react-query'
import {HMDocument, UnpackedHypermediaId} from '../hm-types'
import {packHmId} from '../utils/entity-id-url'
import {queryKeys} from './query-keys'

export type SearchResultItem = {
  id: UnpackedHypermediaId
  metadata?: HMDocument['metadata']
  title: string
  icon: string
  parentNames: string[]
  versionTime?: Timestamp
  searchQuery: string
  type: 'document' | 'contact'
}

export type SearchPayload = {
  entities: SearchResultItem[]
  searchQuery: string
}

export let searchQuery:
  | ((
      query: string,
      opts?: {
        accountUid?: string
        perspectiveAccountUid?: string
        includeBody?: boolean
        contextSize?: number
      },
    ) => Promise<SearchPayload>)
  | null = null

export function setSearchQuery(
  handler: (
    query: string,
    opts?: {
      accountUid?: string
      perspectiveAccountUid?: string
      includeBody?: boolean
      contextSize?: number
    },
  ) => Promise<SearchPayload>,
) {
  searchQuery = handler
}

export function useSearch(
  query: string,
  {enabled = true, accountUid}: {enabled?: boolean; accountUid?: string} = {},
  includeBody: boolean | undefined = false,
  contextSize: number | undefined = 48,
) {
  return useQuery({
    queryKey: [
      queryKeys.SEARCH,
      accountUid || null,
      query,
      includeBody,
      contextSize,
    ],
    queryFn: async () => {
      if (!searchQuery) throw new Error('searchQuery not injected')
      const out = await searchQuery(query, {
        accountUid: accountUid || undefined,
        includeBody: includeBody || false,
        contextSize: contextSize || 48,
      })
      const alreadySeenIds = new Set<string>()
      const entities: SearchResultItem[] = []
      const limit = query.length < 3 ? 30 : Number.MAX_SAFE_INTEGER
      for (const result of out.entities) {
        if (entities.length >= limit) break

        const key = packHmId(result.id)
        if (!alreadySeenIds.has(key)) {
          alreadySeenIds.add(key)
          entities.push(result)
        }
      }
      return {out, entities}
    },
    enabled,
  })
}
