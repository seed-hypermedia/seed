import {client} from '@/trpc'
import type {NotificationPayload} from '@shm/shared/models/notification-payload'
import {queryKeys} from '@shm/shared/models/query-keys'
import {useQuery} from '@tanstack/react-query'

export function useNotificationInbox(accountUid: string | null | undefined) {
  return useQuery<NotificationPayload[]>({
    queryKey: [queryKeys.NOTIFICATION_INBOX, accountUid],
    queryFn: () =>
      client.notificationInbox.getLocalInbox.query({
        accountUid: accountUid!,
      }),
    enabled: !!accountUid,
  })
}
