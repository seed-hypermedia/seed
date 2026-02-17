import {NotificationItem} from '@/pages/notifications-helpers'
import {client} from '@/trpc'
import {queryKeys} from '@shm/shared/models/query-keys'
import {useQuery} from '@tanstack/react-query'

export function useNotificationInbox(accountUid: string | null | undefined) {
  return useQuery<NotificationItem[]>({
    queryKey: [queryKeys.NOTIFICATION_INBOX, accountUid],
    queryFn: () =>
      client.notificationInbox.getLocalInbox.query({
        accountUid: accountUid!,
      }),
    enabled: !!accountUid,
  })
}
