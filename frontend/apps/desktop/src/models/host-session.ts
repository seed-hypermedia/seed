import {client} from '@/trpc'
import {getQueryClient, invalidateQueries} from '@shm/shared/models/query-client'
import {queryKeys} from '@shm/shared/models/query-keys'

/** Clears persisted hosting credentials and cached account data, and revokes the hosting session. */
export async function logoutHosting() {
  const queryClient = getQueryClient()
  await Promise.all([
    queryClient.cancelQueries({queryKey: [queryKeys.HOST_STATE]}),
    queryClient.cancelQueries({queryKey: ['HOST_SITES']}),
  ])
  const state = await client.host.logout.mutate()
  queryClient.setQueryData([queryKeys.HOST_STATE], state)
  queryClient.removeQueries({queryKey: ['HOST_SITES']})
  invalidateQueries([queryKeys.HOST_STATE])
}
