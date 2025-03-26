import {PlainMessage, toPlainMessage} from '@bufbuild/protobuf'
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
  ENABLE_EMAIL_NOTIFICATIONS,
  entityQueryPathToHmIdPath,
  Event,
  HMBlockNode,
  HMBlockNodeSchema,
  hmId,
  HMMetadata,
  SITE_BASE_URL,
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
  console.log('initEmailNotifier', {ENABLE_EMAIL_NOTIFICATIONS})
  if (!ENABLE_EMAIL_NOTIFICATIONS) return

  await handleEmailNotifications()
  console.log('Email notifications handled')

  setInterval(
    () => {
      handleEmailNotifications()
        .then(() => {
          console.log('Email notifications handled')
        })
        .catch((err) => {
          console.error('Error handling email notifications', err)
        })
    },
    1000 * 60 * 1,
  ) // 1 minute
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
      parentComments: PlainMessage<Comment>[]
      url: string
    }
  | {
      type: 'reply'
      comment: PlainMessage<Comment>
      commentAuthorMeta: HMMetadata | null
      targetMeta: HMMetadata | null
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
      notif: Notification
    }[]
  > = {}
  function appendNotification(
    email: string,
    accountId: string,
    notif: Notification,
  ) {
    if (!notificationsToSend[email]) {
      notificationsToSend[email] = []
    }
    notificationsToSend[email].push({accountId, notif})
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
      if (account.notifyAllReplies && newComment.parentAuthors.has(accountId)) {
        appendNotification(account.email, accountId, {
          type: 'reply',
          comment: newComment.comment,
          parentComments: newComment.parentComments,
          commentAuthorMeta: newComment.commentAuthorMeta,
          targetMeta: newComment.targetMeta,
          url: targetDocUrl,
        })
      }
      if (account.notifyAllMentions) {
        if (newComment.mentions.has(accountId)) {
          appendNotification(account.email, accountId, {
            type: 'mention',
            comment: newComment.comment,
            parentComments: newComment.parentComments,
            commentAuthorMeta: newComment.commentAuthorMeta,
            targetMeta: newComment.targetMeta,
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

async function sendNotificationsEmail(
  email: string,
  opts: {adminToken: string; isUnsubscribed: boolean; createdAt: string},
  notifications: {accountId: string; notif: Notification}[],
) {
  if (!notifications.length) return
  const notifSettingsUrl = `${SITE_BASE_URL}/hm/email-notifications?token=${opts.adminToken}`
  const text = `New Updates from ${SITE_BASE_URL}

${notifications
  .map((notification) => {
    const comment = notification.notif.comment
    return `New ${notification.notif.type} from ${comment.author} on ${notification.notif.url}`
  })
  .join('\n\n')}
  
Unsubscribe from this email: ${notifSettingsUrl}`
  const {html, errors} = renderReactToMjml(
    <Mjml>
      <MjmlHead>
        <MjmlTitle>Hypermedia Notifications</MjmlTitle>
        {/* This preview is visible from the email client before the user clicks on the email */}
        <MjmlPreview>{notifications.length} notifications</MjmlPreview>
      </MjmlHead>
      <MjmlBody width={500}>
        {/* <MjmlSection fullWidth backgroundColor="#efefef">
          <MjmlColumn>
            <MjmlImage src="https://static.wixstatic.com/media/5cb24728abef45dabebe7edc1d97ddd2.jpg" />
          </MjmlColumn>
        </MjmlSection> */}
        {notifications.map((notification) => {
          return (
            <MjmlSection>
              <MjmlText>${getNotificationSummary(notification)}</MjmlText>
              <MjmlColumn>
                <MjmlButton
                  padding="20px"
                  backgroundColor="#346DB7"
                  href={notification.notif.url}
                >
                  Open Document
                </MjmlButton>
              </MjmlColumn>
            </MjmlSection>
          )
        })}
      </MjmlBody>
    </Mjml>,
    {validationLevel: 'soft'},
  )
  console.log('Sending email to', email, 'with text', text)
  await sendEmail(email, 'New notifications', {text, html})
}

function getNotificationSummary(notification: Notification): string {
  // return `${notification.commentAuthorMeta.author} you in a document.`
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
