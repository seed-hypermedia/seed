import {Timestamp} from '@bufbuild/protobuf'
import {useQuery} from '@tanstack/react-query'
import {HMDocument, UnpackedHypermediaId} from '../hm-types'
import {packHmId} from '../utils/entity-id-url'
import {queryKeys} from './query-keys'
import {useUniversalClient} from '../routing'

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

export function useSearch(
  query: string,
  {
    enabled = true,
    accountUid,
    includeBody = false,
    contextSize = 48,
    perspectiveAccountUid,
  }: {
    enabled?: boolean
    accountUid?: string
    includeBody?: boolean
    contextSize?: number
    perspectiveAccountUid?: string
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
    ],
    queryFn: async () => {
      const out = await client.fetchSearch(query, {
        perspectiveAccountUid: perspectiveAccountUid || undefined,
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
