import {getAnnotations} from '../content'
import {HMBlockNode, HMComment} from '../hm-types'
import {unpackHmId} from '../utils/entity-id-url'
import {LoadedEventWithNotifMeta} from './activity-service'

function collectMentionedAccountUidsFromBlock(block: HMBlockNode, accountUids: Set<string>) {
  const annotations = getAnnotations(block.block)
  if (Array.isArray(annotations)) {
    for (const annotation of annotations) {
      if (annotation.type !== 'Embed') continue
      const mentioned = unpackHmId(annotation.link)
      if (mentioned?.uid && (!mentioned.path || mentioned.path.length === 0)) {
        accountUids.add(mentioned.uid)
      }
    }
  }
  for (const child of block.children || []) {
    collectMentionedAccountUidsFromBlock(child, accountUids)
  }
}

export function extractMentionedAccountUidsFromComment(comment: HMComment | null | undefined): Set<string> {
  const accountUids = new Set<string>()
  if (!comment?.content?.length) return accountUids
  for (const block of comment.content) {
    collectMentionedAccountUidsFromBlock(block, accountUids)
  }
  return accountUids
}

export function commentMentionsAccount(comment: HMComment | null | undefined, accountUid: string): boolean {
  return extractMentionedAccountUidsFromComment(comment).has(accountUid)
}

export type NotificationReason = 'mention' | 'reply' | 'discussion'

export function classifyCommentNotificationForAccount(input: {
  subscriptionAccountUid: string
  commentAuthorUid: string | null | undefined
  targetAccountUid: string | null | undefined
  targetAuthorUids?: string[] | null | undefined
  isTopLevelComment: boolean
  parentCommentAuthorUid: string | null | undefined
  mentionedAccountUids: Set<string>
}): NotificationReason | null {
  const isSelfAuthored = input.commentAuthorUid === input.subscriptionAccountUid
  if (isSelfAuthored) return null
  if (input.parentCommentAuthorUid === input.subscriptionAccountUid) return 'reply'
  const isTargetAuthor = Boolean(input.targetAuthorUids?.includes(input.subscriptionAccountUid))
  if (input.isTopLevelComment && (input.targetAccountUid === input.subscriptionAccountUid || isTargetAuthor)) {
    return 'discussion'
  }
  if (input.mentionedAccountUids.has(input.subscriptionAccountUid)) return 'mention'
  return null
}

export function classifyNotificationEvent(
  event: LoadedEventWithNotifMeta,
  accountUid: string,
): NotificationReason | null {
  if (event.type === 'citation') {
    // Comment citations that target documents are mirrored by comment blob events.
    // Suppress them here to avoid duplicate discussion notifications in desktop inbox.
    if (event.citationType === 'c' && event.target?.id?.path?.length) {
      return null
    }

    if (event.target?.id?.uid === accountUid) {
      return 'mention'
    }
  }

  if (event.type === 'comment') {
    const mentionedAccountUids = extractMentionedAccountUidsFromComment(event.comment)
    return classifyCommentNotificationForAccount({
      subscriptionAccountUid: accountUid,
      commentAuthorUid: event.author?.id?.uid,
      targetAccountUid: event.target?.id?.uid,
      targetAuthorUids: event.targetAuthorUids,
      isTopLevelComment: !event.comment?.threadRoot,
      parentCommentAuthorUid: event.replyParentAuthor?.id?.uid,
      mentionedAccountUids,
    })
  }

  return null
}
