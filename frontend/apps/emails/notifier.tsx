import {PlainMessage} from '@bufbuild/protobuf'
import {
  Mjml,
  MjmlBody,
  MjmlButton,
  MjmlColumn,
  MjmlHead,
  MjmlPreview,
  MjmlSection,
  MjmlText,
  MjmlTitle,
} from '@faire/mjml-react'
import {renderToMjml} from '@faire/mjml-react/utils/renderToMjml'
import {
  Comment,
  HMMetadata,
  SITE_BASE_URL,
  UnpackedHypermediaId,
} from '@shm/shared'
import mjml2html from 'mjml'
import {MJMLParseResults} from 'mjml-core'
import React from 'react'
import {EmailContent} from './components/EmailContent'
import {EmailHeader} from './components/EmailHeader'

type GroupedNotifications = Record<
  Notification['type'],
  Record<string, FullNotification[]>
>

export async function createNotificationsEmail(
  email: string,
  opts: {adminToken: string; isUnsubscribed: boolean; createdAt: string},
  notifications: FullNotification[],
) {
  if (!notifications.length) return

  const grouped: GroupedNotifications = {
    reply: {},
    mention: {},
  }

  for (const notif of notifications) {
    const type = notif.notif.type
    const docId = notif.notif.targetId.id
    if (!grouped[type][docId]) grouped[type][docId] = []
    grouped[type][docId].push(notif)
  }
  const subscriberNames: Set<string> = new Set()
  const notificationsByDocument: Record<string, FullNotification[]> = {}
  for (const notification of notifications) {
    if (!notificationsByDocument[notification.notif.targetId.id]) {
      notificationsByDocument[notification.notif.targetId.id] = []
    }
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
    (n) => n.notif.targetMeta?.name === notifications[0].notif.targetMeta?.name,
  )
    ? notifications[0].notif.targetMeta?.name
    : undefined
  if (singleDocumentTitle) {
    subject = `${baseNotifsSubject} on ${singleDocumentTitle}`
  }
  const firstNotificationSummary = getNotificationSummary(
    notifications[0].notif,
    notifications[0].accountMeta,
  )
  const notifSettingsUrl = `${SITE_BASE_URL}/hm/email-notifications?token=${opts.adminToken}`

  const text = `${baseNotifsSubject}

${docNotifs
  .map((notifications) => {
    const docName =
      notifications[0].notif.targetMeta?.name || 'Untitled Document'
    return `${docName}

${notifications
  .map((notification) => {
    const comment = notification.notif.comment
    return `New ${notification.notif.type} from ${comment.author} on ${notification.notif.url}`
  })
  .join('\n')}
  
${notifications[0].notif.url}

`
  })
  .join('\n')}

Subscribed by mistake? Click here to unsubscribe: ${notifSettingsUrl}`

  const {html: emailHtml} = renderReactToMjml(
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
        <EmailHeader
          avatarUrl={notifications[0].accountMeta.icon}
          name={notifications[0].accountMeta.name}
        />

        {(['reply', 'mention'] as const).map((type) => {
          const docs = grouped[type]
          const docEntries = Object.entries(docs)

          if (!docEntries.length) return null

          const sectionTitle =
            type === 'reply'
              ? `You have ${docEntries.flatMap(([, n]) => n).length} new repl${
                  docEntries.flatMap(([, n]) => n).length === 1 ? 'y' : 'ies'
                }!`
              : 'You have been mentioned!'

          return (
            <>
              <MjmlSection padding="10px 0px 0px">
                <MjmlColumn padding="0px">
                  <MjmlText fontSize="20px" fontWeight="bold">
                    {sectionTitle}
                  </MjmlText>
                </MjmlColumn>
              </MjmlSection>

              {docEntries.map(([docId, docNotifs]) => {
                const targetName =
                  docNotifs[0].notif.targetMeta?.name || 'Untitled Document'
                const docUrl = docNotifs[0].notif.url

                return (
                  <>
                    <MjmlSection padding="0px 0px 10px">
                      <MjmlColumn>
                        <MjmlText fontSize="14px" color="#888">
                          {type === 'reply' ? (
                            <>
                              You have ({docNotifs.length}) repl
                              {docNotifs.length === 1 ? 'y' : 'ies'}
                              {' on  '}
                              <span
                                style={{
                                  fontWeight: 'bold',
                                  color: 'black',
                                  backgroundColor: 'lightgray',
                                }}
                              >
                                {targetName}
                              </span>
                            </>
                          ) : null}
                        </MjmlText>
                      </MjmlColumn>
                    </MjmlSection>

                    {docNotifs.map((notif) => (
                      <>
                        <EmailContent
                          key={notif.notif.comment.id}
                          notification={notif.notif}
                        />
                        <MjmlSection padding="0px">
                          <MjmlColumn>
                            <MjmlText lineHeight="1" fontSize="1px">
                              &nbsp;
                            </MjmlText>
                          </MjmlColumn>
                        </MjmlSection>
                      </>
                    ))}

                    <MjmlSection>
                      <MjmlColumn>
                        <MjmlButton
                          align="left"
                          href={docUrl}
                          backgroundColor={
                            // type === "reply" ? "#008060" : "#008060"
                            '#008060'
                          }
                        >
                          {type === 'reply' ? 'Reply' : 'Open Mention'}
                        </MjmlButton>
                      </MjmlColumn>
                    </MjmlSection>
                  </>
                )
              })}
            </>
          )
        })}

        {/* <NotifSettings url={notifSettingsUrl} /> */}
      </MjmlBody>
      ;
    </Mjml>,
  )

  return {email, subject, text, html: emailHtml, subscriberNames}
}

function NotifSettings({url}: {url: string}) {
  return (
    <MjmlSection>
      <MjmlText fontSize={10} paddingBottom={10} align="center">
        Subscribed by mistake? Click here to unsubscribe:
      </MjmlText>
      <MjmlButton
        padding="8px"
        backgroundColor="#828282"
        href={url}
        align="center"
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
      resolvedNames?: Record<string, string>
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
    return `You have a new reply from ${
      notification.commentAuthorMeta?.name || notification.comment.author
    }.`
  }
  return ''
}

export function renderReactToMjml(email: React.ReactElement): MJMLParseResults {
  return mjml2html(renderToMjml(email))
}
