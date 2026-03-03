import type {NotificationPayload} from '@shm/shared/models/notification-payload'
import {getMentionNotificationTitle, getNotificationDocumentName} from '@shm/shared/models/notification-titles'
import {NavRoute} from '@shm/shared/routes'
import {abbreviateUid, hmId} from '@shm/shared'

export function notificationRouteForPayload(payload: NotificationPayload): NavRoute | null {
  if (payload.eventType === 'comment') {
    if (!payload.target.uid) return null
    const targetId = hmId(payload.target.uid, {path: payload.target.path ?? undefined})
    if (payload.commentId) {
      return {
        key: 'comments',
        id: targetId,
        openComment: payload.commentId,
      }
    }
    return {
      key: 'comments',
      id: targetId,
    }
  }

  if (payload.eventType === 'citation') {
    if (!payload.sourceId && !payload.target.uid) return null
    const sourceUid = payload.sourceId || payload.target.uid
    const sourceId = hmId(sourceUid, {path: payload.target.path ?? undefined})
    if (payload.citationType === 'c' && payload.commentId) {
      return {
        key: 'comments',
        id: sourceId,
        openComment: payload.commentId,
      }
    }
    return {
      key: 'document',
      id: sourceId,
    }
  }

  return null
}

export function notificationTitle(payload: NotificationPayload): string {
  const authorName = payload.author.name || (payload.author.uid ? abbreviateUid(payload.author.uid) : 'Someone')

  if (payload.reason === 'mention') {
    const sourceName = getNotificationDocumentName({
      targetMeta: payload.target.name ? {name: payload.target.name} : null,
      targetId: payload.target.uid ? hmId(payload.target.uid, {path: payload.target.path ?? undefined}) : undefined,
    })
    return getMentionNotificationTitle({
      actorName: authorName,
      subjectName: 'you',
      documentName: sourceName,
    })
  }

  if (payload.reason === 'discussion') {
    const targetName = payload.target.name
    return `${authorName} started a discussion${targetName ? ` on ${targetName}` : ''}`
  }

  if (payload.reason === 'site-doc-update') {
    const targetName = payload.target.name
    return `${authorName} updated${targetName ? ` ${targetName}` : ' a document'}`
  }

  if (payload.reason === 'site-new-discussion') {
    const targetName = payload.target.name
    return `${authorName} started a discussion${targetName ? ` on ${targetName}` : ''}`
  }

  if (payload.reason === 'user-comment') {
    const targetName = payload.target.name
    return `${authorName} commented${targetName ? ` on ${targetName}` : ''}`
  }

  // reply
  const targetName = payload.target.name
  return `${authorName} replied to your comment${targetName ? ` in ${targetName}` : ''}`
}

export function getMaxLoadedNotificationEventAtMs(notifications: NotificationPayload[], nowMs: number = Date.now()) {
  if (!notifications.length) return nowMs
  return notifications.reduce((maxEventAtMs, item) => {
    return Math.max(maxEventAtMs, item.eventAtMs)
  }, 0)
}

export async function markNotificationReadAndNavigate(input: {
  accountUid: string
  item: NotificationPayload
  markEventRead: (params: {accountUid: string; eventId: string; eventAtMs: number}) => Promise<void>
  navigate: (route: NavRoute) => void
}) {
  await input.markEventRead({
    accountUid: input.accountUid,
    eventId: input.item.feedEventId,
    eventAtMs: input.item.eventAtMs,
  })
  const route = notificationRouteForPayload(input.item)
  if (route) input.navigate(route)
}
