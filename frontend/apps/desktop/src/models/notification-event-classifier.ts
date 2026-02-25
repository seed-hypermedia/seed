import {getAnnotations} from '@shm/shared/content'
import {HMBlockNode, HMComment} from '@shm/shared/hm-types'
import {LoadedEventWithNotifMeta} from '@shm/shared/models/activity-service'
import {unpackHmId} from '@shm/shared/utils/entity-id-url'

export type NotificationReason = 'mention' | 'reply' | 'discussion'

function blockMentionsAccount(block: HMBlockNode, accountUid: string): boolean {
  const annotations = getAnnotations(block.block)
  if (Array.isArray(annotations)) {
    for (const annotation of annotations) {
      if (annotation.type !== 'Embed') continue
      const mentioned = unpackHmId(annotation.link)
      if (mentioned?.uid === accountUid && (!mentioned.path || mentioned.path.length === 0)) {
        return true
      }
    }
  }
  return block.children?.some((child) => blockMentionsAccount(child, accountUid)) ?? false
}

function commentMentionsAccount(comment: HMComment | null | undefined, accountUid: string): boolean {
  if (!comment?.content?.length) return false
  return comment.content.some((block) => blockMentionsAccount(block, accountUid))
}

export function classifyNotificationEvent(
  event: LoadedEventWithNotifMeta,
  accountUid: string,
): NotificationReason | null {
  if (event.type === 'citation') {
    if (event.target?.id?.uid === accountUid) {
      // Comment citation targeting a document (has path) rather than an account @mention (no path).
      // Classify top-level comments as 'discussion'; suppress replies (handled by blob event).
      if (event.citationType === 'c' && event.target.id.path?.length) {
        const isSelfAuthored = event.author?.id?.uid === accountUid
        if (!isSelfAuthored && event.comment && !event.comment.threadRoot) {
          return 'discussion'
        }
        return null
      }
      return 'mention'
    }
  }

  if (event.type === 'comment') {
    const isSelfAuthored = event.author?.id?.uid === accountUid
    if (event.replyParentAuthor?.id?.uid === accountUid) return 'reply'
    // Top-level comment on a doc in this account's site (takes priority over mention)
    if (!isSelfAuthored && !event.comment?.threadRoot && event.target?.id?.uid === accountUid) {
      return 'discussion'
    }
    if (!isSelfAuthored && commentMentionsAccount(event.comment, accountUid)) {
      return 'mention'
    }
  }

  return null
}
