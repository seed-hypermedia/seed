import {
  getEmailWithToken,
  getSubscription,
  setEmailUnsubscribed,
  setSubscription,
} from '@/db'
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
  return json(email)
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
    notifyAllMentions: z.boolean().optional(),
    notifyAllReplies: z.boolean().optional(),
    notifyAllComments: z.boolean().optional(),
  }),
])

export type EmailNotifTokenAction = z.infer<typeof emailNotifTokenAction>

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

    const nextNotifyOwnedDocChange =
      body.notifyOwnedDocChange ?? current?.notifyOwnedDocChange ?? false
    const nextNotifySiteDiscussions =
      body.notifySiteDiscussions ?? current?.notifySiteDiscussions ?? false

    const nextNotifyAllMentions =
      body.notifyAllMentions ?? current?.notifyAllMentions ?? false
    const nextNotifyAllReplies =
      body.notifyAllReplies ?? current?.notifyAllReplies ?? false
    const nextNotifyAllComments =
      body.notifyAllComments ?? current?.notifyAllComments ?? false

    setSubscription({
      id: accountId,
      email: subscriberEmail,
      notifyAllMentions: nextNotifyAllMentions,
      notifyAllReplies: nextNotifyAllReplies,
      notifyOwnedDocChange: nextNotifyOwnedDocChange,
      notifySiteDiscussions: nextNotifySiteDiscussions,
      notifyAllComments: nextNotifyAllComments,
    })

    return json({})
  }
  return json({error: 'Invalid action'}, {status: 400})
}
