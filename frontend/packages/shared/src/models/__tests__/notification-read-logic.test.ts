import {describe, expect, it} from 'vitest'
import {
  countUnreadNotificationsBySite,
  isNotificationEventRead,
  markAllNotificationsReadInState,
  markNotificationEventReadInState,
  markNotificationEventUnreadInState,
  markNotificationsReadInState,
  notificationMatchesSite,
  type NotificationReadLikeState,
} from '../notification-read-logic'
import {createEmptyNotificationState, reduceNotificationState} from '../notification-state'
import type {NotificationPayload} from '../notification-payload'

function notification(feedEventId: string, eventAtMs: number, siteUid: string): NotificationPayload {
  return {
    feedEventId,
    eventAtMs,
    reason: 'reply',
    eventType: 'comment',
    author: {uid: 'author', name: null, icon: null},
    target: {uid: siteUid, path: ['post'], name: null},
    commentId: 'comment',
    sourceId: null,
    citationType: null,
  }
}

describe('notification read logic', () => {
  it('marks a notification as read above the watermark', () => {
    const nextState = markNotificationEventReadInState({
      readState: {
        markAllReadAtMs: 1_000,
        readEvents: [],
      },
      eventId: 'event-a',
      eventAtMs: 1_500,
    })

    expect(nextState).toEqual({
      markAllReadAtMs: 1_000,
      readEvents: [{eventId: 'event-a', eventAtMs: 1_500}],
    })
  })

  it('marks a watermark-covered notification as unread by lowering the watermark', () => {
    const nextState = markNotificationEventUnreadInState({
      readState: {
        markAllReadAtMs: 5_000,
        readEvents: [],
      },
      eventId: 'event-b',
      eventAtMs: 2_000,
      otherLoadedEvents: [
        {eventId: 'event-a', eventAtMs: 3_000},
        {eventId: 'event-b', eventAtMs: 2_000},
        {eventId: 'event-c', eventAtMs: 1_000},
      ],
    })

    expect(nextState).toEqual({
      markAllReadAtMs: 1_999,
      readEvents: [{eventId: 'event-a', eventAtMs: 3_000}],
    })
  })

  it('marks an explicitly-read notification as unread by removing its read event', () => {
    const nextState = markNotificationEventUnreadInState({
      readState: {
        markAllReadAtMs: 1_999,
        readEvents: [{eventId: 'event-a', eventAtMs: 3_000}],
      },
      eventId: 'event-a',
      eventAtMs: 3_000,
      otherLoadedEvents: [
        {eventId: 'event-a', eventAtMs: 3_000},
        {eventId: 'event-b', eventAtMs: 2_000},
      ],
    })

    expect(nextState).toEqual({
      markAllReadAtMs: 1_999,
      readEvents: [],
    })
  })

  it('marks all loaded notifications as read without keeping covered read events', () => {
    const nextState = markAllNotificationsReadInState({
      readState: {
        markAllReadAtMs: 1_000,
        readEvents: [
          {eventId: 'event-a', eventAtMs: 1_500},
          {eventId: 'event-b', eventAtMs: 900},
        ],
      },
      markAllReadAtMs: 1_400,
    })

    expect(nextState).toEqual({
      markAllReadAtMs: 1_400,
      readEvents: [{eventId: 'event-a', eventAtMs: 1_500}],
    })
  })
})

describe('site-scoped notifications', () => {
  it('matches notifications whose target belongs to the site, or all without a site', () => {
    expect(notificationMatchesSite(notification('a', 1, 'site-a'), 'site-a')).toBe(true)
    expect(notificationMatchesSite(notification('b', 1, 'site-b'), 'site-a')).toBe(false)
    expect(notificationMatchesSite(notification('b', 1, 'site-b'))).toBe(true)
  })

  it('marks each given notification read without moving the watermark', () => {
    const unread: NotificationReadLikeState = {markAllReadAtMs: null, readEvents: []}
    const nextState = markNotificationsReadInState(unread, [
      notification('a-new', 3_000, 'site-a'),
      notification('a-old', 1_000, 'site-a'),
    ])
    expect(nextState.markAllReadAtMs).toBeNull()
    expect(nextState.readEvents.map((event) => event.eventId).sort()).toEqual(['a-new', 'a-old'])
  })

  it('applies a site mark-all locally to the loaded notifications of that site only', () => {
    const state = createEmptyNotificationState('account')
    const withInbox = {
      ...state,
      inbox: {
        notifications: [notification('a-new', 3_000, 'site-a'), notification('b-middle', 2_000, 'site-b')],
        hasMore: false,
        oldestEventAtMs: 2_000,
      },
    }
    const nextState = reduceNotificationState(withInbox, {type: 'mark-site-read', siteUid: 'site-a'})
    expect(nextState.readState.markAllReadAtMs).toBeNull()
    expect(nextState.readState.readEvents.map((event) => event.eventId)).toEqual(['a-new'])
  })
})

describe('unread notifications per site', () => {
  it('counts only unread notifications, grouped by the site they belong to', () => {
    const readState: NotificationReadLikeState = {
      markAllReadAtMs: 1_000,
      readEvents: [{eventId: 'a-read', eventAtMs: 3_000}],
    }
    const counts = countUnreadNotificationsBySite(
      [
        notification('a-old', 900, 'site-a'), // under the watermark
        notification('a-read', 3_000, 'site-a'), // read on its own
        notification('a-new', 4_000, 'site-a'),
        notification('b-new', 5_000, 'site-b'),
        notification('b-newer', 6_000, 'site-b'),
      ],
      readState,
    )
    expect(counts).toEqual({'site-a': 1, 'site-b': 2})
  })

  it('reflects a newly read event right away, not a stale lookup of the previous read state', () => {
    const before: NotificationReadLikeState = {markAllReadAtMs: null, readEvents: []}
    expect(isNotificationEventRead({readState: before, eventId: 'e', eventAtMs: 1})).toBe(false)
    const after = markNotificationEventReadInState({readState: before, eventId: 'e', eventAtMs: 1})
    expect(isNotificationEventRead({readState: after, eventId: 'e', eventAtMs: 1})).toBe(true)
    expect(isNotificationEventRead({readState: before, eventId: 'e', eventAtMs: 1})).toBe(false)
  })
})
