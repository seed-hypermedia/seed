import {PlainMessage} from '@bufbuild/protobuf'
import {
  Mjml,
  MjmlBody,
  MjmlButton,
  MjmlHead,
  MjmlPreview,
  MjmlSection,
  MjmlText,
  MjmlTitle,
} from '@faire/mjml-react'
import {renderToMjml} from '@faire/mjml-react/utils/renderToMjml'
import {Comment, HMMetadata, UnpackedHypermediaId} from '@shm/shared'
import {SITE_BASE_URL} from '@shm/shared/constants'
import mjml2html from 'mjml'
import {MJMLParseResults} from 'mjml-core'
import React from 'react'
import {sendEmail} from './mailer'

export async function sendNotificationsEmail(
  email: string,
  opts: {adminToken: string; isUnsubscribed: boolean; createdAt: string},
  notifications: FullNotification[],
) {
  if (!notifications.length) return
  const subscriberNames: Set<string> = new Set()
  const notificationsByDocument: Record<string, FullNotification[]> = {}
  for (const notification of notifications) {
    if (!notificationsByDocument[notification.notif.targetId.id]) {
      notificationsByDocument[notification.notif.targetId.id] = []
    }
    // @ts-expect-error
    notificationsByDocument[notification.notif.targetId.id].push(notification)
    subscriberNames.add(notification.accountMeta?.name || 'You')
  }
  const docNotifs = Object.values(notificationsByDocument)
  const baseNotifsSubject =
    notifications.length > 1
      ? `${notifications.length} Notifications`
      : 'Notification'
  let subject = baseNotifsSubject
  const singleDocumentTitle = notifications.every(
    // @ts-expect-error
    (n) => n.notif.targetMeta?.name === notifications[0].notif.targetMeta?.name,
  )
    ? // @ts-expect-error
      notifications[0].notif.targetMeta?.name
    : undefined
  if (singleDocumentTitle) {
    subject = `${baseNotifsSubject} on ${singleDocumentTitle}`
  }
  const firstNotificationSummary = getNotificationSummary(
    // @ts-expect-error
    notifications[0].notif,
    // @ts-expect-error
    notifications[0].accountMeta,
  )
  const notifSettingsUrl = `${SITE_BASE_URL.replace(
    /\/$/,
    '',
  )}/hm/email-notifications?token=${opts.adminToken}`

  const text = `${baseNotifsSubject}

${docNotifs
  .map((notifications) => {
    const docName =
      // @ts-expect-error
      notifications[0].notif.targetMeta?.name || 'Untitled Document'

    // @ts-expect-error
    const firstNotifUrl = notifications[0].notif.url

    return `${docName}

${notifications
  .map((notification) => {
    const comment = notification.notif.comment
    return `New ${notification.notif.type} from ${comment.author} on ${notification.notif.url}`
  })
  .join('\n')}

${firstNotifUrl}

`
  })
  .join('\n')}

Subscribed by mistake? Click here to unsubscribe: ${notifSettingsUrl}`
  const {html} = renderReactToMjml(
    <Mjml>
      <MjmlHead>
        <MjmlTitle>{subject}</MjmlTitle>
        {/* This preview is visible from the email client before the user clicks on the email */}
        <MjmlPreview>
          {notifications.length > 1
            ? `${firstNotificationSummary} and more`
            : firstNotificationSummary}
        </MjmlPreview>
      </MjmlHead>
      <MjmlBody width={500}>
        {/* <MjmlSection fullWidth backgroundColor="#efefef">
            <MjmlColumn>
              <MjmlImage src="https://static.wixstatic.com/media/5cb24728abef45dabebe7edc1d97ddd2.jpg" />
            </MjmlColumn>
          </MjmlSection> */}
        {docNotifs.map((notifications) => {
          return (
            <MjmlSection>
              <MjmlText fontSize={20} fontWeight={'bold'}>
                {/* @ts-expect-error */}
                {notifications[0].notif.targetMeta?.name || 'Untitled Document'}
              </MjmlText>
              {notifications.map((notification) => {
                return (
                  <MjmlText paddingBottom={8} paddingTop={8}>
                    {getNotificationSummary(
                      notification.notif,
                      notification.accountMeta,
                    )}
                  </MjmlText>
                )
              })}
              <MjmlButton
                padding="8px"
                backgroundColor="#346DB7"
                // @ts-expect-error
                href={notifications[0].notif.url}
              >
                Open Document
              </MjmlButton>
            </MjmlSection>
          )
        })}
        <NotifSettings url={notifSettingsUrl} />
      </MjmlBody>
    </Mjml>,
  )

  await sendEmail(
    email,
    subject,
    {text, html},
    `Hypermedia Updates for ${Array.from(subscriberNames).join(', ')}`,
  )
}

export async function sendNotificationWelcomeEmail(
  email: string,
  accountMeta: HMMetadata,
  opts: {
    adminToken: string
    notifyAllMentions: boolean
    notifyAllReplies: boolean
    notifyOwnedDocChange: boolean
    notifySiteDiscussions: boolean
    notifyAllComments?: boolean
  },
) {
  const notifSettingsUrl = `${SITE_BASE_URL.replace(
    /\/$/,
    '',
  )}/hm/email-notifications?token=${opts.adminToken}`
  let notificationTypes = []
  if (opts.notifyAllMentions) notificationTypes.push('mentions')
  if (opts.notifyAllReplies) notificationTypes.push('replies')
  if (opts.notifyOwnedDocChange) notificationTypes.push('document updates')
  if (opts.notifySiteDiscussions) notificationTypes.push('discussions')
  if (opts.notifyAllComments) notificationTypes.push('comments')

  if (notificationTypes.length === 0) {
    return // no notifications enabled
  }

  const notifiedFor = notificationTypes.join(', ')
  const subject = `Welcome! You'll receive notifications for ${notifiedFor}`
  const primaryMessage = `You're now subscribed to receive email notifications for ${notifiedFor} on this site.`
  const text = `Welcome to Hypermedia Notifications!

${primaryMessage}

Subscribed by mistake? Click here to unsubscribe: ${notifSettingsUrl}`
  const {html} = renderReactToMjml(
    <Mjml>
      <MjmlHead>
        <MjmlTitle>{subject}</MjmlTitle>
        {/* This preview is visible from the email client before the user clicks on the email */}
        <MjmlPreview>
          Welcome! You're now subscribed to receive email notifications.
        </MjmlPreview>
      </MjmlHead>
      <MjmlBody width={500}>
        <MjmlSection>
          <MjmlText>{primaryMessage}</MjmlText>
        </MjmlSection>
        <NotifSettings url={notifSettingsUrl} />
      </MjmlBody>
    </Mjml>,
  )

  await sendEmail(
    email,
    subject,
    {text, html},
    accountMeta?.name
      ? `Hypermedia Updates for ${accountMeta?.name}`
      : 'Hypermedia Updates',
  )
}

function NotifSettings({url}: {url: string}) {
  return (
    <MjmlSection>
      <MjmlText fontSize={12} paddingBottom={16} align="center" color="#666666">
        Subscribed by mistake? Click here to unsubscribe:
      </MjmlText>
      <MjmlButton
        padding="12px 24px"
        backgroundColor="#068f7b"
        href={url}
        align="center"
        borderRadius="6px"
        color="#ffffff"
        fontSize="14px"
        fontWeight="500"
      >
        Manage Email Notifications
      </MjmlButton>
    </MjmlSection>
  )
}

export type Notification =
  | {
      type: 'mention'
      comment: PlainMessage<Comment>
      commentAuthorMeta: HMMetadata | null
      targetMeta: HMMetadata | null
      targetId: UnpackedHypermediaId
      parentComments: PlainMessage<Comment>[]
      url: string
    }
  | {
      type: 'reply'
      comment: PlainMessage<Comment>
      commentAuthorMeta: HMMetadata | null
      targetMeta: HMMetadata | null
      targetId: UnpackedHypermediaId
      parentComments: PlainMessage<Comment>[]
      url: string
    }

export type FullNotification = {
  accountId: string
  accountMeta: HMMetadata | null
  notif: Notification
}

function getNotificationSummary(
  notification: Notification,
  accountMeta: HMMetadata | null,
): string {
  if (notification.type === 'mention') {
    return `${accountMeta?.name || 'You were'} mentioned by ${
      notification.commentAuthorMeta?.name || notification.comment.author
    }.`
  }
  if (notification.type === 'reply') {
    return `Reply from ${
      notification.commentAuthorMeta?.name || notification.comment.author
    }.`
  }
  return ''
}

export function renderReactToMjml(email: React.ReactElement): MJMLParseResults {
  return mjml2html(renderToMjml(email))
}
