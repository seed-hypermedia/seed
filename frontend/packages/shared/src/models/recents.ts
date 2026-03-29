import {useMutation, useQuery} from '@tanstack/react-query'
import type {UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {invalidateQueries} from './query-client'
import {queryKeys} from './query-keys'
import {useUniversalClient} from '../routing'

export type RecentsResult = {
  id: UnpackedHypermediaId
  name: string
  time: number
}

export function useRecents() {
  const client = useUniversalClient()
  return useQuery({
    queryKey: [queryKeys.RECENTS],
    queryFn: async () => {
      if (!client.fetchRecents) return []
      const r = await client.fetchRecents()
      if (Array.isArray(r)) {
        return r
      } else {
        // 🙈 sometimes trpc on desktop returns content from the wrong endpoint.
        return []
      }
    },
    enabled: !!client.fetchRecents,
  })
}

export function useDeleteRecent() {
  const client = useUniversalClient()
  return useMutation({
    mutationFn: (id: string) => {
      if (!client.deleteRecent) {
        throw new Error('deleteRecent not available on this platform')
      }
      return client.deleteRecent(id)
    },
    onSuccess: () => {
      invalidateQueries([queryKeys.RECENTS])
    },
  })
}
