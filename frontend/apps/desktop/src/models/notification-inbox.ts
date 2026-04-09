import {client} from '@/trpc'
import type {NotificationPayload} from '@shm/shared/models/notification-payload'
import {queryKeys} from '@shm/shared/models/query-keys'
import {useQuery} from '@tanstack/react-query'

const NOTIFICATION_INBOX_REFETCH_MS = 5_000

/** Loads the local desktop notification inbox for the active account. */
export function useNotificationInbox(accountUid: string | null | undefined) {
  const enabled = !!accountUid

  return useQuery<NotificationPayload[]>({
    queryKey: [queryKeys.NOTIFICATION_INBOX, accountUid],
    queryFn: () =>
      client.notificationInbox.getLocalInbox.query({
        accountUid: accountUid!,
      }),
    enabled,
    staleTime: 0,
    refetchOnMount: 'always',
    refetchOnWindowFocus: enabled ? 'always' : false,
    refetchOnReconnect: enabled ? 'always' : false,
    refetchInterval: enabled ? NOTIFICATION_INBOX_REFETCH_MS : false,
  })
}
