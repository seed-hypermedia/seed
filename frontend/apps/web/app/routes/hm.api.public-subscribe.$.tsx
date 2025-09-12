import {setSubscription} from '@/db'
import {sendNotificationWelcomeEmail} from '@/emails'
import {getMetadata} from '@/loaders'
import {BadRequestError, cborApiAction} from '@/server-api'
import {withCors} from '@/utils/cors'
import {LoaderFunction} from '@remix-run/node'
import {json} from '@remix-run/react'
import {hmId} from '@shm/shared'
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
})

export type PublicSubscribeAction = z.infer<typeof publicSubscribeAction>

export const action = cborApiAction<PublicSubscribeAction, any>(
  async (payload, {pathParts}) => {
    // Basic validation
    if (!payload.accountId) {
      throw new BadRequestError('Account ID is required')
    }

    // Create the subscription
    setSubscription({
      id: payload.accountId,
      email: payload.email,
      notifyAllMentions: payload.notifyAllMentions,
      notifyAllReplies: payload.notifyAllReplies,
      notifyOwnedDocChange: payload.notifyOwnedDocChange,
      notifySiteDiscussions: payload.notifySiteDiscussions,
    })

    // Send welcome email
    try {
      const metadata = await getMetadata(hmId(payload.accountId))
      if (metadata.metadata) {
        const {getEmail} = await import('@/db')
        const newEmail = getEmail(payload.email)
        if (newEmail) {
          sendNotificationWelcomeEmail(payload.email, metadata.metadata, {
            adminToken: newEmail.adminToken,
            notifyAllMentions: payload.notifyAllMentions,
            notifyAllReplies: payload.notifyAllReplies,
            notifyOwnedDocChange: payload.notifyOwnedDocChange,
            notifySiteDiscussions: payload.notifySiteDiscussions,
          })
        }
      }
    } catch (error) {
      console.error('Failed to send welcome email:', error)
      // Don't fail the subscription if welcome email fails
    }

    return withCors(json({success: true}))
  },
)
