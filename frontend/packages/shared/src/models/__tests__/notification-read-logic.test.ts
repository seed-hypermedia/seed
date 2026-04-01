import {describe, expect, it} from 'vitest'
import {
  markAllNotificationsReadInState,
  markNotificationEventReadInState,
  markNotificationEventUnreadInState,
} from '../notification-read-logic'

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
