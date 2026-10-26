/**
 * Shared helpers for notification display, routing, and read-state mutations.
 * No platform-specific dependencies.
 */
import {hmId} from '../index'
import {NavRoute} from '../routes'
import type {NotificationPayload} from './notification-payload'
import {getNotificationDocumentName} from './notification-titles'

/**
 * Returns the navigation route targeted by a notification payload.
 * Comments open their document with Discussions in the right panel, so the document stays in view.
 */
export function notificationRouteForPayload(payload: NotificationPayload): NavRoute | null {
  if (payload.eventType === 'comment') {
    if (!payload.target.uid) return null
    const targetId = hmId(payload.target.uid, {path: payload.target.path ?? undefined})
    return {
      key: 'document',
      id: targetId,
      panel: {key: 'comments', id: targetId, openComment: payload.commentId ?? undefined},
    }
  }

  if (payload.eventType === 'citation') {
    if (!payload.sourceId && !payload.target.uid) return null
    const sourceUid = payload.sourceId || payload.target.uid
    const sourceId = hmId(sourceUid, {path: payload.target.path ?? undefined})
    if (payload.citationType === 'c' && payload.commentId) {
      return {
        key: 'document',
        id: sourceId,
        panel: {key: 'comments', id: sourceId, openComment: payload.commentId},
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

/** The name of the document a notification points at, preferring resolved metadata, then the path. */
export function getNotificationTargetName(payload: NotificationPayload, targetName?: string | null): string {
  const resolvedTargetName = targetName?.trim()
  if (resolvedTargetName) return resolvedTargetName

  return getNotificationDocumentName({
    targetMeta: payload.target.name ? {name: payload.target.name} : null,
    targetId: payload.target.uid ? hmId(payload.target.uid, {path: payload.target.path ?? undefined}) : undefined,
  })
}

/**
 * The action a notification reports, worded to sit between the author's name and the document name.
 */
export function notificationAction(payload: NotificationPayload): string {
  switch (payload.reason) {
    case 'mention':
      return 'mentioned you in'
    case 'discussion':
    case 'site-new-discussion':
      return 'started a discussion on'
    case 'site-doc-update':
      return 'updated'
    case 'user-comment':
      return 'commented on'
    default:
      return 'replied to your comment in'
  }
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
 * Navigates to a notification target immediately and marks it read in the background.
 */
export function markNotificationReadAndNavigate(input: {
  accountUid: string
  item: NotificationPayload
  markEventRead: (params: {accountUid: string; eventId: string; eventAtMs: number}) => Promise<void>
  navigate: (route: NavRoute) => void
}) {
  const route = notificationRouteForPayload(input.item)
  if (route) input.navigate(route)

  void input
    .markEventRead({
      accountUid: input.accountUid,
      eventId: input.item.feedEventId,
      eventAtMs: input.item.eventAtMs,
    })
    .catch((error) => {
      console.error('[markNotificationReadAndNavigate] Failed to mark notification as read', error)
    })
}
