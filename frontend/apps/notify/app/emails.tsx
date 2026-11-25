import {createWelcomeEmail} from '@shm/emails/notifier'
import {HMMetadata} from '@seed-hypermedia/client/hm-types'
import {getNotifyEmailOrigin} from '@shm/emails/notify-links'
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
  let notificationTypes = []
  if (opts.notifyOwnedDocChange) notificationTypes.push('document updates')
  if (opts.notifySiteDiscussions) notificationTypes.push('discussions')

  if (notificationTypes.length === 0) {
    return // no notifications enabled
  }

  const {subject, text, html} = await createWelcomeEmail({
    recipientName: accountMeta?.name,
    siteName: 'Seed Hypermedia',
    siteUrl: getNotifyEmailOrigin(),
  })

  await sendEmail(
    email,
    subject,
    {text, html},
    accountMeta?.name ? `Hypermedia Updates for ${accountMeta?.name}` : 'Hypermedia Updates',
  )
}
