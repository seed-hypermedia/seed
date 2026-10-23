import {client} from '@/trpc'
import type {NotificationPayload} from '@shm/shared/models/notification-payload'
import {countUnreadNotificationsBySite} from '@shm/shared/models/notification-read-logic'
import {queryKeys} from '@shm/shared/models/query-keys'
import {useQuery} from '@tanstack/react-query'
import {useMemo} from 'react'
import {useLocalNotificationReadState} from './notification-read-state'

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

/**
 * Unread notifications per space for an account, keyed by the space's account uid. Drives the bell's dot and the
 * sidebar's dot on each space, so both always agree.
 */
export function useUnreadNotificationsBySpace(accountUid: string | null | undefined): Record<string, number> {
  const inbox = useNotificationInbox(accountUid)
  const readState = useLocalNotificationReadState(accountUid)
  return useMemo(
    () => (inbox.data && readState.data ? countUnreadNotificationsBySite(inbox.data, readState.data) : {}),
    [inbox.data, readState.data],
  )
}
