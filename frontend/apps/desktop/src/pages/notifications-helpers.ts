import type {NotificationPayload} from '@shm/shared/models/notification-payload'
import {getMentionNotificationTitle, getNotificationDocumentName} from '@shm/shared/models/notification-titles'
import {NavRoute} from '@shm/shared/routes'
import {abbreviateUid, hmId} from '@shm/shared'

/**
 * Returns the navigation route targeted by a notification payload.
 */
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

  if (payload.eventType === 'ref') {
    if (!payload.target.uid) return null
    const targetId = hmId(payload.target.uid, {path: payload.target.path ?? undefined})
    return {
      key: 'document',
      id: targetId,
    }
  }

  return null
}

function getNotificationAuthorName(payload: NotificationPayload, authorName?: string | null): string {
  const resolvedAuthorName = authorName?.trim()
  if (resolvedAuthorName) return resolvedAuthorName
  return payload.author.name || (payload.author.uid ? abbreviateUid(payload.author.uid) : 'Someone')
}

function getNotificationTargetName(payload: NotificationPayload, targetName?: string | null): string {
  const resolvedTargetName = targetName?.trim()
  if (resolvedTargetName) return resolvedTargetName

  return getNotificationDocumentName({
    targetMeta: payload.target.name ? {name: payload.target.name} : null,
    targetId: payload.target.uid ? hmId(payload.target.uid, {path: payload.target.path ?? undefined}) : undefined,
  })
}

/**
 * Builds a notification title, preferring resolved metadata when available.
 */
export function notificationTitle(
  payload: NotificationPayload,
  overrides?: {
    authorName?: string | null
    targetName?: string | null
  },
): string {
  const authorName = getNotificationAuthorName(payload, overrides?.authorName)

  if (payload.reason === 'mention') {
    const sourceName = getNotificationTargetName(payload, overrides?.targetName)
    return getMentionNotificationTitle({
      actorName: authorName,
      subjectName: 'you',
      documentName: sourceName,
    })
  }

  if (payload.reason === 'discussion') {
    const targetName = overrides?.targetName || payload.target.name
    return `${authorName} started a discussion${targetName ? ` on ${targetName}` : ''}`
  }

  if (payload.reason === 'site-doc-update') {
    const targetName = overrides?.targetName || payload.target.name
    return `${authorName} updated${targetName ? ` ${targetName}` : ' a document'}`
  }

  if (payload.reason === 'site-new-discussion') {
    const targetName = overrides?.targetName || payload.target.name
    return `${authorName} started a discussion${targetName ? ` on ${targetName}` : ''}`
  }

  if (payload.reason === 'user-comment') {
    const targetName = overrides?.targetName || payload.target.name
    return `${authorName} commented${targetName ? ` on ${targetName}` : ''}`
  }

  // reply
  const targetName = overrides?.targetName || payload.target.name
  return `${authorName} replied to your comment${targetName ? ` in ${targetName}` : ''}`
}

/**
 * Returns the latest event timestamp represented by the currently loaded notifications.
 */
export function getMaxLoadedNotificationEventAtMs(notifications: NotificationPayload[], nowMs: number = Date.now()) {
  if (!notifications.length) return nowMs
  return notifications.reduce((maxEventAtMs, item) => {
    return Math.max(maxEventAtMs, item.eventAtMs)
  }, 0)
}

/**
 * Marks a notification as read before navigating to its target route.
 */
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
