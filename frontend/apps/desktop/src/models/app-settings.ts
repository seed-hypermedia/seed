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
    mutationFn: (preference: 'true' | 'false') => client.appSettings.setAutoUpdatePreference.mutate(preference),
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

export type RemoteVaultReminderPreference = {
  remindLaterUntilMs: number | null
  dontRemindAgain: boolean
}

const REMOTE_VAULT_REMINDER_KEY = 'remote-vault-reminder'

/**
 * Persists desktop reminder state for nudging local-only users toward remote vault sync.
 */
export function useRemoteVaultReminderPreference() {
  const value = useQuery({
    queryKey: [queryKeys.SETTINGS, REMOTE_VAULT_REMINDER_KEY],
    queryFn: async () => {
      const stored = await client.appSettings.getSetting.query(REMOTE_VAULT_REMINDER_KEY)
      return {
        remindLaterUntilMs: typeof stored?.remindLaterUntilMs === 'number' ? stored.remindLaterUntilMs : null,
        dontRemindAgain: stored?.dontRemindAgain === true,
      } satisfies RemoteVaultReminderPreference
    },
  })
  const setPreferenceMutation = useMutation({
    mutationFn: (input: RemoteVaultReminderPreference) =>
      client.appSettings.setSetting.mutate({key: REMOTE_VAULT_REMINDER_KEY, value: input}),
    onError() {
      toast.error('Could not save this change :(')
    },
    onSuccess() {
      invalidateQueries([queryKeys.SETTINGS, REMOTE_VAULT_REMINDER_KEY])
    },
  })

  return {
    value,
    setPreference: setPreferenceMutation.mutate,
  }
}
