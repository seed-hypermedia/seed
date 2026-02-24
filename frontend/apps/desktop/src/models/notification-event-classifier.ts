import {getAnnotations} from '@shm/shared/content'
import {HMBlockNode, HMComment} from '@shm/shared/hm-types'
import {LoadedEventWithNotifMeta} from '@shm/shared/models/activity-service'
import {unpackHmId} from '@shm/shared/utils/entity-id-url'

export type NotificationReason = 'mention' | 'reply'

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
    // Treat mentions to any path under the selected account as account mentions.
    if (event.target?.id?.uid === accountUid) return 'mention'
  }

  if (event.type === 'comment') {
    if (event.replyParentAuthor?.id?.uid === accountUid) return 'reply'
    const isSelfAuthored = event.author?.id?.uid === accountUid
    if (!isSelfAuthored && commentMentionsAccount(event.comment, accountUid)) {
      return 'mention'
    }
  }

  return null
}
