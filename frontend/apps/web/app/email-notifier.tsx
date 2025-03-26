import {PlainMessage, toPlainMessage} from '@bufbuild/protobuf'
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
import {
  Comment,
  ENABLE_EMAIL_NOTIFICATIONS,
  entityQueryPathToHmIdPath,
  Event,
  HMBlockNode,
  HMBlockNodeSchema,
  hmId,
  HMMetadata,
  SITE_BASE_URL,
  UnpackedHypermediaId,
  unpackHmId,
} from '@shm/shared'
import mjml2html from 'mjml'
import {MJMLParseResults} from 'mjml-core'
import React from 'react'
import {queryClient} from './client'
import {
  getAllEmails,
  getNotifierLastProcessedBlobCid,
  setNotifierLastProcessedBlobCid,
} from './db'
import {getMetadata} from './loaders'
import {sendEmail} from './mailer'

export async function initEmailNotifier() {
  if (!ENABLE_EMAIL_NOTIFICATIONS) return

  console.log('Email Notifications Enabled')

  await handleEmailNotifications()

  const handleEmailNotificationsIntervalSeconds = 30

  setInterval(() => {
    handleEmailNotifications()
      .then(() => {
        // console.log('Email notifications handled')
      })
      .catch((err) => {
        console.error('Error handling email notifications', err)
      })
  }, 1000 * handleEmailNotificationsIntervalSeconds)
}

async function handleEmailNotifications() {
  const lastProcessedBlobCid = getNotifierLastProcessedBlobCid()
  if (lastProcessedBlobCid) {
    await handleEmailNotificationsAfterBlobCid(lastProcessedBlobCid)
  } else {
    await resetNotifierLastProcessedBlobCid()
  }
}

async function resetNotifierLastProcessedBlobCid() {
  const {events} = await queryClient.activityFeed.listEvents({
    pageToken: undefined,
    pageSize: 5,
  })
  const event = events.at(0)
  if (!event) return
  const lastBlobCid =
    event.data.case === 'newBlob' && event.data.value?.cid
      ? event.data.value.cid
      : undefined
  if (!lastBlobCid) return
  setNotifierLastProcessedBlobCid(lastBlobCid)
}

async function handleEmailNotificationsAfterBlobCid(
  lastProcessedBlobCid: string,
) {
  const eventsToProcess = await loadEventsAfterBlobCid(lastProcessedBlobCid)
  if (eventsToProcess.length === 0) return
  await handleEventsForEmailNotifications(eventsToProcess)
  await markEventsAsProcessed(eventsToProcess)
}

type Notification =
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

async function handleEventsForEmailNotifications(
  events: PlainMessage<Event>[],
) {
  const allEmails = getAllEmails()
  const accountNotificationOptions: Record<
    string,
    {
      notifyAllMentions: boolean
      notifyAllReplies: boolean
      email: string
    }
  > = {}
  const emailOptions: Record<
    string, // email
    {
      adminToken: string
      isUnsubscribed: boolean
      createdAt: string
    }
  > = {}
  for (const email of allEmails) {
    emailOptions[email.email] = {
      adminToken: email.adminToken,
      isUnsubscribed: email.isUnsubscribed,
      createdAt: email.createdAt,
    }
  }
  const notificationsToSend: Record<
    string, // email
    {
      accountId: string
      accountMeta: HMMetadata | null
      notif: Notification
    }[]
  > = {}
  const accountMetas: Record<string, HMMetadata | null> = {}
  async function appendNotification(
    email: string,
    accountId: string,
    notif: Notification,
  ) {
    if (!notificationsToSend[email]) {
      notificationsToSend[email] = []
    }
    if (accountMetas[accountId] === undefined) {
      accountMetas[accountId] = (
        await getMetadata(hmId('d', accountId))
      ).metadata
    }
    notificationsToSend[email].push({
      accountId,
      accountMeta: accountMetas[accountId],
      notif,
    })
  }
  for (const email of allEmails) {
    for (const account of email.accounts) {
      const opts = emailOptions[email.email]
      if (opts.isUnsubscribed) continue
      accountNotificationOptions[account.id] = {
        notifyAllMentions: account.notifyAllMentions,
        notifyAllReplies: account.notifyAllReplies,
        email: email.email,
      }
    }
  }
  const newComments: {
    comment: PlainMessage<Comment>
    parentAuthors: Set<string>
    parentComments: PlainMessage<Comment>[]
    commentAuthorMeta: HMMetadata | null
    targetMeta: HMMetadata | null
    mentions: Set<string>
  }[] = []
  for (const event of events) {
    if (event.data.case === 'newBlob') {
      const blob = event.data.value
      if (blob.blobType !== 'Comment') continue
      const comment = await queryClient.comments.getComment({id: blob.cid})
      const parentComments = await getParentComments(comment)
      const parentAuthors: Set<string> = new Set()
      for (const parentComment of parentComments) {
        parentAuthors.add(parentComment.author)
      }
      newComments.push({
        comment: toPlainMessage(comment),
        parentComments,
        parentAuthors,
        commentAuthorMeta: (await getMetadata(hmId('d', comment.author)))
          .metadata,
        targetMeta: (
          await getMetadata(
            hmId('d', comment.targetAccount, {
              path: entityQueryPathToHmIdPath(comment.targetPath),
            }),
          )
        ).metadata,
        mentions: getMentions(comment),
      })
    }
  }
  for (const newComment of newComments) {
    for (const accountId in accountNotificationOptions) {
      if (newComment.comment.author === accountId) continue // don't notify the author for their own comments
      const account = accountNotificationOptions[accountId]
      const comment = newComment.comment
      const targetDocUrl = `${SITE_BASE_URL}/hm/${comment.targetAccount}${comment.targetPath}`
      const targetDocId = hmId('d', comment.targetAccount, {
        path: entityQueryPathToHmIdPath(comment.targetPath),
      })
      if (account.notifyAllReplies && newComment.parentAuthors.has(accountId)) {
        await appendNotification(account.email, accountId, {
          type: 'reply',
          comment: newComment.comment,
          parentComments: newComment.parentComments,
          commentAuthorMeta: newComment.commentAuthorMeta,
          targetMeta: newComment.targetMeta,
          targetId: targetDocId,
          url: targetDocUrl,
        })
      }
      if (account.notifyAllMentions) {
        if (newComment.mentions.has(accountId)) {
          await appendNotification(account.email, accountId, {
            type: 'mention',
            comment: newComment.comment,
            parentComments: newComment.parentComments,
            commentAuthorMeta: newComment.commentAuthorMeta,
            targetMeta: newComment.targetMeta,
            targetId: targetDocId,
            url: targetDocUrl,
          })
        }
      }
    }
  }
  const emailsToSend = Object.entries(notificationsToSend)
  for (const [email, notifications] of emailsToSend) {
    const opts = emailOptions[email]
    if (opts.isUnsubscribed) continue
    await sendNotificationsEmail(email, opts, notifications)
  }
}

type FullNotification = {
  accountId: string
  accountMeta: HMMetadata | null
  notif: Notification
}

async function sendNotificationsEmail(
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
  
Unsubscribe from this email: ${notifSettingsUrl}`
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
                href={notifications[0].notif.url}
              >
                Open Document
              </MjmlButton>
            </MjmlSection>
          )
        })}
        <MjmlSection>
          <MjmlText fontSize={10} paddingBottom={10} align="center">
            Subscribed by mistake? Click here to unsubscribe:
          </MjmlText>
          <MjmlButton
            padding="8px"
            backgroundColor="#828282"
            href={notifSettingsUrl}
            align="center"
          >
            Manage Email Notifications
          </MjmlButton>
        </MjmlSection>
      </MjmlBody>
    </Mjml>,
  )
  console.log('Sending email to', email, 'with text:\n', text)

  await sendEmail(
    email,
    subject,
    {text, html},
    `Hypermedia Updates for ${Array.from(subscriberNames).join(', ')}`,
  )
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

function getMentions(comment: PlainMessage<Comment>) {
  const allMentions = new Set<string>()
  comment.content.forEach((rawBlockNode) => {
    const blockNode = HMBlockNodeSchema.parse(rawBlockNode)
    const mentions = getBlockNodeMentions(blockNode)
    for (const mention of mentions) {
      allMentions.add(mention)
    }
  })
  return allMentions
}

function getBlockNodeMentions(blockNode: HMBlockNode): Set<string> {
  const mentions: Set<string> = new Set()
  for (const annotation of blockNode.block?.annotations || []) {
    if (annotation.type === 'Embed') {
      const hmId = unpackHmId(annotation.link)
      if (hmId && !hmId.path?.length) {
        mentions.add(hmId.uid)
      }
    }
  }
  return mentions
}

async function getParentComments(comment: PlainMessage<Comment>) {
  const parentComments: PlainMessage<Comment>[] = []
  let currentComment = comment
  while (currentComment.replyParent) {
    const parentComment = await queryClient.comments.getComment({
      id: currentComment.replyParent,
    })
    const parentCommentPlain = toPlainMessage(parentComment)
    parentComments.push(parentCommentPlain)
    currentComment = parentCommentPlain
  }
  return parentComments
}

// to load change cid:
//   queryClient.entities.getChange({
//     id:
//   })

async function markEventsAsProcessed(events: PlainMessage<Event>[]) {
  const newestEvent = events.at(0)
  if (!newestEvent) return
  const lastProcessedBlobCid = newestEvent.data.value?.cid
  if (!lastProcessedBlobCid) return
  await setNotifierLastProcessedBlobCid(lastProcessedBlobCid)
}

async function loadEventsAfterBlobCid(lastProcessedBlobCid: string) {
  const eventsAfterBlobCid = []
  let currentPageToken: string | undefined

  while (true) {
    const {events, nextPageToken} = await queryClient.activityFeed.listEvents({
      pageToken: currentPageToken,
      pageSize: 2,
    })

    for (const event of events) {
      if (event.data.case === 'newBlob' && event.data.value?.cid) {
        if (event.data.value.cid === lastProcessedBlobCid) {
          return eventsAfterBlobCid
        }
        eventsAfterBlobCid.push(toPlainMessage(event))
      }
    }

    if (!nextPageToken) break
    currentPageToken = nextPageToken
  }

  return eventsAfterBlobCid
}
