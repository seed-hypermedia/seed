import {useQuery} from '@tanstack/react-query'
import {UnpackedHypermediaId} from '../hm-types'
import {useUniversalClient} from '../routing'
import {queryInteractionSummary} from './queries'

export function useInteractionSummary(
  docId?: UnpackedHypermediaId | null,
  {enabled}: {enabled?: boolean} = {},
) {
  const client = useUniversalClient()
  const query = queryInteractionSummary(client, docId)
  return useQuery({
    ...query,
    enabled: enabled !== false && query.enabled,
  })
}
