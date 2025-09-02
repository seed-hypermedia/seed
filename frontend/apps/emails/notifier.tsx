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
  BlockNode,
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
    change: {},
    discussion: {},
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
    subscriberNames.add(notification.accountMeta?.name || 'You')
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
  const notifSettingsUrl = `${SITE_BASE_URL}/hm/email-notifications?token=${opts.adminToken}`

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

        if (
          notif.type === 'reply' ||
          (notif.type === 'mention' && notif.source === 'comment')
        ) {
          return `New ${notif.type} from ${notif.comment.author} on ${notif.url}`
        }

        if (notif.type === 'change') {
          return `New document change from ${
            notif.authorMeta?.name || notif.authorAccountId
          } on ${notif.url}`
        }

        if (notif.type === 'discussion') {
          return `New discussion from ${
            notif.authorMeta?.name || notif.comment.author
          } on ${notif.url}`
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
        <EmailHeader
          avatarUrl={notifications?.[0]?.accountMeta?.icon || ''}
          name={notifications?.[0]?.accountMeta?.name || ''}
        />

        {(['reply', 'mention', 'change', 'discussion'] as const).map((type) => {
          const docs = grouped[type]
          const docEntries = Object.entries(docs)

          if (!docEntries.length) return null

          const totalCount = docEntries.flatMap(([, n]) => n).length

          const sectionTitle =
            type === 'reply'
              ? `You have ${totalCount} new repl${
                  totalCount === 1 ? 'y' : 'ies'
                }!`
              : type === 'mention'
              ? 'You have been mentioned!'
              : type === 'discussion'
              ? `New discussion${
                  totalCount === 1 ? '' : 's'
                } created on your site`
              : 'New document changes!'

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
                          ) : type === 'discussion' ? (
                            <>
                              {docNotifs.length} discussion
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
                          ) : null}
                        </MjmlText>
                      </MjmlColumn>
                    </MjmlSection>

                    {docNotifs.map(({notif}) => {
                      return (
                        <>
                          <EmailContent
                            key={
                              'comment' in notif
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
                          {type === 'reply'
                            ? 'Reply'
                            : type === 'mention'
                            ? 'Open Mention'
                            : type === 'discussion'
                            ? 'Open Discussion'
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

        {/* <NotifSettings url={notifSettingsUrl} /> */}
      </MjmlBody>
      ;
    </Mjml>,
  )

  return {email, subject, text, html: emailHtml, subscriberNames}
}

export type Notification =
  | {
      type: 'mention'
      source: 'comment'
      comment: PlainMessage<Comment>
      authorMeta: HMMetadata | null
      targetMeta: HMMetadata | null
      targetId: UnpackedHypermediaId
      parentComments: PlainMessage<Comment>[]
      url: string
      resolvedNames?: Record<string, string>
    }
  | {
      type: 'mention'
      source: 'change'
      block: BlockNode
      authorAccountId: string
      authorMeta: HMMetadata | null
      targetMeta: HMMetadata | null
      targetId: UnpackedHypermediaId
      url: string
      resolvedNames?: Record<string, string>
    }
  | {
      type: 'reply'
      comment: PlainMessage<Comment>
      authorMeta: HMMetadata | null
      targetMeta: HMMetadata | null
      targetId: UnpackedHypermediaId
      parentComments: PlainMessage<Comment>[]
      url: string
    }
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
      type: 'discussion'
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
  if (notification.type === 'mention') {
    return `${accountMeta?.name || 'You were'} mentioned by ${
      notification.authorMeta?.name
        ? notification.authorMeta.name
        : notification.source === 'comment'
        ? notification.comment.author
        : 'Unknown User'
    }.`
  }
  if (notification.type === 'reply') {
    return `You have a new reply from ${
      notification.authorMeta?.name || notification.comment.author
    }.`
  }
  if (notification.type === 'change') {
    return `${notification.authorMeta?.name || 'Someone'} made a change to ${
      notification.targetMeta?.name || 'your document'
    }.`
  }
  if (notification.type === 'discussion') {
    return `${
      notification.authorMeta?.name || notification.comment.author
    } started a discussion on ${notification.targetMeta?.name || 'your site'}.`
  }
  return ''
}

export function renderReactToMjml(email: React.ReactElement): MJMLParseResults {
  return mjml2html(renderToMjml(email))
}
