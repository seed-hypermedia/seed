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
          <QuotedContent blocks={input.commentBlocks} resolvedNames={input.resolvedNames} variant="border" />
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
              See comment
            </MjmlButton>
          </MjmlColumn>
        </MjmlSection>

        <EmailFooter siteUrl={input.siteUrl} unsubscribeUrl={input.unsubscribeUrl} manageNotificationsUrl={input.unsubscribeUrl} />
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
  siteUrl?: string
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

        <EmailFooter siteUrl={input.siteUrl} unsubscribeUrl={input.unsubscribeUrl} manageNotificationsUrl={input.unsubscribeUrl} />
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
  siteUrl?: string
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

        <EmailFooter siteUrl={input.siteUrl} unsubscribeUrl={input.unsubscribeUrl} manageNotificationsUrl={input.unsubscribeUrl} />
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
  siteUrl?: string
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
              {input.authorName} left a comment on your document{' '}
              <strong>
                <em>{input.documentName}</em>
              </strong>
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
              See comment
            </MjmlButton>
          </MjmlColumn>
        </MjmlSection>

        <EmailFooter siteUrl={input.siteUrl} unsubscribeUrl={input.unsubscribeUrl} manageNotificationsUrl={input.unsubscribeUrl} />
      </MjmlBody>
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
export function createDiscussionEmail(input: CreateDiscussionEmailInput) {
  const subject = `A new discussion in ${input.documentName} was created by ${input.authorName}`

  const text = `${subject}

See discussion: ${input.actionUrl}

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
              A new discussion in <em>{input.documentName}</em> was created by {input.authorName}
            </MjmlText>
          </MjmlColumn>
        </MjmlSection>

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
              See discussion
            </MjmlButton>
          </MjmlColumn>
        </MjmlSection>

        <EmailFooter siteUrl={input.siteUrl} unsubscribeUrl={input.unsubscribeUrl} manageNotificationsUrl={input.unsubscribeUrl} />
      </MjmlBody>
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
export function createWelcomeEmail(input: CreateWelcomeEmailInput) {
  const subject = "You're in. Welcome to the community."
  const greeting = input.recipientName ? `Hi ${input.recipientName},` : 'Hi there,'
  const text = `${subject}

${greeting}

We're thrilled to have you as part of Seed Hypermedia. You can now participate, comment, follow authors, bookmark content and much more!

Go to ${input.siteName}: ${input.siteUrl}`

  const {html} = renderReactToMjml(
    <Mjml>
      <EmailHeadDefaults>
        <MjmlTitle>{subject}</MjmlTitle>
        <MjmlPreview>Welcome to Seed Hypermedia — you're all set!</MjmlPreview>
      </EmailHeadDefaults>
      <MjmlBody width={500} backgroundColor="#ffffff">
        <EmailHeader />

        <MjmlSection padding="24px 24px 0">
          <MjmlColumn>
            <MjmlText fontSize="24px" fontWeight="bold" lineHeight="1.3" padding="0 0 16px">
              You're in. Welcome to the community.
            </MjmlText>
            <MjmlText fontSize="15px" lineHeight="1.6" padding="0 0 4px">
              {greeting}
            </MjmlText>
            <MjmlText fontSize="15px" lineHeight="1.6" padding="0 0 16px">
              We're thrilled to have you as part of Seed Hypermedia. You can now participate, comment, follow authors,
              bookmark content and much more!
            </MjmlText>
            <MjmlButton
              href={input.siteUrl}
              backgroundColor="#068f7b"
              color="#ffffff"
              borderRadius="6px"
              fontSize="14px"
              fontWeight="600"
              innerPadding="12px 24px"
              align="center"
              padding="0 0 24px"
            >
              Go to {input.siteName}
            </MjmlButton>
          </MjmlColumn>
        </MjmlSection>

        <EmailFooter />
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

export function createNotificationVerificationEmail(input: {
  verificationUrl: string
  recipientName?: string
}) {
  const subject = 'Confirm your email address'
  const greeting = input.recipientName ? `Hi ${input.recipientName},` : 'Hi there,'
  const text = `${subject}

${greeting}

Thanks for signing up for Seed Hypermedia. To complete your registration and access the community, please verify your email address.

${input.verificationUrl}

This link expires in 2 hours. If you didn't create an account, you can safely ignore this.`

  const {html: emailHtml} = renderReactToMjml(
    <Mjml>
      <EmailHeadDefaults>
        <MjmlTitle>{subject}</MjmlTitle>
        <MjmlPreview>Confirm your email to complete your registration</MjmlPreview>
      </EmailHeadDefaults>
      <MjmlBody width={500} backgroundColor="#ffffff">
        <EmailHeader />
        <MjmlSection padding="24px 24px 0">
          <MjmlColumn>
            <MjmlText fontSize="24px" fontWeight="bold" lineHeight="1.3" padding="0 0 16px">
              Confirm your email address
            </MjmlText>
            <MjmlText fontSize="15px" lineHeight="1.6" padding="0 0 4px">
              {greeting}
            </MjmlText>
            <MjmlText fontSize="15px" lineHeight="1.6" padding="0 0 16px">
              Thanks for signing up for Seed Hypermedia. To complete your registration and access the community, please
              verify your email address.
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
              padding="0 0 16px"
            >
              Verify email address
            </MjmlButton>
            <MjmlText fontSize="13px" color="#6b7280" lineHeight="1.5" padding="0 0 24px">
              This link expires in 2 hours. If you didn't create an account, you can safely ignore this.
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

  const {html: emailHtml} = renderReactToMjml(
    <Mjml>
      <EmailHeadDefaults>
        <MjmlTitle>{subject}</MjmlTitle>
        <MjmlPreview>
          {notifications.length > 1 ? `${firstNotificationSummary} and more` : firstNotificationSummary}
        </MjmlPreview>
      </EmailHeadDefaults>
      <MjmlBody width={500} backgroundColor="#ffffff">
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
              <MjmlSection padding="10px 24px 0">
                <MjmlColumn>
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
                    <MjmlSection padding="4px 24px 10px">
                      <MjmlColumn>
                        <MjmlText fontSize="14px" color="#6b7280">
                          {reason === 'site-new-discussion' || reason === 'discussion' ? (
                            <>
                              {docNotifs.length} {docNotifs.length === 1 ? 'discussion' : 'discussions'} on{' '}
                              <strong style={{color: '#1a1a1a'}}>{targetName}</strong>
                            </>
                          ) : reason === 'mention' ? (
                            <>
                              {docNotifs.length} {docNotifs.length === 1 ? 'mention' : 'mentions'} on{' '}
                              <strong style={{color: '#1a1a1a'}}>{targetName}</strong>
                            </>
                          ) : reason === 'reply' ? (
                            <>
                              {docNotifs.length} {totalCount === 1 ? 'reply' : 'replies'} on{' '}
                              <strong style={{color: '#1a1a1a'}}>{targetName}</strong>
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

                    <MjmlSection padding="0 24px 16px">
                      <MjmlColumn>
                        <MjmlButton
                          align="center"
                          href={docUrl}
                          backgroundColor="#068f7b"
                          color="#ffffff"
                          borderRadius="6px"
                          fontSize="14px"
                          fontWeight="600"
                          innerPadding="12px 24px"
                        >
                          {reason === 'site-new-discussion' || reason === 'discussion'
                            ? 'See discussion'
                            : reason === 'mention'
                            ? 'See mention'
                            : reason === 'reply'
                            ? 'See reply'
                            : 'See changes'}
                        </MjmlButton>
                      </MjmlColumn>
                    </MjmlSection>
                  </React.Fragment>
                )
              })}
            </React.Fragment>
          )
        })}

        <EmailFooter siteUrl={batchSiteUrl} unsubscribeUrl={notifSettingsUrl} manageNotificationsUrl={notifSettingsUrl} />
      </MjmlBody>
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

  const {html: emailHtml} = renderReactToMjml(
    <Mjml>
      <EmailHeadDefaults>
        <MjmlTitle>{subject}</MjmlTitle>
        <MjmlPreview>{preview}</MjmlPreview>
      </EmailHeadDefaults>
      <MjmlBody width={500} backgroundColor="#ffffff">
        <EmailHeader />

        <MjmlSection padding="8px 24px 0">
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
            <MjmlSection key={key} padding="0px 24px 12px">
              <MjmlColumn backgroundColor="#f3f4f6" borderRadius="8px" padding="12px 16px">
                <MjmlText fontSize="15px" fontWeight="bold" padding="0px 0px 6px">
                  {getDesktopNotificationText(notification)}
                </MjmlText>
                {timeLabel ? (
                  <MjmlText fontSize="12px" color="#6b7280" padding="0px 0px 8px">
                    {timeLabel}
                  </MjmlText>
                ) : null}
                <MjmlButton
                  align="center"
                  href={actionUrl}
                  backgroundColor="#068f7b"
                  color="#ffffff"
                  borderRadius="6px"
                  fontSize="14px"
                  fontWeight="600"
                  innerPadding="12px 24px"
                  padding="4px 0px 0px"
                >
                  {actionLabel}
                </MjmlButton>
              </MjmlColumn>
            </MjmlSection>
          )
        })}

        <EmailFooter siteUrl={desktopSiteUrl} unsubscribeUrl={notifSettingsUrl} manageNotificationsUrl={notifSettingsUrl} />
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

/** Extract the origin (protocol + host) from a URL, e.g. "https://seedteamtalks.hyper.media/d/x" → "https://seedteamtalks.hyper.media". */
function extractOrigin(url: string): string | undefined {
  try {
    return new URL(url).origin
  } catch {
    return undefined
  }
}

export function renderReactToMjml(email: React.ReactElement): MJMLParseResults {
  return mjml2html(renderToMjml(email))
}
