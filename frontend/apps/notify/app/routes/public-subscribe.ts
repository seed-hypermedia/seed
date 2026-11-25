import {setSubscription} from '@/db'
import {sendNotificationWelcomeEmail} from '@/emails'
import {requestAPI} from '@/notify-request'
import {corsJson} from '@/utils/cors'
import {z} from 'zod'

export function GET() {
  return corsJson({})
}

const publicSubscribeAction = z.object({
  action: z.literal('subscribe'),
  email: z.string().email(),
  accountId: z.string(),
  notifyOwnedDocChange: z.boolean().optional().default(false),
  notifySiteDiscussions: z.boolean().optional().default(true), // Default to true for public subscribers
})

export type PublicSubscribeAction = z.infer<typeof publicSubscribeAction>

/** Subscribes an email to a site's activity and sends the welcome email. */
export async function POST(request: Request) {
  try {
    const data = await request.json()
    const payload = publicSubscribeAction.parse(data)

    // Basic validation
    if (!payload.accountId) {
      return corsJson({error: 'Account ID is required'}, {status: 400})
    }

    const subConfig = {
      notifyOwnedDocChange: payload.notifyOwnedDocChange,
      notifySiteDiscussions: payload.notifySiteDiscussions,
    } as const

    // Create the subscription
    setSubscription({
      id: payload.accountId,
      email: payload.email,
      ...subConfig,
    })

    // Send welcome email
    try {
      const accountResult = await requestAPI('Account', payload.accountId)
      if (accountResult.type === 'account' && accountResult.metadata) {
        const {getEmail} = await import('@/db')
        const newEmail = getEmail(payload.email)
        if (newEmail && !newEmail.isUnsubscribed) {
          sendNotificationWelcomeEmail(payload.email, accountResult.metadata, {
            adminToken: newEmail.adminToken,
            ...subConfig,
          })
        }
      }
    } catch (error) {
      console.error('Failed to send welcome email:', error)
    }

    return corsJson({success: true})
  } catch (error) {
    console.error('Public subscribe error:', error)
    if (error instanceof z.ZodError) {
      return corsJson({error: 'Invalid request data', details: error.errors}, {status: 400})
    }
    return corsJson({error: 'Internal server error'}, {status: 500})
  }
}
