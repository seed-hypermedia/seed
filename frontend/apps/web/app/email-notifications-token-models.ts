import {NOTIFY_SERVICE_HOST} from '@shm/shared/constants'
import {invalidateQueries} from '@shm/shared/models/query-client'
import {NOTIFY_API_PREFIX, notifyEndpointUrl} from '@shm/shared/notify-url'
import {useMutation, useQuery} from '@tanstack/react-query'

/** A space subscription of an email, as returned by the notify service's `email-notif-token` endpoint. */
export type EmailNotifTokenSubscription = {
  id: string
  email: string
  createdAt: string
  notifyOwnedDocChange: boolean
  notifySiteDiscussions: boolean
}

/** Response of `GET email-notif-token?token=…` on the notify service. */
export type EmailNotifTokenLoaderResponse = {
  email: string
  adminToken: string
  createdAt: string
  isUnsubscribed: boolean
  subscriptions: EmailNotifTokenSubscription[]
  myNotifications: {
    accountId: string
    email: string
    verifiedTime: string | null
    createdAt: string
    updatedAt: string
  }[]
}

/** Request body of `POST email-notif-token?token=…` on the notify service. */
export type EmailNotifTokenAction =
  | {action: 'set-email-unsubscribed'; isUnsubscribed: boolean}
  | {action: 'set-account-options'; accountId: string; notifyOwnedDocChange?: boolean; notifySiteDiscussions?: boolean}
  | {action: 'unsubscribe-my-notification'; accountId: string}

/**
 * The notify endpoint that manages an email by its admin token. Uses the configured notify
 * service, or the notify service on this site's own origin when none is configured.
 */
export function emailNotifTokenUrl(token: string, notifyBase: string | undefined, origin: string): string {
  const base = notifyBase || `${origin}${NOTIFY_API_PREFIX}`
  return `${notifyEndpointUrl(base, 'email-notif-token')}?token=${encodeURIComponent(token)}`
}

function tokenUrl(token: string) {
  return emailNotifTokenUrl(token, NOTIFY_SERVICE_HOST, window.location.origin)
}

async function readJson(response: Response) {
  const body = await response.json().catch(() => null)
  if (!response.ok) {
    throw new Error(body?.error || `Request failed (${response.status})`)
  }
  return body
}

async function postAction(token: string, body: EmailNotifTokenAction) {
  // No Content-Type: a plain-text body keeps this a simple CORS request when notify is on another origin.
  return readJson(await fetch(tokenUrl(token), {method: 'POST', body: JSON.stringify(body)}))
}

export function useEmailNotificationsWithToken(token: string | null) {
  return useQuery({
    queryKey: ['email-notifications-with-token', token],
    queryFn: async () => {
      if (!token) {
        return null
      }
      return (await readJson(await fetch(tokenUrl(token)))) as EmailNotifTokenLoaderResponse
    },
  })
}

export function useSetEmailUnsubscribed(token: string | null) {
  return useMutation({
    mutationKey: ['set-subscription', token],
    mutationFn: async (isUnsubscribed: boolean) => {
      await postAction(token!, {action: 'set-email-unsubscribed', isUnsubscribed})
    },
    onSuccess: () => {
      invalidateQueries(['email-notifications-with-token', token])
    },
  })
}

export function useSetAccountOptions(token: string | null) {
  return useMutation({
    mutationKey: ['set-account-options', token],
    mutationFn: async (input: {accountId: string; notifyOwnedDocChange?: boolean; notifySiteDiscussions?: boolean}) => {
      await postAction(token!, {action: 'set-account-options', ...input})
    },
    onSuccess: () => {
      invalidateQueries(['email-notifications-with-token', token])
    },
  })
}

export function useUnsubscribeMyNotification(token: string | null) {
  return useMutation({
    mutationKey: ['unsubscribe-my-notification', token],
    mutationFn: async (accountId: string) => {
      await postAction(token!, {action: 'unsubscribe-my-notification', accountId})
    },
    onSuccess: () => {
      invalidateQueries(['email-notifications-with-token', token])
    },
  })
}
