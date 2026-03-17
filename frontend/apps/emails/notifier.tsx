import {
  Mjml,
  MjmlAll,
  MjmlAttributes,
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
import {HMBlockNode, HMComment, HMMetadata, UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {getMentionNotificationTitle, getNotificationDocumentName} from '@shm/shared/models/notification-titles'
import {NOTIFY_SERVICE_HOST} from '@shm/shared/constants'
import mjml2html from 'mjml'
import {MJMLParseResults} from 'mjml-core'
import React from 'react'
import {EmailContent, QuotedContent} from './components/EmailContent'
import {EmailFooter} from './components/EmailFooter'
import {EmailHeader} from './components/EmailHeader'

type GroupedNotifications = Record<Notification['reason'], Record<string, FullNotification[]>>

function getNotifyServiceHost() {
  return (NOTIFY_SERVICE_HOST || 'https://hyper.media').replace(/\/$/, '')
}

/** System font stack used across all email templates. */
const SYSTEM_FONT_FAMILY =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif"

/** Standard MJML <head> attributes applied to all new-style emails. */
function EmailHeadDefaults({children}: {children?: React.ReactNode}) {
  return (
    <MjmlHead>
      <MjmlAttributes>
        <MjmlAll fontFamily={SYSTEM_FONT_FAMILY} />
      </MjmlAttributes>
      {children}
    </MjmlHead>
  )
}

// ---------------------------------------------------------------------------
// New individual email templates (match design mockups)
// ---------------------------------------------------------------------------

export type CreateMentionEmailInput = {
  authorName: string
  subjectName: string
  documentName: string
  sectionName?: string
  commentBlocks: HMBlockNode[]
  actionUrl: string
  unsubscribeUrl: string
  resolvedNames?: Record<string, string>
}

/** Build an individual "mention" notification email matching the design mockup. */
export function createMentionEmail(input: CreateMentionEmailInput) {
  const subject = `${input.authorName} mentioned ${input.subjectName} in a comment on ${input.documentName}`

  const text = `${subject}
${input.sectionName ? `Section: ${input.sectionName}\n` : ''}
View comment: ${input.actionUrl}

Manage notifications: ${input.unsubscribeUrl}`

  const {html} = renderReactToMjml(
    <Mjml>
      <EmailHeadDefaults>
        <MjmlTitle>{subject}</MjmlTitle>
        <MjmlPreview>{subject}</MjmlPreview>
      </EmailHeadDefaults>
      <MjmlBody width={500} backgroundColor="#ffffff">
        <EmailHeader />

        <MjmlSection padding="24px 24px 0">
          <MjmlColumn>
            <MjmlText fontSize="18px" fontWeight="bold" lineHeight="1.4">
              {input.authorName} mentioned {input.subjectName} in a comment on <em>{input.documentName}</em>
            </MjmlText>
          </MjmlColumn>
        </MjmlSection>

        {input.sectionName ? (
          <MjmlSection padding="8px 24px 0">
            <MjmlColumn>
              <MjmlText fontSize="14px" color="#6b7280">
                Section: {input.sectionName}
              </MjmlText>
            </MjmlColumn>
          </MjmlSection>
        ) : null}

        {input.commentBlocks.length > 0 ? (
          <QuotedContent blocks={input.commentBlocks} resolvedNames={input.resolvedNames} />
        ) : null}

        <MjmlSection padding="0 24px 24px">
          <MjmlColumn>
            <MjmlButton
              href={input.actionUrl}
              backgroundColor="#068f7b"
              color="#ffffff"
              borderRadius="6px"
              fontSize="14px"
              fontWeight="600"
              innerPadding="12px 24px"
              align="center"
            >
              View comment
            </MjmlButton>
          </MjmlColumn>
        </MjmlSection>

        <EmailFooter unsubscribeUrl={input.unsubscribeUrl} />
      </MjmlBody>
    </Mjml>,
  )

  return {subject, text, html}
}

export type CreateReplyEmailInput = {
  authorName: string
  documentName: string
  sectionName?: string
  commentBlocks: HMBlockNode[]
  actionUrl: string
  unsubscribeUrl: string
  resolvedNames?: Record<string, string>
}

/** Build an individual "reply" notification email matching the design mockup. */
export function createReplyEmail(input: CreateReplyEmailInput) {
  const subject = `${input.authorName} replied to your comment in ${input.documentName}`

  const text = `${subject}
${input.sectionName ? `Section: ${input.sectionName}\n` : ''}
Continue the discussion: ${input.actionUrl}

Manage notifications: ${input.unsubscribeUrl}`

  const {html} = renderReactToMjml(
    <Mjml>
      <EmailHeadDefaults>
        <MjmlTitle>{subject}</MjmlTitle>
        <MjmlPreview>{subject}</MjmlPreview>
      </EmailHeadDefaults>
      <MjmlBody width={500} backgroundColor="#ffffff">
        <EmailHeader />

        <MjmlSection padding="24px 24px 0">
          <MjmlColumn>
            <MjmlText fontSize="18px" fontWeight="bold" lineHeight="1.4">
              {input.authorName} replied to your comment in <em>{input.documentName}</em>
            </MjmlText>
          </MjmlColumn>
        </MjmlSection>

        {input.sectionName ? (
          <MjmlSection padding="8px 24px 0">
            <MjmlColumn>
              <MjmlText fontSize="14px" color="#6b7280">
                Section: {input.sectionName}
              </MjmlText>
            </MjmlColumn>
          </MjmlSection>
        ) : null}

        {input.commentBlocks.length > 0 ? (
          <QuotedContent blocks={input.commentBlocks} resolvedNames={input.resolvedNames} />
        ) : null}

        <MjmlSection padding="0 24px 24px">
          <MjmlColumn>
            <MjmlButton
              href={input.actionUrl}
              backgroundColor="#068f7b"
              color="#ffffff"
              borderRadius="6px"
              fontSize="14px"
              fontWeight="600"
              innerPadding="12px 24px"
              align="center"
            >
              Continue the discussion
            </MjmlButton>
          </MjmlColumn>
        </MjmlSection>

        <EmailFooter unsubscribeUrl={input.unsubscribeUrl} />
      </MjmlBody>
    </Mjml>,
  )

  return {subject, text, html}
}

export type CreateDocUpdateEmailInput = {
  authorName: string
  documentName: string
  sectionName?: string
  changes?: string[]
  actionUrl: string
  unsubscribeUrl: string
}

/** Build an individual "document update" notification email matching the design mockup. */
export function createDocUpdateEmail(input: CreateDocUpdateEmailInput) {
  const subject = `${input.documentName} was updated by ${input.authorName}`

  const changesList = input.changes?.length
    ? input.changes.map((c) => `  - ${c}`).join('\n')
    : ''

  const text = `${subject}
${input.sectionName ? `Section: ${input.sectionName}\n` : ''}${changesList ? `What changed:\n${changesList}\n` : ''}
Review changes: ${input.actionUrl}

Manage notifications: ${input.unsubscribeUrl}`

  const {html} = renderReactToMjml(
    <Mjml>
      <EmailHeadDefaults>
        <MjmlTitle>{subject}</MjmlTitle>
        <MjmlPreview>{subject}</MjmlPreview>
      </EmailHeadDefaults>
      <MjmlBody width={500} backgroundColor="#ffffff">
        <EmailHeader />

        <MjmlSection padding="24px 24px 0">
          <MjmlColumn>
            <MjmlText fontSize="18px" fontWeight="bold" lineHeight="1.4">
              <em>{input.documentName}</em> was updated by {input.authorName}
            </MjmlText>
          </MjmlColumn>
        </MjmlSection>

        {input.sectionName ? (
          <MjmlSection padding="8px 24px 0">
            <MjmlColumn>
              <MjmlText fontSize="14px" color="#6b7280">
                Section: {input.sectionName}
              </MjmlText>
            </MjmlColumn>
          </MjmlSection>
        ) : null}

        {input.changes?.length ? (
          <MjmlSection padding="12px 24px 16px">
            <MjmlColumn backgroundColor="#f3f4f6" borderRadius="8px" padding="12px 16px">
              <MjmlText fontSize="14px" fontWeight="bold" paddingBottom="4px">
                What changed:
              </MjmlText>
              {input.changes.map((change, i) => (
                <MjmlText key={i} fontSize="14px" paddingBottom="2px">
                  {'• '}{change}
                </MjmlText>
              ))}
            </MjmlColumn>
          </MjmlSection>
        ) : null}

        <MjmlSection padding="0 24px 24px">
          <MjmlColumn>
            <MjmlButton
              href={input.actionUrl}
              backgroundColor="#068f7b"
              color="#ffffff"
              borderRadius="6px"
              fontSize="14px"
              fontWeight="600"
              innerPadding="12px 24px"
              align="center"
            >
              Review changes
            </MjmlButton>
          </MjmlColumn>
        </MjmlSection>

        <EmailFooter unsubscribeUrl={input.unsubscribeUrl} />
      </MjmlBody>
    </Mjml>,
  )

  return {subject, text, html}
}

export type CreateCommentEmailInput = {
  authorName: string
  documentName: string
  sectionName?: string
  commentBlocks: HMBlockNode[]
  actionUrl: string
  unsubscribeUrl: string
  resolvedNames?: Record<string, string>
}

/** Build an individual "new comment" notification email matching the design mockup. */
export function createCommentEmail(input: CreateCommentEmailInput) {
  const subject = `${input.authorName} left a comment on your document ${input.documentName}`

  const text = `${subject}
${input.sectionName ? `Section: ${input.sectionName}\n` : ''}
View comment: ${input.actionUrl}

Manage notifications: ${input.unsubscribeUrl}`

  const {html} = renderReactToMjml(
    <Mjml>
      <EmailHeadDefaults>
        <MjmlTitle>{subject}</MjmlTitle>
        <MjmlPreview>{subject}</MjmlPreview>
      </EmailHeadDefaults>
      <MjmlBody width={500} backgroundColor="#ffffff">
        <EmailHeader />

        <MjmlSection padding="24px 24px 0">
          <MjmlColumn>
            <MjmlText fontSize="18px" fontWeight="bold" lineHeight="1.4">
              {input.authorName} left a comment on your document <em>{input.documentName}</em>
            </MjmlText>
          </MjmlColumn>
        </MjmlSection>

        {input.sectionName ? (
          <MjmlSection padding="8px 24px 0">
            <MjmlColumn>
              <MjmlText fontSize="14px" color="#6b7280">
                Section: {input.sectionName}
              </MjmlText>
            </MjmlColumn>
          </MjmlSection>
        ) : null}

        {input.commentBlocks.length > 0 ? (
          <QuotedContent blocks={input.commentBlocks} resolvedNames={input.resolvedNames} />
        ) : null}

        <MjmlSection padding="0 24px 24px">
          <MjmlColumn>
            <MjmlButton
              href={input.actionUrl}
              backgroundColor="#068f7b"
              color="#ffffff"
              borderRadius="6px"
              fontSize="14px"
              fontWeight="600"
              innerPadding="12px 24px"
              align="center"
            >
              View comment
            </MjmlButton>
          </MjmlColumn>
        </MjmlSection>

        <EmailFooter unsubscribeUrl={input.unsubscribeUrl} />
      </MjmlBody>
    </Mjml>,
  )

  return {subject, text, html}
}

function getNotificationActionUrl(notification: Notification) {
  if (
    (notification.reason === 'mention' || notification.reason === 'reply' || notification.reason === 'discussion') &&
    notification.actionUrl
  ) {
    return notification.actionUrl
  }
  return notification.url
}

export function createNotificationVerificationEmail(input: {verificationUrl: string}) {
  const subject = 'Verify your email for Seed notifications'
  const text = `Verify your email for Seed notifications

Click the link below to verify this address:
${input.verificationUrl}

This link expires in 2 hours.

If you did not request notification emails, you can ignore this message.`

  const {html: emailHtml} = renderReactToMjml(
    <Mjml>
      <EmailHeadDefaults>
        <MjmlTitle>{subject}</MjmlTitle>
        <MjmlPreview>Confirm your email to receive mention and reply notifications</MjmlPreview>
      </EmailHeadDefaults>
      <MjmlBody width={500} backgroundColor="#ffffff">
        <EmailHeader />
        <MjmlSection padding="24px">
          <MjmlColumn>
            <MjmlText fontSize="20px" fontWeight="bold">
              Verify your email
            </MjmlText>
            <MjmlText fontSize="15px" lineHeight="1.6" paddingTop="8px">
              Confirm this email address to enable notification emails for mentions and replies.
            </MjmlText>
            <MjmlButton
              href={input.verificationUrl}
              backgroundColor="#068f7b"
              color="#ffffff"
              borderRadius="6px"
              fontSize="14px"
              fontWeight="600"
              innerPadding="12px 24px"
              align="center"
              padding="16px 0px 0px"
            >
              Verify Email
            </MjmlButton>
            <MjmlText fontSize="13px" color="#6b7280" lineHeight="1.5" padding="12px 0px 0px">
              This link expires in 2 hours.
            </MjmlText>
          </MjmlColumn>
        </MjmlSection>
        <EmailFooter />
      </MjmlBody>
    </Mjml>,
  )

  return {
    subject,
    text,
    html: emailHtml,
  }
}

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
    discussion: {},
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
  const baseNotifsSubject = notifications?.length > 1 ? `${notifications?.length} Notifications` : 'Notification'
  let subject = baseNotifsSubject

  const singleDocumentTitle = notifications.every(
    (n) => n.notif.targetMeta?.name === firstNotification.notif.targetMeta?.name,
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
  const notifSettingsUrl = `${getNotifyServiceHost()}/hm/email-notifications?token=${opts.adminToken}`

  const text = `${baseNotifsSubject}

${docNotifs

  .map((notifications) => {
    const docName = notifications?.[0]?.notif?.targetMeta?.name || 'Untitled Document'

    const lines = notifications
      .map((notification) => {
        const {notif} = notification

        if (notif.reason === 'site-new-discussion') {
          return `New comment from ${
            notif.authorMeta?.name || 'an account you are subscribed to'
          } on ${getNotificationActionUrl(notif)}`
        }

        if (notif.reason === 'site-doc-update') {
          return `New document change from ${
            notif.authorMeta?.name || notif.authorAccountId
          } on ${getNotificationActionUrl(notif)}`
        }

        if (notif.reason === 'mention') {
          return `${notif.authorMeta?.name || notif.authorAccountId} mentioned ${
            notification.accountMeta?.name || 'an account you are subscribed to'
          } on ${getNotificationActionUrl(notif)}`
        }

        if (notif.reason === 'reply') {
          return `${notif.authorMeta?.name || notif.comment.author} replied to ${
            notification.accountMeta?.name || 'an account you are subscribed to'
          } comment on ${getNotificationActionUrl(notif)}`
        }

        if (notif.reason === 'discussion') {
          return `${notif.authorMeta?.name || notif.comment.author} started a discussion on ${getNotificationActionUrl(
            notif,
          )}`
        }

        return ''
      })
      .join('\n')

    return `${docName}\n\n${lines}\n\n${getNotificationActionUrl(notifications?.[0]?.notif!)}`
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
          {notifications.length > 1 ? `${firstNotificationSummary} and more` : firstNotificationSummary}
        </MjmlPreview>
      </MjmlHead>
      <MjmlBody width={500}>
        <EmailHeader />

        {(['site-doc-update', 'site-new-discussion', 'discussion', 'mention', 'reply'] as const).map((reason) => {
          const docs = grouped[reason]
          const docEntries = Object.entries(docs)

          if (!docEntries.length) return null

          const totalCount = docEntries.flatMap(([, n]) => n).length

          const sectionTitle = (() => {
            switch (reason) {
              case 'site-new-discussion':
                return `New comment${totalCount === 1 ? '' : 's'}`
              case 'discussion':
                return `New discussion${totalCount === 1 ? '' : 's'}`
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
                const targetName = docNotifs?.[0]?.notif?.targetMeta?.name || 'Untitled Document'
                const docUrl = getNotificationActionUrl(docNotifs?.[0]?.notif!)

                return (
                  <React.Fragment key={docId}>
                    <MjmlSection padding="0px 0px 10px">
                      <MjmlColumn>
                        <MjmlText fontSize="14px" color="#888">
                          {reason === 'site-new-discussion' || reason === 'discussion' ? (
                            <>
                              {docNotifs.length} {docNotifs.length === 1 ? 'discussion' : 'discussions'} on{' '}
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
                              {docNotifs.length} {docNotifs.length === 1 ? 'mention' : 'mentions'} on{' '}
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
                              {docNotifs.length} {totalCount === 1 ? 'reply' : 'replies'} on{' '}
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
                      const key = 'comment' in notif && notif.comment ? notif.comment.id : Math.random()
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
                        <MjmlButton align="left" href={docUrl} backgroundColor="#008060">
                          {reason === 'site-new-discussion' || reason === 'discussion'
                            ? 'View Discussion'
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

        <EmailFooter unsubscribeUrl={notifSettingsUrl} />
      </MjmlBody>
      ;
    </Mjml>,
  )

  return {email, subject, text, html: emailHtml, subscriberNames}
}

type ImmediateReason = 'mention' | 'reply' | 'discussion'
type ImmediateNotification = FullNotification & {
  notif: Extract<Notification, {reason: ImmediateReason}>
}

export async function createDesktopNotificationsEmail(
  email: string,
  opts: {adminToken: string},
  notifications: FullNotification[],
) {
  const immediate = notifications.filter(
    (notification): notification is ImmediateNotification =>
      notification.notif.reason === 'mention' ||
      notification.notif.reason === 'reply' ||
      notification.notif.reason === 'discussion',
  )
  if (!immediate.length) return

  const sorted = [...immediate].sort((a, b) => {
    return (b.notif.eventAtMs || 0) - (a.notif.eventAtMs || 0)
  })

  const subscriberNames: Set<string> = new Set()
  for (const notification of sorted) {
    subscriberNames.add(notification.accountMeta?.name || 'Subscriber')
  }

  const first = sorted[0]!
  const firstText = getDesktopNotificationText(first)
  const subject = sorted.length === 1 ? firstText : `${sorted.length} new notifications`
  const preview = sorted.length === 1 ? firstText : `${firstText} and ${sorted.length - 1} more`

  const notifSettingsUrl = `${getNotifyServiceHost()}/hm/email-notifications?token=${opts.adminToken}`

  const textLines = sorted
    .map((notification) => {
      const line = getDesktopNotificationText(notification)
      const actionUrl = getNotificationActionUrl(notification.notif)
      return `${line}\n${actionUrl}`
    })
    .join('\n\n')

  const text = `${subject}

${textLines}

Manage notification emails: ${notifSettingsUrl}`

  const {html: emailHtml} = renderReactToMjml(
    <Mjml>
      <MjmlHead>
        <MjmlTitle>{subject}</MjmlTitle>
        <MjmlPreview>{preview}</MjmlPreview>
      </MjmlHead>
      <MjmlBody width={500}>
        <EmailHeader />

        <MjmlSection padding="8px 0px">
          <MjmlColumn>
            <MjmlText fontSize="20px" fontWeight="bold">
              Notifications
            </MjmlText>
          </MjmlColumn>
        </MjmlSection>

        {sorted.map((notification) => {
          const actionUrl = getNotificationActionUrl(notification.notif)
          const actionLabel =
            notification.notif.reason === 'mention'
              ? 'Open Mention'
              : notification.notif.reason === 'discussion'
              ? 'Open Discussion'
              : 'Open Reply'
          const timeLabel = formatDesktopNotificationTime(notification.notif.eventAtMs)
          const key =
            notification.notif.reason === 'mention'
              ? `${notification.accountId}:${notification.notif.eventId || notification.notif.url}`
              : `${notification.accountId}:${notification.notif.comment?.id || notification.notif.url}`

          return (
            <MjmlSection key={key} padding="0px 0px 12px">
              <MjmlColumn backgroundColor="#f6f8f8" border="1px solid #e6ebeb" borderRadius="8px" padding="12px 14px">
                <MjmlText fontSize="15px" fontWeight="bold" padding="0px 0px 6px">
                  {getDesktopNotificationText(notification)}
                </MjmlText>
                {timeLabel ? (
                  <MjmlText fontSize="12px" color="#6b7280" padding="0px 0px 8px">
                    {timeLabel}
                  </MjmlText>
                ) : null}
                <MjmlButton align="left" href={actionUrl} backgroundColor="#0d9488" padding="4px 0px 0px">
                  {actionLabel}
                </MjmlButton>
              </MjmlColumn>
            </MjmlSection>
          )
        })}

        <EmailFooter unsubscribeUrl={notifSettingsUrl} />
      </MjmlBody>
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
      comment: HMComment
      parentComments: HMComment[]
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
      actionUrl?: string
      eventId?: string
      eventAtMs?: number
      source: 'comment' | 'document'
      comment?: HMComment
      resolvedNames?: Record<string, string>
    }
  | {
      reason: 'reply'
      comment: HMComment
      parentComments: HMComment[]
      authorMeta: HMMetadata | null
      targetMeta: HMMetadata | null
      targetId: UnpackedHypermediaId
      url: string
      actionUrl?: string
      eventId?: string
      eventAtMs?: number
      resolvedNames?: Record<string, string>
    }
  | {
      reason: 'discussion'
      comment: HMComment
      parentComments: HMComment[]
      authorMeta: HMMetadata | null
      targetMeta: HMMetadata | null
      targetId: UnpackedHypermediaId
      url: string
      actionUrl?: string
      eventId?: string
      eventAtMs?: number
    }
  | {
      reason: 'user-comment'
      comment: HMComment
      parentComments: HMComment[]
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

function formatDesktopNotificationTime(eventAtMs?: number) {
  if (!eventAtMs) return null
  try {
    return new Date(eventAtMs).toLocaleString('en-US', {
      dateStyle: 'medium',
      timeStyle: 'short',
    })
  } catch {
    return null
  }
}

function getDesktopNotificationText(notification: ImmediateNotification) {
  const notif = notification.notif
  const actor = notif.authorMeta?.name || 'Someone'
  const subjectName = notification.accountMeta?.name
  const subject = subjectName || 'you'

  if (notif.reason === 'mention') {
    const targetName = getNotificationDocumentName({
      targetMeta: notif.targetMeta,
      targetId: notif.targetId,
    })
    return getMentionNotificationTitle({
      actorName: actor,
      subjectName: subject,
      documentName: targetName,
    })
  }

  if (notif.reason === 'discussion') {
    const targetName = notif.targetMeta?.name
    return `${actor} started a discussion${targetName ? ` on ${targetName}` : ''}`
  }

  const targetName = notif.targetMeta?.name
  const commentOwner = subjectName ? `${subjectName}'s` : 'your'
  return `${actor} replied to ${commentOwner} comment${targetName ? ` in ${targetName}` : ''}`
}

function getNotificationSummary(notification: Notification, accountMeta: HMMetadata | null): string {
  if (notification.reason === 'site-doc-update') {
    return `${notification.authorMeta?.name || 'Someone'} made changes to ${
      notification.targetMeta?.name || 'a document'
    }.`
  }
  if (notification.reason === 'site-new-discussion') {
    return `${notification.authorMeta?.name || 'Someone'} started a discussion on ${
      notification.targetMeta?.name || 'a document'
    }.`
  }
  if (notification.reason === 'discussion') {
    return `${notification.authorMeta?.name || 'Someone'} started a discussion on ${
      notification.targetMeta?.name || 'a document'
    }.`
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
