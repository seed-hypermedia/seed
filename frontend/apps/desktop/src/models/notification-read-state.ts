import {client} from '@/trpc'
import {invalidateQueries} from '@shm/shared/models/query-client'
import {queryKeys} from '@shm/shared/models/query-keys'
import {useMutation, useQuery} from '@tanstack/react-query'
export {isNotificationEventRead} from './notification-read-logic'

export type LocalNotificationReadState = {
  accountId: string
  markAllReadAtMs: number | null
  readEvents: Array<{eventId: string; eventAtMs: number}>
  dirty: boolean
  lastSyncAtMs: number | null
  lastSyncError: string | null
}

export type NotificationSyncStatus = {
  accountId: string
  dirty: boolean
  lastSyncAtMs: number | null
  lastSyncError: string | null
}

export function useLocalNotificationReadState(accountUid: string | null | undefined) {
  return useQuery({
    queryKey: [queryKeys.NOTIFICATION_READ_STATE, accountUid],
    queryFn: () => client.notificationRead.getLocalState.query(accountUid!),
    enabled: !!accountUid,
  })
}

export function useNotificationSyncStatus(accountUid: string | null | undefined) {
  return useQuery({
    queryKey: [queryKeys.NOTIFICATION_SYNC_STATUS, accountUid],
    queryFn: () => client.notificationRead.getSyncStatus.query(accountUid!),
    enabled: !!accountUid,
    refetchInterval: 5_000,
  })
}

export function useMarkNotificationEventRead() {
  return useMutation({
    mutationFn: (input: {accountUid: string; eventId: string; eventAtMs: number}) =>
      client.notificationRead.markEventRead.mutate(input),
    onSuccess: (result) => {
      invalidateQueries([queryKeys.NOTIFICATION_READ_STATE, result.accountId])
      invalidateQueries([queryKeys.NOTIFICATION_SYNC_STATUS, result.accountId])
    },
  })
}

export function useMarkNotificationEventUnread() {
  return useMutation({
    mutationFn: (input: {
      accountUid: string
      eventId: string
      eventAtMs: number
      otherLoadedEvents: Array<{eventId: string; eventAtMs: number}>
    }) => client.notificationRead.markEventUnread.mutate(input),
    onSuccess: (result) => {
      invalidateQueries([queryKeys.NOTIFICATION_READ_STATE, result.accountId])
      invalidateQueries([queryKeys.NOTIFICATION_SYNC_STATUS, result.accountId])
    },
  })
}

export function useMarkAllNotificationsRead() {
  return useMutation({
    mutationFn: (input: {accountUid: string; markAllReadAtMs: number}) =>
      client.notificationRead.markAllRead.mutate(input),
    onSuccess: (result) => {
      invalidateQueries([queryKeys.NOTIFICATION_READ_STATE, result.accountId])
      invalidateQueries([queryKeys.NOTIFICATION_SYNC_STATUS, result.accountId])
    },
  })
}

export function useSyncNotificationReadState() {
  return useMutation({
    mutationFn: (input: {accountUid: string; notifyServiceHost?: string}) =>
      client.notificationRead.syncNow.mutate(input),
    onSuccess: (result) => {
      invalidateQueries([queryKeys.NOTIFICATION_READ_STATE, result.accountId])
      invalidateQueries([queryKeys.NOTIFICATION_SYNC_STATUS, result.accountId])
    },
  })
}
