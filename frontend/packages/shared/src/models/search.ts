import {useQuery} from '@tanstack/react-query'
import {ContentTypeFilter, SearchType} from '../client/.generated/entities/v1alpha/entities_pb'
import {HMDocument, UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {packHmId} from '../utils/entity-id-url'
import {queryKeys} from './query-keys'
import {useUniversalClient} from '../routing'

export type SearchResultItem = {
  id: UnpackedHypermediaId
  metadata?: HMDocument['metadata']
  title: string
  icon: string
  parentNames: string[]
  versionTime?: string
  searchQuery: string
  type: 'document' | 'contact'
}

export type SearchPayload = {
  entities: SearchResultItem[]
  searchQuery: string
}

export function useSearch(
  query: string,
  {
    enabled = true,
    accountUid,
    includeBody = false,
    contextSize = 48,
    perspectiveAccountUid,
    searchType,
    pageSize,
    iriFilter,
    contentTypeFilter,
  }: {
    enabled?: boolean
    accountUid?: string
    includeBody?: boolean
    contextSize?: number
    perspectiveAccountUid?: string
    searchType?: SearchType
    pageSize?: number
    iriFilter?: string
    contentTypeFilter?: ContentTypeFilter[]
  } = {},
) {
  const client = useUniversalClient()
  return useQuery({
    queryKey: [
      queryKeys.SEARCH,
      perspectiveAccountUid || null,
      accountUid || null,
      query,
      includeBody,
      contextSize,
      searchType,
      pageSize || null,
      iriFilter || null,
      contentTypeFilter || null,
    ],
    queryFn: async () => {
      const out = await client.request('Search', {
        query,
        perspectiveAccountUid: perspectiveAccountUid || undefined,
        accountUid: accountUid || undefined,
        includeBody: includeBody || false,
        contextSize: contextSize || 48,
        searchType,
        pageSize: pageSize || undefined,
        iriFilter: iriFilter || undefined,
        contentTypeFilter: contentTypeFilter && contentTypeFilter.length ? contentTypeFilter : undefined,
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
