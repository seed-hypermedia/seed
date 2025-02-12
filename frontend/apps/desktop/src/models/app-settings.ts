import {trpc} from '@/trpc'
import {invalidateQueries} from '@shm/shared/models/query-client'
import {toast} from '@shm/ui'

export function useAutoUpdatePreference() {
  const value = trpc.appSettings.getAutoUpdatePreference.useQuery()
  const setVal = trpc.appSettings.setAutoUpdatePreference.useMutation({
    onError() {
      toast.error('Could not save this change :(')
    },
    onSuccess() {
      invalidateQueries(['trpc.appSettings.getAutoUpdatePreference'])
    },
  })

  return {
    value,
    setAutoUpdate: setVal.mutate,
  }
}
