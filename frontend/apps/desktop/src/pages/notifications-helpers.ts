import {LoadedEventWithNotifMeta} from '@shm/shared/models/activity-service'
import {classifyNotificationEvent, NotificationReason} from '@shm/shared/models/notification-event-classifier'
import {NavRoute} from '@shm/shared/routes'
import {abbreviateUid} from '@shm/shared/utils'
export {classifyNotificationEvent}
export type {NotificationReason}

export type NotificationItem = {
  reason: NotificationReason
  event: LoadedEventWithNotifMeta
}

export function notificationRouteForEvent(event: LoadedEventWithNotifMeta): NavRoute | null {
  if (event.type === 'comment') {
    if (!event.target?.id || !event.comment) return null
    return {
      key: 'comments',
      id: event.target.id,
      openComment: event.comment.id,
    }
  }

  if (event.type === 'citation') {
    if (!event.source?.id) return null
    if (event.citationType === 'c' && event.comment) {
      return {
        key: 'comments',
        id: event.source.id,
        openComment: event.comment.id,
      }
    }
    return {
      key: 'document',
      id: event.source.id,
    }
  }

  return null
}

export function notificationTitle(item: NotificationItem): string {
  const authorName =
    item.event.author?.metadata?.name ||
    (item.event.author?.id?.uid ? abbreviateUid(item.event.author.id.uid) : 'Someone')

  if (item.reason === 'mention') {
    const sourceName = item.event.type === 'citation' ? item.event.source?.metadata?.name : null
    return `${authorName} mentioned you${sourceName ? ` in ${sourceName}` : ''}`
  }

  if (item.reason === 'discussion') {
    const targetName = item.event.type === 'comment' ? item.event.target?.metadata?.name : null
    return `${authorName} started a discussion${targetName ? ` on ${targetName}` : ''}`
  }

  const targetName = item.event.type === 'comment' ? item.event.target?.metadata?.name : null
  return `${authorName} replied to your comment${targetName ? ` in ${targetName}` : ''}`
}

export function getMaxLoadedNotificationEventAtMs(notifications: NotificationItem[], nowMs: number = Date.now()) {
  if (!notifications.length) return nowMs
  return notifications.reduce((maxEventAtMs, item) => {
    return Math.max(maxEventAtMs, item.event.eventAtMs)
  }, 0)
}

export async function markNotificationReadAndNavigate(input: {
  accountUid: string
  item: NotificationItem
  markEventRead: (params: {accountUid: string; eventId: string; eventAtMs: number}) => Promise<void>
  navigate: (route: NavRoute) => void
}) {
  await input.markEventRead({
    accountUid: input.accountUid,
    eventId: input.item.event.feedEventId,
    eventAtMs: input.item.event.eventAtMs,
  })
  const route = notificationRouteForEvent(input.item.event)
  if (route) input.navigate(route)
}
