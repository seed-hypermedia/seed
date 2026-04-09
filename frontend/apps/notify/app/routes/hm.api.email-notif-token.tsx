import {
  getEmailWithToken,
  getNotificationConfigsForEmail,
  getSubscription,
  setEmailUnsubscribed,
  setSubscription,
  unsetNotificationConfig,
} from '@/db'
import type {Email, NotificationConfigRow} from '@/db'
import {getApiPreflightResponse, withCors} from '@/utils/cors'
import {ActionFunction, LoaderFunction, json} from '@remix-run/node'
import {z} from 'zod'

export const loader: LoaderFunction = async ({request, params}) => {
  const preflight = getApiPreflightResponse(request)
  if (preflight) {
    return preflight
  }
  const url = new URL(request.url)
  const token = url.searchParams.get('token')
  if (!token) {
    return withCors(json({error: 'Invalid token'}, {status: 400}))
  }
  const email = getEmailWithToken(token)
  if (!email) {
    return withCors(json({error: 'Invalid token'}, {status: 400}))
  }
  const myNotifications = getNotificationConfigsForEmail(email.email)
  return withCors(
    json({
      ...email,
      myNotifications,
    } satisfies EmailNotifTokenLoaderResponse),
  )
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
  try {
    const url = new URL(request.url)
    const token = url.searchParams.get('token')

    if (!token) {
      return withCors(json({error: 'No token provided'}, {status: 400}))
    }
    const email = getEmailWithToken(token)
    if (!email) {
      return withCors(json({error: 'Invalid token'}, {status: 400}))
    }
    const anyBody = await request.json()
    const body = emailNotifTokenAction.parse(anyBody)
    if (body.action === 'set-email-unsubscribed') {
      setEmailUnsubscribed(token, body.isUnsubscribed)
      return withCors(json({}))
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

      return withCors(json({}))
    }
    if (body.action === 'unsubscribe-my-notification') {
      const removed = unsetNotificationConfig(body.accountId, email.email)
      return withCors(json({removed}))
    }
    return withCors(json({error: 'Invalid action'}, {status: 400}))
  } catch (error) {
    if (error instanceof z.ZodError) {
      return withCors(json({error: 'Invalid request data', details: error.errors}, {status: 400}))
    }
    return withCors(json({error: error instanceof Error ? error.message : 'Internal server error'}, {status: 500}))
  }
}
