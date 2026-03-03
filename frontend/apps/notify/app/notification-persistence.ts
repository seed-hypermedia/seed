import type {Notification} from '@shm/emails/notifier'
import type {NotificationPayload} from '@shm/shared/models/notification-payload'
import {getInboxRegisteredAccounts, insertNotificationsBatch} from './db'

export function notificationToPayload(notif: Notification, eventId: string, eventAtMs: number): NotificationPayload {
  const base = {
    feedEventId: eventId,
    eventAtMs,
  }

  if (notif.reason === 'mention') {
    return {
      ...base,
      reason: 'mention',
      eventType: notif.source === 'comment' ? 'comment' : 'citation',
      author: {
        uid: notif.authorAccountId,
        name: notif.authorMeta?.name ?? null,
        icon: notif.authorMeta?.icon ?? null,
      },
      target: {
        uid: notif.targetId.uid,
        path: notif.targetId.path ?? null,
        name: notif.targetMeta?.name ?? null,
      },
      commentId: notif.comment?.id ?? null,
      sourceId: null,
      citationType: null,
    }
  }

  if (notif.reason === 'reply') {
    return {
      ...base,
      reason: 'reply',
      eventType: 'comment',
      author: {
        uid: notif.comment.author,
        name: notif.authorMeta?.name ?? null,
        icon: notif.authorMeta?.icon ?? null,
      },
      target: {
        uid: notif.targetId.uid,
        path: notif.targetId.path ?? null,
        name: notif.targetMeta?.name ?? null,
      },
      commentId: notif.comment.id,
      sourceId: null,
      citationType: null,
    }
  }

  if (notif.reason === 'discussion') {
    return {
      ...base,
      reason: 'discussion',
      eventType: 'comment',
      author: {
        uid: notif.comment.author,
        name: notif.authorMeta?.name ?? null,
        icon: notif.authorMeta?.icon ?? null,
      },
      target: {
        uid: notif.targetId.uid,
        path: notif.targetId.path ?? null,
        name: notif.targetMeta?.name ?? null,
      },
      commentId: notif.comment.id,
      sourceId: null,
      citationType: null,
    }
  }

  if (notif.reason === 'site-doc-update') {
    return {
      ...base,
      reason: 'site-doc-update' as const,
      eventType: 'ref',
      author: {
        uid: notif.authorAccountId,
        name: notif.authorMeta?.name ?? null,
        icon: notif.authorMeta?.icon ?? null,
      },
      target: {
        uid: notif.targetId.uid,
        path: notif.targetId.path ?? null,
        name: notif.targetMeta?.name ?? null,
      },
      commentId: null,
      sourceId: null,
      citationType: null,
    }
  }

  if (notif.reason === 'site-new-discussion') {
    return {
      ...base,
      reason: 'site-new-discussion' as const,
      eventType: 'comment',
      author: {
        uid: notif.comment.author,
        name: notif.authorMeta?.name ?? null,
        icon: notif.authorMeta?.icon ?? null,
      },
      target: {
        uid: notif.targetId.uid,
        path: notif.targetId.path ?? null,
        name: notif.targetMeta?.name ?? null,
      },
      commentId: notif.comment.id,
      sourceId: null,
      citationType: null,
    }
  }

  // user-comment
  return {
    ...base,
    reason: 'user-comment' as const,
    eventType: 'comment',
    author: {
      uid: notif.comment.author,
      name: notif.authorMeta?.name ?? null,
      icon: notif.authorMeta?.icon ?? null,
    },
    target: {
      uid: notif.targetId.uid,
      path: notif.targetId.path ?? null,
      name: notif.targetMeta?.name ?? null,
    },
    commentId: notif.comment.id,
    sourceId: null,
    citationType: null,
  }
}

type CollectedInboxNotification = {
  accountId: string
  notif: Notification
  eventId: string
  eventAtMs: number
}

export function persistNotificationsForInboxAccounts(collected: CollectedInboxNotification[]): number {
  if (!collected.length) return 0

  const inboxAccountIds = getInboxRegisteredAccounts()
  if (!inboxAccountIds.length) return 0

  const inboxAccountSet = new Set(inboxAccountIds)
  const items: Array<{accountId: string; feedEventId: string; eventAtMs: number; data: NotificationPayload}> = []

  for (const entry of collected) {
    if (!inboxAccountSet.has(entry.accountId)) continue
    if (!entry.eventId) continue
    const payload = notificationToPayload(entry.notif, entry.eventId, entry.eventAtMs)
    items.push({
      accountId: entry.accountId,
      feedEventId: entry.eventId,
      eventAtMs: entry.eventAtMs,
      data: payload,
    })
  }

  if (items.length > 0) {
    insertNotificationsBatch(items)
  }
  return items.length
}
