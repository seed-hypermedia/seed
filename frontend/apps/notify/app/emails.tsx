import {createWelcomeEmail} from '@shm/emails/notifier'
import {HMMetadata} from '@seed-hypermedia/client/hm-types'
import {NOTIFY_SERVICE_HOST} from '@shm/shared/constants'
import {sendEmail} from './mailer'

/** Send the welcome email after a user subscribes to notifications. */
export async function sendNotificationWelcomeEmail(
  email: string,
  accountMeta: HMMetadata,
  opts: {
    adminToken: string
    notifyOwnedDocChange: boolean
    notifySiteDiscussions: boolean
  },
) {
  if (!NOTIFY_SERVICE_HOST) {
    throw new Error('NOTIFY_SERVICE_HOST is not set')
  }

  let notificationTypes = []
  if (opts.notifyOwnedDocChange) notificationTypes.push('document updates')
  if (opts.notifySiteDiscussions) notificationTypes.push('discussions')

  if (notificationTypes.length === 0) {
    return // no notifications enabled
  }

  const siteHost = NOTIFY_SERVICE_HOST.replace(/\/$/, '')
  const {subject, text, html} = createWelcomeEmail({
    recipientName: accountMeta?.name,
    siteName: 'Seed Hypermedia',
    siteUrl: siteHost,
  })

  await sendEmail(
    email,
    subject,
    {text, html},
    accountMeta?.name ? `Hypermedia Updates for ${accountMeta?.name}` : 'Hypermedia Updates',
  )
}
