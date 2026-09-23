// Accounts matching a query, for an account picker: the same candidates the @mention picker
// uses (one per account, with its current name and icon), rather than raw search hits, which
// come once per matching version or block and carry the matched text instead of the name.
import {useQuery} from '@tanstack/react-query'
import type {HMMentionCandidate} from '@seed-hypermedia/client/hm-types'
import {useUniversalClient} from '../routing'
import {queryKeys} from './query-keys'

export function useAccountSearch(query: string, options: {enabled?: boolean; limit?: number} = {}) {
  const client = useUniversalClient()
  const needle = query.trim()
  const limit = options.limit ?? 8
  return useQuery({
    queryKey: [queryKeys.SEARCH, 'accounts', needle, limit],
    enabled: (options.enabled ?? true) && needle.length > 0,
    staleTime: 15_000,
    queryFn: async ({signal}: {signal?: AbortSignal} = {}): Promise<HMMentionCandidate[]> => {
      const candidates = await client.request('MentionCandidates', {mode: 'account', query: needle}, {signal})
      const seen = new Set<string>()
      return candidates
        .filter((candidate) => {
          if (seen.has(candidate.id.uid)) return false
          seen.add(candidate.id.uid)
          return true
        })
        .slice(0, limit)
    },
  })
}
