import {useQueries, useQuery} from '@tanstack/react-query'
import {UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {useUniversalClient} from '../routing'
import {queryInteractionSummary} from './queries'

export function useInteractionSummary(docId?: UnpackedHypermediaId | null, {enabled}: {enabled?: boolean} = {}) {
  const client = useUniversalClient()
  const query = queryInteractionSummary(client, docId)
  return useQuery({
    ...query,
    enabled: enabled !== false && query.enabled,
  })
}

/** Batch-fetch interaction summaries for multiple documents. React Query deduplicates with per-component calls. */
export function useInteractionSummaries(ids: (UnpackedHypermediaId | null)[]) {
  const client = useUniversalClient()
  return useQueries({
    queries: ids.map((id) => queryInteractionSummary(client, id)),
  })
}
