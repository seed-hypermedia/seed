import {client} from '@/trpc'
import {invalidateQueries} from '@shm/shared/models/query-client'
import {queryKeys} from '@shm/shared/models/query-keys'
import {useMutation, useQuery} from '@tanstack/react-query'
import {toast} from '@shm/ui/toast'

export function useAutoUpdatePreference() {
  const value = useQuery({
    queryKey: [queryKeys.AUTO_UPDATE_PREFERENCE],
    queryFn: () => client.appSettings.getAutoUpdatePreference.query(),
  })
  const setVal = useMutation({
    mutationFn: (preference: 'true' | 'false') =>
      client.appSettings.setAutoUpdatePreference.mutate(preference),
    onError() {
      toast.error('Could not save this change :(')
    },
    onSuccess() {
      invalidateQueries([queryKeys.AUTO_UPDATE_PREFERENCE])
    },
  })

  return {
    value,
    setAutoUpdate: setVal.mutate,
  }
}
