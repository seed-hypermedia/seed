import {useMutation, useQuery, useQueryClient} from '@tanstack/react-query'
import {get, post} from './api'
import type {EmailNotifTokenLoaderResponse} from './routes/hm.api.email-notif-token'
import type {EmailNotifTokenAction} from './routes/hm.api.email-notif-token'

export function useEmailNotificationsWithToken(token: string | null) {
  return useQuery({
    queryKey: ['email-notifications-with-token', token],
    queryFn: async () => {
      if (!token) {
        return null
      }
      const result = (await get(`/hm/api/email-notif-token?token=${token}`)) as EmailNotifTokenLoaderResponse
      return result
    },
  })
}

export function useSetEmailUnsubscribed(token: string | null) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationKey: ['set-subscription', token],
    mutationFn: async (isUnsubscribed: boolean) => {
      await post(`/hm/api/email-notif-token?token=${token}`, {
        action: 'set-email-unsubscribed',
        isUnsubscribed,
      } satisfies EmailNotifTokenAction)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['email-notifications-with-token', token],
      })
    },
  })
}

export function useSetAccountOptions(token: string | null) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationKey: ['set-account-options', token],
    mutationFn: async (input: {accountId: string; notifyOwnedDocChange?: boolean; notifySiteDiscussions?: boolean}) => {
      await post(`/hm/api/email-notif-token?token=${token}`, {
        action: 'set-account-options',
        ...input,
      } satisfies EmailNotifTokenAction)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['email-notifications-with-token', token],
      })
    },
  })
}

export function useUnsubscribeMyNotification(token: string | null) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationKey: ['unsubscribe-my-notification', token],
    mutationFn: async (accountId: string) => {
      await post(`/hm/api/email-notif-token?token=${token}`, {
        action: 'unsubscribe-my-notification',
        accountId,
      } satisfies EmailNotifTokenAction)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['email-notifications-with-token', token],
      })
    },
  })
}
