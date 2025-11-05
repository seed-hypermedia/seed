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
  Notification['reason'],
  Record<string, FullNotification[]>
>

export async function createNotificationsEmail(
  email: string,
  opts: {adminToken: string},
  notifications: FullNotification[],
) {
  if (!notifications.length) return

  const firstNotification = notifications[0]!

  const grouped: GroupedNotifications = {
    'site-doc-update': {},
    'site-new-discussion': {},
    mention: {},
    reply: {},
    'user-comment': {},
  }

  for (const notif of notifications) {
    const reason = notif.notif.reason
    const docId = notif.notif.targetId.id
    if (!grouped[reason]?.[docId]) grouped[reason][docId] = []
    grouped[reason]?.[docId]?.push(notif)
  }
  const subscriberNames: Set<string> = new Set()
  const notificationsByDocument: Record<string, FullNotification[]> = {}
  for (const notification of notifications) {
    if (!notificationsByDocument[notification.notif.targetId.id]) {
      notificationsByDocument[notification.notif.targetId.id] = []
    }

    notificationsByDocument[notification.notif.targetId.id]!.push(notification)
    subscriberNames.add(notification.accountMeta?.name || 'Subscriber')
  }
  const docNotifs = Object.values(notificationsByDocument)
  const baseNotifsSubject =
    notifications?.length > 1
      ? `${notifications?.length} Notifications`
      : 'Notification'
  let subject = baseNotifsSubject

  const singleDocumentTitle = notifications.every(
    (n) =>
      n.notif.targetMeta?.name === firstNotification.notif.targetMeta?.name,
  )
    ? firstNotification.notif.targetMeta?.name
    : undefined
  if (singleDocumentTitle) {
    subject = `${baseNotifsSubject} on ${singleDocumentTitle}`
  }

  const firstNotificationSummary = getNotificationSummary(
    firstNotification.notif,

    firstNotification.accountMeta,
  )
  const notifSettingsUrl = `${NOTIFY_SERVICE_HOST}/hm/email-notifications?token=${opts.adminToken}`

  const text = `${baseNotifsSubject}

${docNotifs

  .map((notifications) => {
    const docName =
      notifications?.[0]?.notif?.targetMeta?.name || 'Untitled Document'

    const lines = notifications
      .map((notification) => {
        const {notif} = notification

        if (notif.reason === 'site-new-discussion') {
          return `New comment from ${
            notif.authorMeta?.name || 'an account you are subscribed to'
          } on ${notif.url}`
        }

        if (notif.reason === 'site-doc-update') {
          return `New document change from ${
            notif.authorMeta?.name || notif.authorAccountId
          } on ${notif.url}`
        }

        if (notif.reason === 'mention') {
          return `${
            notif.authorMeta?.name || notif.authorAccountId
          } mentioned ${
            notification.accountMeta?.name || 'an account you are subscribed to'
          } on ${notif.url}`
        }

        if (notif.reason === 'reply') {
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

Subscribed by mistake? Click here to unsubscribe or manage notifications: ${notifSettingsUrl}`

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

        {(
          [
            'site-doc-update',
            'site-new-discussion',
            'mention',
            'reply',
          ] as const
        ).map((reason) => {
          const docs = grouped[reason]
          const docEntries = Object.entries(docs)

          if (!docEntries.length) return null

          const totalCount = docEntries.flatMap(([, n]) => n).length

          const sectionTitle = (() => {
            switch (reason) {
              case 'site-new-discussion':
                return `New comment${totalCount === 1 ? '' : 's'}`
              case 'mention':
                return `Mention${totalCount === 1 ? '' : 's'}`
              case 'reply':
                return `Repl${totalCount === 1 ? 'y' : 'ies'}`
              case 'site-doc-update':
              default:
                return 'Document changes'
            }
          })()

          return (
            <React.Fragment key={reason}>
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
                  <React.Fragment key={docId}>
                    <MjmlSection padding="0px 0px 10px">
                      <MjmlColumn>
                        <MjmlText fontSize="14px" color="#888">
                          {reason === 'site-new-discussion' ? (
                            <>
                              {docNotifs.length}{' '}
                              {docNotifs.length === 1 ? 'comment' : 'comments'}{' '}
                              on{' '}
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
                          ) : reason === 'mention' ? (
                            <>
                              {docNotifs.length}{' '}
                              {docNotifs.length === 1 ? 'mention' : 'mentions'}{' '}
                              on{' '}
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
                          ) : reason === 'reply' ? (
                            <>
                              {docNotifs.length}{' '}
                              {totalCount === 1 ? 'reply' : 'replies'} on{' '}
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
                      const key =
                        'comment' in notif && notif.comment
                          ? notif.comment.id
                          : Math.random()
                      return (
                        <React.Fragment key={key}>
                          <EmailContent notification={notif} />
                          <MjmlSection padding="0px">
                            <MjmlColumn>
                              <MjmlText lineHeight="1" fontSize="1px">
                                &nbsp;
                              </MjmlText>
                            </MjmlColumn>
                          </MjmlSection>
                        </React.Fragment>
                      )
                    })}

                    <MjmlSection>
                      <MjmlColumn>
                        <MjmlButton
                          align="left"
                          href={docUrl}
                          backgroundColor="#008060"
                        >
                          {reason === 'site-new-discussion'
                            ? 'View Comment'
                            : reason === 'mention'
                            ? 'View Mention'
                            : reason === 'reply'
                            ? 'View Reply'
                            : 'View Change'}
                        </MjmlButton>
                      </MjmlColumn>
                    </MjmlSection>
                  </React.Fragment>
                )
              })}
            </React.Fragment>
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
      reason: 'site-doc-update'
      authorAccountId: string
      authorMeta: HMMetadata | null
      targetMeta: HMMetadata | null
      targetId: UnpackedHypermediaId
      url: string
      isNewDocument: boolean
    }
  | {
      reason: 'site-new-discussion'
      comment: PlainMessage<Comment>
      parentComments: PlainMessage<Comment>[]
      authorMeta: HMMetadata | null
      targetMeta: HMMetadata | null
      targetId: UnpackedHypermediaId
      url: string
      resolvedNames?: Record<string, string>
    }
  | {
      reason: 'mention'
      authorAccountId: string
      authorMeta: HMMetadata | null
      targetMeta: HMMetadata | null
      subjectAccountId: string
      subjectAccountMeta: HMMetadata | null
      targetId: UnpackedHypermediaId
      url: string
      source: 'comment' | 'document'
      comment?: PlainMessage<Comment>
      resolvedNames?: Record<string, string>
    }
  | {
      reason: 'reply'
      comment: PlainMessage<Comment>
      parentComments: PlainMessage<Comment>[]
      authorMeta: HMMetadata | null
      targetMeta: HMMetadata | null
      targetId: UnpackedHypermediaId
      url: string
      resolvedNames?: Record<string, string>
    }
  | {
      reason: 'user-comment'
      comment: PlainMessage<Comment>
      parentComments: PlainMessage<Comment>[]
      authorMeta: HMMetadata | null
      targetMeta: HMMetadata | null
      targetId: UnpackedHypermediaId
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
  if (notification.reason === 'site-doc-update') {
    return `${notification.authorMeta?.name || 'Someone'} made changes to ${
      notification.targetMeta?.name || 'a document'
    }.`
  }
  if (notification.reason === 'site-new-discussion') {
    return `${
      notification.authorMeta?.name || 'Someone'
    } started a discussion on ${notification.targetMeta?.name || 'a document'}.`
  }
  if (notification.reason === 'mention') {
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
  if (notification.reason === 'reply') {
    return `${notification.authorMeta?.name || 'Someone'} replied to ${
      accountMeta?.name || 'an account you are subscribed to'
    } comment on ${notification.targetMeta?.name || 'a document'}.`
  }
  if (notification.reason === 'user-comment') {
    return `${notification.authorMeta?.name || 'Someone'} commented on ${
      notification.targetMeta?.name || 'a document'
    }.`
  }
  return ''
}

export function renderReactToMjml(email: React.ReactElement): MJMLParseResults {
  return mjml2html(renderToMjml(email))
}
