import {getEmailWithToken, setAccount, setEmailUnsubscribed} from '@/db'
import {ActionFunction, LoaderFunction} from 'react-router'
import {json} from '@/utils/json'
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
    notifyAllMentions: z.boolean().optional(),
    notifyAllReplies: z.boolean().optional(),
    notifyOwnedDocChange: z.boolean().optional(),
    notifySiteDiscussions: z.boolean().optional(),
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
    setAccount({
      id: body.accountId,
      notifyAllMentions: body.notifyAllMentions,
      notifyAllReplies: body.notifyAllReplies,
      notifyOwnedDocChange: body.notifyOwnedDocChange,
      notifySiteDiscussions: body.notifySiteDiscussions,
    })
    return json({})
  }
  return json({error: 'Invalid action'}, {status: 400})
}
