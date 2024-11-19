import {trpc} from '@/trpc'
import {getRecentsRouteEntityUrl, invalidateQueries} from '@shm/shared'
import {useNavRoute} from '../utils/navigation'

export function useRecents() {
  const route = useNavRoute()
  const currentRouteUrl = getRecentsRouteEntityUrl(route)
  const recentsQuery = trpc.recents.getRecents.useQuery()
  return {
    ...recentsQuery,
    data: recentsQuery.data?.filter((item) => {
      return item.url !== currentRouteUrl
    }),
  }
}

export function useDeleteRecent() {
  return trpc.recents.deleteRecent.useMutation({
    onSuccess: () => {
      invalidateQueries(['trpc.recents.getRecents'])
    },
  })
}
