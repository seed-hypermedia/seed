import {client} from '@/trpc'
import {invalidateQueries} from '@shm/shared/models/query-client'
import {queryKeys} from '@shm/shared/models/query-keys'
import {useMutation, useQuery} from '@tanstack/react-query'

export type NotificationConfig = {
  accountId: string
  email: string | null
  verifiedTime: string | null
  verificationSendTime: string | null
  verificationExpired: boolean
  isNotifyServerConnected: boolean
}

export type SetNotificationConfigInput = {
  email: string
}

export function useNotificationConfig(
  notifyServiceHost: string | undefined,
  accountUid: string | undefined,
  options?: {enabled?: boolean},
) {
  return useQuery({
    queryKey: [queryKeys.NOTIFICATION_CONFIG, notifyServiceHost, accountUid],
    queryFn: () =>
      client.notificationConfig.getConfig.query({
        accountUid: accountUid!,
        notifyServiceHost,
      }),
    enabled: !!accountUid && (options?.enabled ?? true),
  })
}

export function useSetNotificationConfig(notifyServiceHost: string | undefined, accountUid: string | undefined) {
  return useMutation({
    mutationFn: (input: SetNotificationConfigInput) =>
      client.notificationConfig.setConfig.mutate({
        accountUid: accountUid!,
        notifyServiceHost,
        email: input.email,
      }),
    onSuccess: () => {
      invalidateQueries([queryKeys.NOTIFICATION_CONFIG, notifyServiceHost, accountUid])
    },
  })
}

export function useResendNotificationConfigVerification(
  notifyServiceHost: string | undefined,
  accountUid: string | undefined,
) {
  return useMutation({
    mutationFn: () =>
      client.notificationConfig.resendVerification.mutate({
        accountUid: accountUid!,
        notifyServiceHost,
      }),
    onSuccess: () => {
      invalidateQueries([queryKeys.NOTIFICATION_CONFIG, notifyServiceHost, accountUid])
    },
  })
}

export function useRemoveNotificationConfig(notifyServiceHost: string | undefined, accountUid: string | undefined) {
  return useMutation({
    mutationFn: () =>
      client.notificationConfig.removeConfig.mutate({
        accountUid: accountUid!,
        notifyServiceHost,
      }),
    onSuccess: () => {
      invalidateQueries([queryKeys.NOTIFICATION_CONFIG, notifyServiceHost, accountUid])
    },
  })
}
