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
import {Comment, HMMetadata, UnpackedHypermediaId} from '@shm/shared'
import {NOTIFY_SERVICE_HOST} from '@shm/shared/constants'
import mjml2html from 'mjml'
import {MJMLParseResults} from 'mjml-core'
import React from 'react'
import {EmailContent} from './components/EmailContent'
import {EmailHeader} from './components/EmailHeader'
import {NotifSettings} from './components/NotifSettings'

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
    change: {},
    comment: {},
    mention: {},
    reply: {},
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
    // @ts-ignore
    notificationsByDocument[notification.notif.targetId.id].push(notification)
    subscriberNames.add(notification.accountMeta?.name || 'Subscriber')
  }
  const docNotifs = Object.values(notificationsByDocument)
  const baseNotifsSubject =
    notifications?.length > 1
      ? `${notifications?.length} Notifications`
      : 'Notification'
  let subject = baseNotifsSubject
  // @ts-ignore
  // @ts-ignore
  const singleDocumentTitle = notifications.every(
    // @ts-ignore
    (n) => n.notif.targetMeta?.name === notifications[0].notif.targetMeta?.name,
  )
    ? // @ts-ignore
      notifications?.[0].notif.targetMeta?.name
    : undefined
  if (singleDocumentTitle) {
    // @ts-ignore
    // @ts-ignore
    subject = `${baseNotifsSubject} on ${singleDocumentTitle}`
  }
  // @ts-ignore
  // @ts-ignore
  const firstNotificationSummary = getNotificationSummary(
    // @ts-ignore
    notifications?.[0].notif,
    // @ts-ignore
    notifications?.[0].accountMeta,
  )
  const notifSettingsUrl = `${NOTIFY_SERVICE_HOST}/hm/email-notifications?token=${opts.adminToken}` // Remove trailing slash if SITE_BASE_URL has one

  // @ts-ignore
  const text = `${baseNotifsSubject}

// @ts-expect-error
${docNotifs
  // @ts-ignore
  .map((notifications) => {
    // @ts-ignore
    const docName =
      notifications?.[0]?.notif?.targetMeta?.name || 'Untitled Document'

    const lines = notifications
      .map((notification) => {
        const {notif} = notification

        if (notif.type === 'comment') {
          return `New comment from ${
            notif.authorMeta?.name || 'an account you are subscribed to'
          } on ${notif.url}`
        }

        if (notif.type === 'change') {
          return `New document change from ${
            notif.authorMeta?.name || notif.authorAccountId
          } on ${notif.url}`
        }

        if (notif.type === 'mention') {
          return `${
            notif.authorMeta?.name || notif.authorAccountId
          } mentioned ${
            notification.accountMeta?.name || 'an account you are subscribed to'
          } on ${notif.url}`
        }

        if (notif.type === 'reply') {
          return `${
            notif.authorMeta?.name || notif.comment.author
          } replied to ${
            notification.accountMeta?.name || 'an account you are subscribed to'
          } comment on ${notif.url}`
        }

        return ''
      })
      .join('\n')

    return `${docName}\n\n${lines}\n\n${notifications?.[0]?.notif?.url}`
  })
  .join('\n')}

Subscribed by mistake? Click here to unsubscribe: ${notifSettingsUrl}`

  // console.log(notifications[0].notif.comment?.content)
  // console.log(JSON.stringify(notifications[0], null, 2))

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
        <EmailHeader />

        {(['change', 'comment', 'mention', 'reply'] as const).map((type) => {
          const docs = grouped[type]
          const docEntries = Object.entries(docs)

          if (!docEntries.length) return null

          const totalCount = docEntries.flatMap(([, n]) => n).length

          const sectionTitle = (() => {
            switch (type) {
              case 'comment':
                return `New comment${totalCount === 1 ? '' : 's'}`
              case 'mention':
                return `Mention${totalCount === 1 ? '' : 's'}`
              case 'reply':
                return `Repl${totalCount === 1 ? 'y' : 'ies'}`
              case 'change':
              default:
                return 'Document changes'
            }
          })()

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
                  docNotifs?.[0]?.notif?.targetMeta?.name || 'Untitled Document'
                const docUrl = docNotifs?.[0]?.notif?.url

                return (
                  <>
                    <MjmlSection padding="0px 0px 10px">
                      <MjmlColumn>
                        <MjmlText fontSize="14px" color="#888">
                          {type === 'comment' ? (
                            <>
                              {docNotifs.length} comment
                              {docNotifs.length === 1 ? '' : 's'} on{' '}
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
                          ) : type === 'mention' ? (
                            <>
                              {docNotifs.length} mention
                              {docNotifs.length === 1 ? '' : 's'} on{' '}
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
                          ) : type === 'reply' ? (
                            <>
                              {docNotifs.length} repl
                              {totalCount === 1 ? 'y' : 'ies'} on{' '}
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

                    {docNotifs.map(({notif}) => {
                      return (
                        <>
                          <EmailContent
                            key={
                              'comment' in notif && notif.comment
                                ? notif.comment.id
                                : Math.random()
                            }
                            notification={notif}
                          />
                          <MjmlSection padding="0px">
                            <MjmlColumn>
                              <MjmlText lineHeight="1" fontSize="1px">
                                &nbsp;
                              </MjmlText>
                            </MjmlColumn>
                          </MjmlSection>
                        </>
                      )
                    })}

                    <MjmlSection>
                      <MjmlColumn>
                        <MjmlButton
                          align="left"
                          href={docUrl}
                          backgroundColor="#008060"
                        >
                          {type === 'comment'
                            ? 'View Comment'
                            : type === 'mention'
                            ? 'View Mention'
                            : type === 'reply'
                            ? 'View Reply'
                            : 'View Change'}
                        </MjmlButton>
                      </MjmlColumn>
                    </MjmlSection>
                  </>
                )
              })}
            </>
          )
        })}

        <NotifSettings url={notifSettingsUrl} />
      </MjmlBody>
      ;
    </Mjml>,
  )

  return {email, subject, text, html: emailHtml, subscriberNames}
}

export type Notification =
  | {
      type: 'change'
      authorAccountId: string
      authorMeta: HMMetadata | null
      targetMeta: HMMetadata | null
      targetId: UnpackedHypermediaId
      url: string
      isNewDocument: boolean
    }
  | {
      type: 'comment'
      comment: PlainMessage<Comment>
      parentComments: PlainMessage<Comment>[]
      authorMeta: HMMetadata | null
      targetMeta: HMMetadata | null
      targetId: UnpackedHypermediaId
      url: string
      resolvedNames?: Record<string, string>
    }
  | {
      type: 'mention'
      authorAccountId: string
      authorMeta: HMMetadata | null
      targetMeta: HMMetadata | null
      targetId: UnpackedHypermediaId
      url: string
      source: 'comment' | 'document'
      comment?: PlainMessage<Comment>
      resolvedNames?: Record<string, string>
    }
  | {
      type: 'reply'
      comment: PlainMessage<Comment>
      parentComments: PlainMessage<Comment>[]
      authorMeta: HMMetadata | null
      targetMeta: HMMetadata | null
      targetId: UnpackedHypermediaId
      url: string
      resolvedNames?: Record<string, string>
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
  if (notification.type === 'change') {
    return `${notification.authorMeta?.name || 'Someone'} made changes to ${
      notification.targetMeta?.name || 'a document'
    }.`
  }
  if (notification.type === 'comment') {
    return `${notification.authorMeta?.name || 'Someone'} commented on ${
      notification.targetMeta?.name || 'a document'
    }.`
  }
  if (notification.type === 'mention') {
    if (notification.source === 'comment') {
      return `${notification.authorMeta?.name || 'Someone'} mentioned ${
        accountMeta?.name || 'an account you are subscribed to'
      } in a comment on ${notification.targetMeta?.name || 'a document'}.`
    } else {
      return `${notification.authorMeta?.name || 'Someone'} mentioned ${
        accountMeta?.name || 'an account you are subscribed to'
      } in ${notification.targetMeta?.name || 'a document'}.`
    }
  }
  if (notification.type === 'reply') {
    return `${notification.authorMeta?.name || 'Someone'} replied to ${
      accountMeta?.name || 'an account you are subscribed to'
    } comment on ${notification.targetMeta?.name || 'a document'}.`
  }
  return ''
}

export function renderReactToMjml(email: React.ReactElement): MJMLParseResults {
  return mjml2html(renderToMjml(email))
}
