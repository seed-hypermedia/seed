import {useMutation, useQuery, useQueryClient} from '@tanstack/react-query'
import {get, post} from './api'
import type {Email} from './db'
import type {EmailNotifTokenAction} from './routes/hm.api.email-notif-token'

export function useEmailNotificationsWithToken(token: string | null) {
  return useQuery({
    queryKey: ['email-notifications-with-token', token],
    queryFn: async () => {
      if (!token) {
        return null
      }
      const result = (await get(
        `/hm/api/email-notif-token?token=${token}`,
      )) as Email
      return result
    },
  })
}

export function useSetSubscription(token: string | null) {
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
    mutationFn: async (input: {
      accountId: string
      notifyAllMentions?: boolean
      notifyAllReplies?: boolean
      notifyOwnedDocChange?: boolean
      notifySiteDiscussions?: boolean
    }) => {
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
