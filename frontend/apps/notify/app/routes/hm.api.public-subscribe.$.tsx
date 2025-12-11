import {setSubscription} from '@/db'
import {sendNotificationWelcomeEmail} from '@/emails'
import {requestAPI} from '@/notify-request'
import {withCors} from '@/utils/cors'
import {ActionFunction, LoaderFunction} from '@remix-run/node'
import {json} from '@remix-run/react'
import {z} from 'zod'

export const loader: LoaderFunction = async ({request, params}) => {
  return withCors(json({}))
}

const publicSubscribeAction = z.object({
  action: z.literal('subscribe'),
  email: z.string().email(),
  accountId: z.string(),
  notifyAllMentions: z.boolean().optional().default(false),
  notifyAllReplies: z.boolean().optional().default(false),
  notifyOwnedDocChange: z.boolean().optional().default(false),
  notifySiteDiscussions: z.boolean().optional().default(true), // Default to true for public subscribers
  notifyAllComments: z.boolean().optional().default(false),
})

export type PublicSubscribeAction = z.infer<typeof publicSubscribeAction>

export const action: ActionFunction = async ({request}) => {
  if (request.method !== 'POST') {
    return withCors(json({message: 'Method not allowed'}, {status: 405}))
  }

  try {
    const data = await request.json()
    const payload = publicSubscribeAction.parse(data)

    // Basic validation
    if (!payload.accountId) {
      return withCors(json({error: 'Account ID is required'}, {status: 400}))
    }

    const subConfig = {
      notifyAllMentions: payload.notifyAllMentions,
      notifyAllReplies: payload.notifyAllReplies,
      notifyOwnedDocChange: payload.notifyOwnedDocChange,
      notifySiteDiscussions: payload.notifySiteDiscussions,
      notifyAllComments: payload.notifyAllComments,
    } as const

    // Create the subscription
    setSubscription({
      id: payload.accountId,
      email: payload.email,
      ...subConfig,
    })

    // Send welcome email
    try {
      const metadata = await requestAPI('Account', payload.accountId)
      if (metadata.metadata) {
        const {getEmail} = await import('@/db')
        const newEmail = getEmail(payload.email)
        if (newEmail && !newEmail.isUnsubscribed) {
          sendNotificationWelcomeEmail(payload.email, metadata.metadata, {
            adminToken: newEmail.adminToken,
            ...subConfig,
          })
        }
      }
    } catch (error) {
      console.error('Failed to send welcome email:', error)
    }

    return withCors(json({success: true}))
  } catch (error) {
    console.error('Public subscribe error:', error)
    if (error instanceof z.ZodError) {
      return withCors(
        json(
          {error: 'Invalid request data', details: error.errors},
          {status: 400},
        ),
      )
    }
    return withCors(json({error: 'Internal server error'}, {status: 500}))
  }
}
