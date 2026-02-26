import {client} from '@/trpc'
import {invalidateQueries} from '@shm/shared/models/query-client'
import {queryKeys} from '@shm/shared/models/query-keys'
import {useMutation, useQuery} from '@tanstack/react-query'
export {isNotificationEventRead} from './notification-read-logic'

export type LocalNotificationReadState = {
  accountId: string
  markAllReadAtMs: number | null
  readEvents: Array<{eventId: string; eventAtMs: number}>
}

export type NotificationSyncStatus = {
  accountId: string
  dirty: boolean
  lastSyncAtMs: number | null
  lastSyncError: string | null
}

type NotificationReadMutationResult = {
  accountId: string
  readStateChanged?: boolean
  syncStatusChanged?: boolean
}

function invalidateChangedNotificationQueries(result: NotificationReadMutationResult) {
  if (result.readStateChanged ?? true) {
    invalidateQueries([queryKeys.NOTIFICATION_READ_STATE, result.accountId])
  }
  if (result.syncStatusChanged ?? true) {
    invalidateQueries([queryKeys.NOTIFICATION_SYNC_STATUS, result.accountId])
  }
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
      invalidateChangedNotificationQueries(result)
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
      invalidateChangedNotificationQueries(result)
    },
  })
}

export function useMarkAllNotificationsRead() {
  return useMutation({
    mutationFn: (input: {accountUid: string; markAllReadAtMs: number}) =>
      client.notificationRead.markAllRead.mutate(input),
    onSuccess: (result) => {
      invalidateChangedNotificationQueries(result)
    },
  })
}

export function useSyncNotificationReadState() {
  return useMutation({
    mutationFn: (input: {accountUid: string; notifyServiceHost?: string}) =>
      client.notificationRead.syncNow.mutate(input),
  })
}
