import {useMutation, useQuery, useQueryClient} from '@tanstack/react-query'
import {UnpackedHypermediaId} from '../hm-types'
import {queryKeys} from './query-keys'

let queryRecents: (() => Promise<RecentsResult[]>) | null = null
let deleteRecent: ((id: string) => Promise<void>) | null = null

export type RecentsResult = {
  id: UnpackedHypermediaId
  name: string
  time: number
}

export function setRecentsQuery(handler: () => Promise<RecentsResult[]>) {
  queryRecents = handler
}

export function setDeleteRecents(handler: (id: string) => Promise<void>) {
  deleteRecent = handler
}

export function useRecents() {
  return useQuery({
    queryKey: [queryKeys.RECENTS],
    queryFn: async () => {
      if (!queryRecents) throw new Error('queryRecents not injected')
      const r = await queryRecents()
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
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => {
      if (!deleteRecent) throw new Error('deleteRecent not injected')
      return deleteRecent(id)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({queryKey: [queryKeys.RECENTS]})
    },
  })
}
