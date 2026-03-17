import {Mjml, MjmlBody, MjmlColumn, MjmlHead, MjmlPreview, MjmlSection, MjmlText, MjmlTitle} from '@faire/mjml-react'
import {EmailFooter} from '@shm/emails/components/EmailFooter'
import {EmailHeader} from '@shm/emails/components/EmailHeader'
import {renderReactToMjml} from '@shm/emails/notifier'
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
  const notifSettingsUrl = `${NOTIFY_SERVICE_HOST.replace(/\/$/, '')}/hm/email-notifications?token=${opts.adminToken}`
  let notificationTypes = []
  if (opts.notifyOwnedDocChange) notificationTypes.push('document updates')
  if (opts.notifySiteDiscussions) notificationTypes.push('discussions')

  if (notificationTypes.length === 0) {
    return // no notifications enabled
  }

  const notifiedFor = notificationTypes.join(', ')
  const subject = `Welcome! You'll receive notifications for ${notifiedFor}`
  const primaryMessage = `You're now subscribed to receive email notifications for ${notifiedFor} on this site.`
  const text = `Welcome to Hypermedia Notifications!

${primaryMessage}

Manage notifications: ${notifSettingsUrl}`

  const {html} = renderReactToMjml(
    <Mjml>
      <MjmlHead>
        <MjmlTitle>{subject}</MjmlTitle>
        <MjmlPreview>Welcome! You're now subscribed to receive email notifications.</MjmlPreview>
      </MjmlHead>
      <MjmlBody width={500} backgroundColor="#ffffff">
        <EmailHeader />
        <MjmlSection padding="24px">
          <MjmlColumn>
            <MjmlText fontSize="18px" fontWeight="bold" lineHeight="1.4">
              Welcome!
            </MjmlText>
            <MjmlText fontSize="15px" lineHeight="1.6" paddingTop="8px">
              {primaryMessage}
            </MjmlText>
          </MjmlColumn>
        </MjmlSection>
        <EmailFooter unsubscribeUrl={notifSettingsUrl} />
      </MjmlBody>
    </Mjml>,
  )

  await sendEmail(
    email,
    subject,
    {text, html},
    accountMeta?.name ? `Hypermedia Updates for ${accountMeta?.name}` : 'Hypermedia Updates',
  )
}
