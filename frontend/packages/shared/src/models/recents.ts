import {useMutation, useQuery, useQueryClient} from '@tanstack/react-query'
import {UnpackedHypermediaId} from '../hm-types'
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
      const r = await client.fetchRecents()
      if (Array.isArray(r)) {
        return r
      } else {
        // 🙈 sometimes trpc on desktop returns content from the wrong endpoint.
        return []
      }
    },
  })
}

export function useDeleteRecent() {
  const client = useUniversalClient()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => {
      return client.deleteRecent(id)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({queryKey: [queryKeys.RECENTS]})
    },
  })
}
