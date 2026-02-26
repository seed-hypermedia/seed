import {
  getEmailWithToken,
  getNotificationConfigsForEmail,
  getSubscription,
  setEmailUnsubscribed,
  setSubscription,
  unsetNotificationConfig,
} from '@/db'
import type {Email, NotificationConfigRow} from '@/db'
import {ActionFunction, LoaderFunction} from '@remix-run/node'
import {json} from '@remix-run/react'
import {z} from 'zod'

export const loader: LoaderFunction = async ({request, params}) => {
  const url = new URL(request.url)
  const token = url.searchParams.get('token')
  if (!token) {
    return json({error: 'Invalid token'}, {status: 400})
  }
  const email = getEmailWithToken(token)
  if (!email) {
    return json({error: 'Invalid token'}, {status: 400})
  }
  const myNotifications = getNotificationConfigsForEmail(email.email)
  return json({
    ...email,
    myNotifications,
  } satisfies EmailNotifTokenLoaderResponse)
}

const emailNotifTokenAction = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('set-email-unsubscribed'),
    isUnsubscribed: z.boolean(),
  }),
  z.object({
    action: z.literal('set-account-options'),
    accountId: z.string(),
    notifyOwnedDocChange: z.boolean().optional(),
    notifySiteDiscussions: z.boolean().optional(),
  }),
  z.object({
    action: z.literal('unsubscribe-my-notification'),
    accountId: z.string(),
  }),
])

export type EmailNotifTokenAction = z.infer<typeof emailNotifTokenAction>
export type EmailNotifTokenLoaderResponse = Email & {
  myNotifications: NotificationConfigRow[]
}

export const action: ActionFunction = async ({request, params}) => {
  const url = new URL(request.url)
  const token = url.searchParams.get('token')

  if (!token) {
    return json({error: 'No token provided'}, {status: 400})
  }
  const email = getEmailWithToken(token)
  if (!email) {
    return json({error: 'Invalid token'}, {status: 400})
  }
  const anyBody = await request.json()
  const body = emailNotifTokenAction.parse(anyBody)
  if (body.action === 'set-email-unsubscribed') {
    setEmailUnsubscribed(token, body.isUnsubscribed)
    return json({})
  }
  if (body.action === 'set-account-options') {
    const {accountId} = body
    const subscriberEmail = email.email
    const current = getSubscription(accountId, subscriberEmail)

    const nextNotifyOwnedDocChange = body.notifyOwnedDocChange ?? current?.notifyOwnedDocChange ?? false
    const nextNotifySiteDiscussions = body.notifySiteDiscussions ?? current?.notifySiteDiscussions ?? false

    setSubscription({
      id: accountId,
      email: subscriberEmail,
      notifyOwnedDocChange: nextNotifyOwnedDocChange,
      notifySiteDiscussions: nextNotifySiteDiscussions,
    })

    return json({})
  }
  if (body.action === 'unsubscribe-my-notification') {
    const removed = unsetNotificationConfig(body.accountId, email.email)
    return json({removed})
  }
  return json({error: 'Invalid action'}, {status: 400})
}
