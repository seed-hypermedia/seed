import {
  Mjml,
  MjmlAll,
  MjmlAttributes,
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
import {EmailBody, EmailButton, EmailButtonSection, emailTheme} from './components/EmailLayout'

type GroupedNotifications = Record<Notification['reason'], Record<string, FullNotification[]>>

function getNotifyServiceHost() {
  return (NOTIFY_SERVICE_HOST || 'https://hyper.media').replace(/\/$/, '')
}

/** System font stack used across all email templates. */
const SYSTEM_FONT_FAMILY = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif"

/** Standard MJML <head> attributes applied to all new-style emails. */
export function EmailHeadDefaults({children}: {children?: React.ReactNode}) {
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
  siteUrl?: string
  resolvedNames?: Record<string, string>
}

/** Build an individual "mention" notification email matching the design mockup. */
export async function createMentionEmail(input: CreateMentionEmailInput) {
  const subject = `${input.authorName} mentioned ${input.subjectName} in a comment on ${input.documentName}`

  const text = `${subject}
${input.sectionName ? `Section: ${input.sectionName}\n` : ''}
View comment: ${input.actionUrl}

Manage notifications: ${input.unsubscribeUrl}`

  const {html} = await renderReactToMjml(
    <Mjml>
      <EmailHeadDefaults>
        <MjmlTitle>{subject}</MjmlTitle>
        <MjmlPreview>{subject}</MjmlPreview>
      </EmailHeadDefaults>
      <EmailBody>
        <EmailHeader />

        <MjmlSection padding={`24px ${emailTheme.gutter} 0`}>
          <MjmlColumn>
            <MjmlText fontSize="24px" fontWeight="bold" lineHeight="1.25" color={emailTheme.heading} padding="0">
              {input.authorName} mentioned {input.subjectName} in a comment on <em>{input.documentName}</em>
            </MjmlText>
          </MjmlColumn>
        </MjmlSection>

        {input.sectionName ? (
          <MjmlSection padding={`8px ${emailTheme.gutter} 0`}>
            <MjmlColumn>
              <MjmlText fontSize="14px" color={emailTheme.muted} padding="0">
                Section: {input.sectionName}
              </MjmlText>
            </MjmlColumn>
          </MjmlSection>
        ) : null}

        {input.commentBlocks.length > 0 ? (
          <QuotedContent blocks={input.commentBlocks} resolvedNames={input.resolvedNames} variant="border" />
        ) : null}

        <EmailButtonSection href={input.actionUrl}>See comment</EmailButtonSection>

        <EmailFooter
          siteUrl={input.siteUrl}
          unsubscribeUrl={input.unsubscribeUrl}
          manageNotificationsUrl={input.unsubscribeUrl}
        />
      </EmailBody>
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
  siteUrl?: string
  resolvedNames?: Record<string, string>
}

/** Build an individual "reply" notification email matching the design mockup. */
export async function createReplyEmail(input: CreateReplyEmailInput) {
  const subject = `${input.authorName} replied to your comment in ${input.documentName}`

  const text = `${subject}
${input.sectionName ? `Section: ${input.sectionName}\n` : ''}
Continue the discussion: ${input.actionUrl}

Manage notifications: ${input.unsubscribeUrl}`

  const {html} = await renderReactToMjml(
    <Mjml>
      <EmailHeadDefaults>
        <MjmlTitle>{subject}</MjmlTitle>
        <MjmlPreview>{subject}</MjmlPreview>
      </EmailHeadDefaults>
      <EmailBody>
        <EmailHeader />

        <MjmlSection padding={`24px ${emailTheme.gutter} 0`}>
          <MjmlColumn>
            <MjmlText fontSize="24px" fontWeight="bold" lineHeight="1.25" color={emailTheme.heading} padding="0">
              {input.authorName} replied to your comment in <em>{input.documentName}</em>
            </MjmlText>
          </MjmlColumn>
        </MjmlSection>

        {input.sectionName ? (
          <MjmlSection padding={`8px ${emailTheme.gutter} 0`}>
            <MjmlColumn>
              <MjmlText fontSize="14px" color={emailTheme.muted} padding="0">
                Section: {input.sectionName}
              </MjmlText>
            </MjmlColumn>
          </MjmlSection>
        ) : null}

        {input.commentBlocks.length > 0 ? (
          <QuotedContent blocks={input.commentBlocks} resolvedNames={input.resolvedNames} />
        ) : null}

        <EmailButtonSection href={input.actionUrl}>Continue the discussion</EmailButtonSection>

        <EmailFooter
          siteUrl={input.siteUrl}
          unsubscribeUrl={input.unsubscribeUrl}
          manageNotificationsUrl={input.unsubscribeUrl}
        />
      </EmailBody>
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
  siteUrl?: string
}

/** Build an individual "document update" notification email matching the design mockup. */
export async function createDocUpdateEmail(input: CreateDocUpdateEmailInput) {
  const subject = `${input.documentName} was updated by ${input.authorName}`

  const changesList = input.changes?.length ? input.changes.map((c) => `  - ${c}`).join('\n') : ''

  const text = `${subject}
${input.sectionName ? `Section: ${input.sectionName}\n` : ''}${changesList ? `What changed:\n${changesList}\n` : ''}
Review changes: ${input.actionUrl}

Manage notifications: ${input.unsubscribeUrl}`

  const {html} = await renderReactToMjml(
    <Mjml>
      <EmailHeadDefaults>
        <MjmlTitle>{subject}</MjmlTitle>
        <MjmlPreview>{subject}</MjmlPreview>
      </EmailHeadDefaults>
      <EmailBody>
        <EmailHeader />

        <MjmlSection padding={`24px ${emailTheme.gutter} 0`}>
          <MjmlColumn>
            <MjmlText fontSize="24px" fontWeight="bold" lineHeight="1.25" color={emailTheme.heading} padding="0">
              <em>{input.documentName}</em> was updated by {input.authorName}
            </MjmlText>
          </MjmlColumn>
        </MjmlSection>

        {input.sectionName ? (
          <MjmlSection padding={`8px ${emailTheme.gutter} 0`}>
            <MjmlColumn>
              <MjmlText fontSize="14px" color={emailTheme.muted} padding="0">
                Section: {input.sectionName}
              </MjmlText>
            </MjmlColumn>
          </MjmlSection>
        ) : null}

        {input.changes?.length ? (
          <MjmlSection padding={`12px ${emailTheme.gutter} 16px`}>
            <MjmlColumn backgroundColor={emailTheme.quoteBackground} padding="12px 16px">
              <MjmlText fontSize="14px" fontWeight="bold" paddingBottom="4px">
                What changed:
              </MjmlText>
              {input.changes.map((change, i) => (
                <MjmlText key={i} fontSize="14px" paddingBottom="2px">
                  {'• '}
                  {change}
                </MjmlText>
              ))}
            </MjmlColumn>
          </MjmlSection>
        ) : null}

        <EmailButtonSection href={input.actionUrl}>Review changes</EmailButtonSection>

        <EmailFooter
          siteUrl={input.siteUrl}
          unsubscribeUrl={input.unsubscribeUrl}
          manageNotificationsUrl={input.unsubscribeUrl}
        />
      </EmailBody>
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
  siteUrl?: string
  resolvedNames?: Record<string, string>
}

/** Build an individual "new comment" notification email matching the design mockup. */
export async function createCommentEmail(input: CreateCommentEmailInput) {
  const subject = `${input.authorName} left a comment on your document ${input.documentName}`

  const text = `${subject}
${input.sectionName ? `Section: ${input.sectionName}\n` : ''}
View comment: ${input.actionUrl}

Manage notifications: ${input.unsubscribeUrl}`

  const {html} = await renderReactToMjml(
    <Mjml>
      <EmailHeadDefaults>
        <MjmlTitle>{subject}</MjmlTitle>
        <MjmlPreview>{subject}</MjmlPreview>
      </EmailHeadDefaults>
      <EmailBody>
        <EmailHeader />

        <MjmlSection padding={`24px ${emailTheme.gutter} 0`}>
          <MjmlColumn>
            <MjmlText fontSize="24px" fontWeight="bold" lineHeight="1.25" color={emailTheme.heading} padding="0">
              {input.authorName} left a comment on your document{' '}
              <strong>
                <em>{input.documentName}</em>
              </strong>
            </MjmlText>
          </MjmlColumn>
        </MjmlSection>

        {input.sectionName ? (
          <MjmlSection padding={`8px ${emailTheme.gutter} 0`}>
            <MjmlColumn>
              <MjmlText fontSize="14px" color={emailTheme.muted} padding="0">
                Section: {input.sectionName}
              </MjmlText>
            </MjmlColumn>
          </MjmlSection>
        ) : null}

        {input.commentBlocks.length > 0 ? (
          <QuotedContent blocks={input.commentBlocks} resolvedNames={input.resolvedNames} />
        ) : null}

        <EmailButtonSection href={input.actionUrl}>See comment</EmailButtonSection>

        <EmailFooter
          siteUrl={input.siteUrl}
          unsubscribeUrl={input.unsubscribeUrl}
          manageNotificationsUrl={input.unsubscribeUrl}
        />
      </EmailBody>
    </Mjml>,
  )

  return {subject, text, html}
}

export type CreateDiscussionEmailInput = {
  authorName: string
  documentName: string
  commentBlocks: HMBlockNode[]
  actionUrl: string
  unsubscribeUrl: string
  siteUrl?: string
  resolvedNames?: Record<string, string>
}

/** Build an individual "new discussion" notification email. */
export async function createDiscussionEmail(input: CreateDiscussionEmailInput) {
  const subject = `A new discussion in ${input.documentName} was created by ${input.authorName}`

  const text = `${subject}

See discussion: ${input.actionUrl}

Manage notifications: ${input.unsubscribeUrl}`

  const {html} = await renderReactToMjml(
    <Mjml>
      <EmailHeadDefaults>
        <MjmlTitle>{subject}</MjmlTitle>
        <MjmlPreview>{subject}</MjmlPreview>
      </EmailHeadDefaults>
      <EmailBody>
        <EmailHeader />

        <MjmlSection padding={`24px ${emailTheme.gutter} 0`}>
          <MjmlColumn>
            <MjmlText fontSize="24px" fontWeight="bold" lineHeight="1.25" color={emailTheme.heading} padding="0">
              A new discussion in <em>{input.documentName}</em> was created by {input.authorName}
            </MjmlText>
          </MjmlColumn>
        </MjmlSection>

        {input.commentBlocks.length > 0 ? (
          <QuotedContent blocks={input.commentBlocks} resolvedNames={input.resolvedNames} />
        ) : null}

        <EmailButtonSection href={input.actionUrl}>See discussion</EmailButtonSection>

        <EmailFooter
          siteUrl={input.siteUrl}
          unsubscribeUrl={input.unsubscribeUrl}
          manageNotificationsUrl={input.unsubscribeUrl}
        />
      </EmailBody>
    </Mjml>,
  )

  return {subject, text, html}
}

export type CreateWelcomeEmailInput = {
  recipientName?: string
  siteName: string
  siteUrl: string
}

/** Build the "Welcome to the community" email for new users. */
export async function createWelcomeEmail(input: CreateWelcomeEmailInput) {
  const subject = "You're in. Welcome to the community."
  const greeting = input.recipientName ? `Hi ${input.recipientName},` : 'Hi there,'
  const text = `${subject}

${greeting}

We're thrilled to have you as part of Seed Hypermedia. You can now participate, comment, follow authors, bookmark content and much more!

Go to ${input.siteName}: ${input.siteUrl}`

  const {html} = await renderReactToMjml(
    <Mjml>
      <EmailHeadDefaults>
        <MjmlTitle>{subject}</MjmlTitle>
        <MjmlPreview>Welcome to Seed Hypermedia — you're all set!</MjmlPreview>
      </EmailHeadDefaults>
      <EmailBody>
        <EmailHeader />

        <MjmlSection padding={`24px ${emailTheme.gutter} 0`}>
          <MjmlColumn>
            <MjmlText fontSize="24px" fontWeight="bold" lineHeight="1.25" color={emailTheme.heading} padding="0 0 16px">
              You're in. Welcome to the community.
            </MjmlText>
            <MjmlText fontSize="16px" lineHeight="1.5" color={emailTheme.body} padding="0 0 4px">
              {greeting}
            </MjmlText>
            <MjmlText fontSize="16px" lineHeight="1.5" color={emailTheme.body} padding="0 0 16px">
              We're thrilled to have you as part of Seed Hypermedia. You can now participate, comment, follow authors,
              bookmark content and much more!
            </MjmlText>
            <EmailButton href={input.siteUrl} padding="0 0 24px">
              Go to {input.siteName}
            </EmailButton>
          </MjmlColumn>
        </MjmlSection>

        <EmailFooter />
      </EmailBody>
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

export async function createNotificationVerificationEmail(input: {verificationUrl: string; recipientName?: string}) {
  const subject = 'Confirm your email address'
  const greeting = input.recipientName ? `Hi ${input.recipientName},` : 'Hi there,'
  const text = `${subject}

${greeting}

Thanks for signing up for Seed Hypermedia. To complete your registration and access the community, please verify your email address.

${input.verificationUrl}

This link expires in 2 hours. If you didn't create an account, you can safely ignore this.`

  const {html: emailHtml} = await renderReactToMjml(
    <Mjml>
      <EmailHeadDefaults>
        <MjmlTitle>{subject}</MjmlTitle>
        <MjmlPreview>Confirm your email to complete your registration</MjmlPreview>
      </EmailHeadDefaults>
      <EmailBody>
        <EmailHeader />
        <MjmlSection padding={`24px ${emailTheme.gutter} 0`}>
          <MjmlColumn>
            <MjmlText fontSize="24px" fontWeight="bold" lineHeight="1.25" color={emailTheme.heading} padding="0 0 16px">
              Confirm your email address
            </MjmlText>
            <MjmlText fontSize="16px" lineHeight="1.5" color={emailTheme.body} padding="0 0 4px">
              {greeting}
            </MjmlText>
            <MjmlText fontSize="16px" lineHeight="1.5" color={emailTheme.body} padding="0 0 16px">
              Thanks for signing up for Seed Hypermedia. To complete your registration and access the community, please
              verify your email address.
            </MjmlText>
            <EmailButton href={input.verificationUrl} padding="0 0 16px">
              Verify email address
            </EmailButton>
            <MjmlText fontSize="13px" color={emailTheme.muted} lineHeight="1.5" padding="0 0 24px">
              This link expires in 2 hours. If you didn't create an account, you can safely ignore this.
            </MjmlText>
          </MjmlColumn>
        </MjmlSection>
        <EmailFooter />
      </EmailBody>
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
  const batchSiteUrl = extractOrigin(firstNotification.notif.url)

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

  const {html: emailHtml} = await renderReactToMjml(
    <Mjml>
      <EmailHeadDefaults>
        <MjmlTitle>{subject}</MjmlTitle>
        <MjmlPreview>
          {notifications.length > 1 ? `${firstNotificationSummary} and more` : firstNotificationSummary}
        </MjmlPreview>
      </EmailHeadDefaults>
      <EmailBody>
        <EmailHeader />

        {(['site-doc-update', 'site-new-discussion', 'discussion', 'mention', 'reply'] as const).map((reason) => {
          const docs = grouped[reason]
          const docEntries = Object.entries(docs)

          if (!docEntries.length) return null

          return (
            <React.Fragment key={reason}>
              {docEntries.map(([docId, docNotifs]) => {
                const targetName = docNotifs?.[0]?.notif?.targetMeta?.name || 'Untitled Document'
                const docUrl = getNotificationActionUrl(docNotifs?.[0]?.notif!)

                return (
                  <React.Fragment key={docId}>
                    <MjmlSection padding={`24px ${emailTheme.gutter} 8px`}>
                      <MjmlColumn>
                        <MjmlText
                          fontSize="24px"
                          fontWeight="bold"
                          lineHeight="1.25"
                          color={emailTheme.heading}
                          padding="0"
                        >
                          {getDigestTitle(reason, docNotifs)} <em>{targetName}</em>
                        </MjmlText>
                      </MjmlColumn>
                    </MjmlSection>

                    {docNotifs.map(({notif}) => {
                      const key = 'comment' in notif && notif.comment ? notif.comment.id : Math.random()
                      return <EmailContent key={key} notification={notif} />
                    })}

                    <EmailButtonSection href={docUrl}>
                      {reason === 'site-new-discussion' || reason === 'discussion'
                        ? 'See discussion'
                        : reason === 'mention'
                          ? 'See mention'
                          : reason === 'reply'
                            ? 'See reply'
                            : 'See changes'}
                    </EmailButtonSection>
                  </React.Fragment>
                )
              })}
            </React.Fragment>
          )
        })}

        <EmailFooter
          siteUrl={batchSiteUrl}
          unsubscribeUrl={notifSettingsUrl}
          manageNotificationsUrl={notifSettingsUrl}
        />
      </EmailBody>
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
  const desktopSiteUrl = extractOrigin(first.notif.url)

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

  const {html: emailHtml} = await renderReactToMjml(
    <Mjml>
      <EmailHeadDefaults>
        <MjmlTitle>{subject}</MjmlTitle>
        <MjmlPreview>{preview}</MjmlPreview>
      </EmailHeadDefaults>
      <EmailBody>
        <EmailHeader />

        <MjmlSection padding={`24px ${emailTheme.gutter} 16px`}>
          <MjmlColumn>
            <MjmlText fontSize="24px" fontWeight="bold" lineHeight="1.25" color={emailTheme.heading} padding="0">
              Notifications
            </MjmlText>
          </MjmlColumn>
        </MjmlSection>

        {sorted.map((notification) => {
          const actionUrl = getNotificationActionUrl(notification.notif)
          const actionLabel =
            notification.notif.reason === 'mention'
              ? 'See mention'
              : notification.notif.reason === 'discussion'
                ? 'See discussion'
                : 'See reply'
          const timeLabel = formatDesktopNotificationTime(notification.notif.eventAtMs)
          const key =
            notification.notif.reason === 'mention'
              ? `${notification.accountId}:${notification.notif.eventId || notification.notif.url}`
              : `${notification.accountId}:${notification.notif.comment?.id || notification.notif.url}`

          return (
            <MjmlSection key={key} padding={`0px ${emailTheme.gutter} 12px`}>
              <MjmlColumn backgroundColor={emailTheme.quoteBackground} padding="16px 24px">
                <MjmlText fontSize="16px" fontWeight="bold" color={emailTheme.heading} padding="0px 0px 6px">
                  {getDesktopNotificationText(notification)}
                </MjmlText>
                {timeLabel ? (
                  <MjmlText fontSize="13px" color={emailTheme.muted} padding="0px 0px 12px">
                    {timeLabel}
                  </MjmlText>
                ) : null}
                <EmailButton href={actionUrl} padding="4px 0px 0px">
                  {actionLabel}
                </EmailButton>
              </MjmlColumn>
            </MjmlSection>
          )
        })}

        <EmailFooter
          siteUrl={desktopSiteUrl}
          unsubscribeUrl={notifSettingsUrl}
          manageNotificationsUrl={notifSettingsUrl}
        />
      </EmailBody>
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
      resolvedNames?: Record<string, string>
    }
  | {
      reason: 'user-comment'
      comment: HMComment
      parentComments: HMComment[]
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

/** Digest heading for one document, e.g. "Gabo and Eric started 3 discussions on" (the document name follows). */
function getDigestTitle(reason: Notification['reason'], docNotifs: FullNotification[]) {
  const authors = [...new Set(docNotifs.map(({notif}) => notif.authorMeta?.name || 'Someone'))]
  const who =
    authors.length === 1
      ? authors[0]
      : authors.length === 2
        ? `${authors[0]} and ${authors[1]}`
        : `${authors[0]} and ${authors.length - 1} others`
  const count = docNotifs.length
  const first = docNotifs[0]!

  switch (reason) {
    case 'site-new-discussion':
    case 'discussion':
      return `${who} started ${count === 1 ? 'a discussion' : `${count} discussions`} on`
    case 'mention':
      return `${who} mentioned ${first.accountMeta?.name || 'you'} in`
    case 'reply':
      return `${who} replied to ${count === 1 ? 'your comment' : 'your comments'} in`
    case 'user-comment':
      return `${who} commented on`
    case 'site-doc-update':
      return first.notif.reason === 'site-doc-update' && first.notif.isNewDocument && count === 1
        ? `${who} created`
        : `${who} updated`
    default:
      return assertNever(reason)
  }
}

function assertNever(value: never): never {
  throw new Error(`Unhandled notification reason: ${JSON.stringify(value)}`)
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

/** Extract the origin (protocol + host) from a URL, e.g. "https://seedteamtalks.hyper.media/d/x" → "https://seedteamtalks.hyper.media". */
function extractOrigin(url: string): string | undefined {
  try {
    return new URL(url).origin
  } catch {
    return undefined
  }
}

export async function renderReactToMjml(email: React.ReactElement): Promise<MJMLParseResults> {
  return mjml2html(renderToMjml(email))
}
